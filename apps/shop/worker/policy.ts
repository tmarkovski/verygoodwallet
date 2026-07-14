/**
 * The Nightcap's verification policy: what it asks for (DCQL) and how it
 * judges what comes back.
 *
 * The query's alternatives are the demo's privacy ladder, in the shop's
 * order of preference: the ZK age predicate over the birthdate commitment
 * (learns one bit, valid for ANY cutoff), the mdoc-style `age_over_18` flag
 * (one bit, but only cutoffs the issuer anticipated — and stale since
 * issuance), and the raw `birth_date` fallback for credentials issued
 * before the flags existed (discloses strictly the most).
 */

import type { DcqlQuery } from "@vgw/protocols";
import type { VerifiableCredential } from "@vgw/vc-kit";
// Subpath imports only: pulling in @vgw/zk's root would drag the bb.js/noir
// WASM stacks into the WORKER bundle (as lazy chunks, but uploaded and
// counted all the same). These three modules are WASM-free by contract.
import { assertAgeProofBundle } from "@vgw/zk/bundle";
import { ageCutoffDays } from "@vgw/zk/cutoff";
import { normalizeFieldHex } from "@vgw/zk/encoding";
import type { SessionOutcome } from "./sessions.js";

/** The single credential query id — key of this query's vp_token entry. */
export const AGE_QUERY_ID = "utopia_dl_age";

/** The age threshold this shop gates on. */
export const AGE_YEARS = 18;

/**
 * Clock-skew tolerance for the proof's cutoff: the wallet computes "today
 * minus 18 years" on its own clock, which near midnight may run one day
 * ahead of the Worker's.
 */
const CUTOFF_SKEW_DAYS = 1;

/** Path segments shared by all three claims. */
const LICENSE_PATH = ["credentialSubject", "driversLicense"] as const;

export const AGE_DCQL_QUERY: DcqlQuery = {
  credentials: [
    {
      id: AGE_QUERY_ID,
      format: "ldp_vc",
      meta: {
        type_values: [["VerifiableCredential", "Iso18013DriversLicenseCredential"]],
      },
      claims: [
        // No `values` filter on the flag: the shop wants to LEARN the value,
        // not steer under-18 wallets into disclosing their birth date.
        { id: "age_flag", path: [...LICENSE_PATH, "age_over_18"] },
        { id: "dob", path: [...LICENSE_PATH, "birth_date"] },
        { id: "commitment", path: [...LICENSE_PATH, "birthDateCommitment"] },
      ],
      // The wallet's DEFAULT is the first satisfiable set; the ZK path needs
      // the holder's opt-in (proving costs seconds), so the flag leads and
      // the tier picker is how a wallet chooses the commitment route.
      claim_sets: [["age_flag"], ["dob"], ["commitment"]],
      vgw_zk: { predicate: "age_over", years: AGE_YEARS, claim_id: "commitment" },
    },
  ],
};

/**
 * Judge a tier-2 response: the presentation disclosed the birthdate
 * commitment and carried a `zkAgeProof` bundle (signature-covered by the VP
 * wrapper, which already verified).
 *
 * The Worker checks everything EXCEPT the UltraHonk proof itself:
 * bb.js instantiates WASM from bytes at runtime, which the Workers runtime
 * prohibits, and its WASM alone would exhaust the free plan's script budget
 * — so the final cryptographic check runs in the shop's own client (and in
 * Node for the e2e suite), against the same checked-in verification key.
 * Hence `zk_pending`, never `allowed`, from this function.
 *
 * What IS checked here, because the client shouldn't have to re-derive it:
 * - the bundle is well-formed (shape, sizes, known scheme/circuit),
 * - its commitment equals the BBS-disclosed `birthDateCommitment` — the
 *   link between "a proof about SOME birthdate" and "THE birthdate the DMV
 *   signed for this credential",
 * - its threshold is this shop's policy threshold, and
 * - its cutoff is at most today's cutoff (older is stricter, newer would
 *   shrink the required age), with one day of clock-skew tolerance.
 */
export function evaluateZkAgePolicy(
  credentials: VerifiableCredential[],
  zkAgeProof: unknown,
  now: Date = new Date(),
): Pick<SessionOutcome, "status" | "verdict" | "reason" | "disclosed" | "zk"> {
  const disclosed = disclosedLicenseClaims(credentials);

  let bundle;
  try {
    ({ bundle } = assertAgeProofBundle(zkAgeProof));
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "malformed zkAgeProof",
      disclosed,
    };
  }

  const disclosedCommitment = disclosed["birthDateCommitment"];
  if (typeof disclosedCommitment !== "string") {
    return {
      status: "failed",
      reason:
        "The presentation carries a zkAgeProof but does not disclose the birthDateCommitment it must be proven against.",
      disclosed,
    };
  }
  let signedCommitment: string;
  try {
    signedCommitment = normalizeFieldHex(disclosedCommitment);
  } catch {
    return {
      status: "failed",
      reason: "The disclosed birthDateCommitment is not a hex field element.",
      disclosed,
    };
  }
  if (bundle.commitment !== signedCommitment) {
    return {
      status: "failed",
      reason:
        "The zkAgeProof's commitment is not the birthDateCommitment the issuer signed — the proof is about some other birthdate.",
      disclosed,
    };
  }

  if (bundle.years !== AGE_YEARS) {
    return {
      status: "failed",
      reason: `The zkAgeProof proves an age_over_${bundle.years} predicate; this shop requires age_over_${AGE_YEARS}.`,
      disclosed,
    };
  }

  const maxCutoff = ageCutoffDays(AGE_YEARS, now) + CUTOFF_SKEW_DAYS;
  if (bundle.cutoffDays > maxCutoff) {
    return {
      status: "failed",
      reason: `The zkAgeProof's cutoff (day ${bundle.cutoffDays}) is later than today's age_over_${AGE_YEARS} cutoff (day ${maxCutoff - CUTOFF_SKEW_DAYS}) — it would prove less than ${AGE_YEARS} years.`,
      disclosed,
    };
  }

  return {
    status: "verified",
    verdict: "zk_pending",
    reason:
      "Signatures, issuer, and the proof's public-input bindings verified on the Worker; the UltraHonk proof itself is verified by the shop's client (the free-tier edge runtime cannot run the WASM verifier — see the inspector).",
    disclosed,
    zk: {
      scheme: bundle.scheme,
      circuit: bundle.circuit,
      years: bundle.years,
      cutoffDays: bundle.cutoffDays,
      commitment: bundle.commitment,
      proof: bundle.proof,
    },
  };
}

/**
 * Judge the verified credentials against the 18+ policy. Only called with
 * credentials whose proofs already verified — this is pure claims logic.
 */
export function evaluateAgePolicy(
  credentials: VerifiableCredential[],
  now: Date = new Date(),
): Pick<SessionOutcome, "status" | "verdict" | "reason" | "disclosed"> {
  const disclosed = disclosedLicenseClaims(credentials);

  const ageFlag = disclosed["age_over_18"];
  if (ageFlag === true) {
    return {
      status: "verified",
      verdict: "allowed",
      reason: "The license attests age_over_18 — the shop learned one bit, not a birthdate.",
      disclosed,
    };
  }
  if (ageFlag === false) {
    return {
      status: "verified",
      verdict: "denied",
      reason: "The license attests the holder was under 18 when it was issued.",
      disclosed,
    };
  }

  const birthDate = disclosed["birth_date"];
  if (typeof birthDate === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
    if (match === null) {
      return {
        status: "failed",
        reason: `The disclosed birth_date is not a YYYY-MM-DD date: ${JSON.stringify(birthDate)}`,
        disclosed,
      };
    }
    const [, year, month, day] = match;
    const eighteenth = Date.UTC(Number(year) + 18, Number(month) - 1, Number(day));
    const allowed = eighteenth <= now.getTime();
    return {
      status: "verified",
      verdict: allowed ? "allowed" : "denied",
      reason: allowed
        ? "The disclosed birth date is more than 18 years ago — note the shop now knows the full birthdate, not just one bit."
        : "The disclosed birth date is less than 18 years ago.",
      disclosed,
    };
  }

  return {
    status: "failed",
    reason: "The presentation disclosed neither age_over_18 nor birth_date.",
    disclosed,
  };
}

/**
 * Flatten the driversLicense claims actually present across the presented
 * credentials — the "what did the verifier learn" exhibit. Includes every
 * disclosed license field, not just the ones the policy needed: mandatory
 * disclosures and tier-0 full disclosures should show up honestly.
 */
function disclosedLicenseClaims(
  credentials: VerifiableCredential[],
): Record<string, unknown> {
  const disclosed: Record<string, unknown> = {};
  for (const credential of credentials) {
    const subject = credential.credentialSubject;
    if (subject === undefined || Array.isArray(subject)) continue;
    if (typeof subject["id"] === "string") {
      // A disclosed subject id is a correlation handle — surface it loudly.
      disclosed["subject_id"] = subject["id"];
    }
    const license = subject["driversLicense"];
    if (typeof license !== "object" || license === null || Array.isArray(license)) {
      continue;
    }
    for (const [key, value] of Object.entries(license)) {
      if (key === "type") continue;
      disclosed[key] = value;
    }
  }
  return disclosed;
}
