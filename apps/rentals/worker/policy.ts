/**
 * Utopia Wheels' verification policy: what a rental counter actually needs
 * (DCQL) and how it judges what comes back.
 *
 * The rentals profile is deliberately different from the shop's: renting a
 * car requires knowing WHO the driver is (name + license number go on the
 * rental agreement), plus an over-25 age gate. So every claim_set carries
 * the identity claims, and only the AGE route varies — the demo's privacy
 * ladder applies to the age question alone:
 *
 *   identity + age_over_25 flag   (one bit, frozen at issuance)
 *   identity + birth_date         (fallback — discloses strictly the most)
 *   identity + commitment + ZK    (one bit, proven against TODAY's cutoff)
 *
 * The teaching point vs the shop: the ZK proof is over the SAME committed
 * birthdate the shop's 18+ proof used — one commitment, any cutoff — while
 * everything else about the two visits (presenter DID, BBS proof bytes)
 * stays uncorrelatable.
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
export const RENTAL_QUERY_ID = "utopia_dl_rental";

/** The age threshold this rental counter gates on. */
export const AGE_YEARS = 25;

/**
 * Clock-skew tolerance for the proof's cutoff: the wallet computes "today
 * minus 25 years" on its own clock, which near midnight may run one day
 * ahead of the Worker's.
 */
const CUTOFF_SKEW_DAYS = 1;

/** Path segments shared by all claims. */
const LICENSE_PATH = ["credentialSubject", "driversLicense"] as const;

/** The identity claims every rental agreement needs, whatever the age route. */
const IDENTITY_CLAIM_IDS = ["given_name", "family_name", "document_number"] as const;

export const RENTAL_DCQL_QUERY: DcqlQuery = {
  credentials: [
    {
      id: RENTAL_QUERY_ID,
      format: "ldp_vc",
      meta: {
        type_values: [["VerifiableCredential", "Iso18013DriversLicenseCredential"]],
      },
      claims: [
        { id: "given_name", path: [...LICENSE_PATH, "given_name"] },
        { id: "family_name", path: [...LICENSE_PATH, "family_name"] },
        { id: "document_number", path: [...LICENSE_PATH, "document_number"] },
        // No `values` filter on the flag: the counter wants to LEARN the
        // value, not steer under-25 wallets into disclosing their birth date.
        { id: "age_flag", path: [...LICENSE_PATH, "age_over_25"] },
        { id: "dob", path: [...LICENSE_PATH, "birth_date"] },
        { id: "commitment", path: [...LICENSE_PATH, "birthDateCommitment"] },
      ],
      // Identity rides in every alternative; the wallet's DEFAULT is the
      // first satisfiable set, and the ZK route (last) is the holder's
      // opt-in via the tier picker — proving costs seconds.
      claim_sets: [
        ["given_name", "family_name", "document_number", "age_flag"],
        ["given_name", "family_name", "document_number", "dob"],
        ["given_name", "family_name", "document_number", "commitment"],
      ],
      vgw_zk: { predicate: "age_over", years: AGE_YEARS, claim_id: "commitment" },
    },
  ],
};

type PolicyOutcome = Pick<
  SessionOutcome,
  "status" | "verdict" | "reason" | "disclosed" | "zk"
>;

/**
 * Judge the verified credentials against the rental policy. Only called
 * with credentials whose proofs already verified — this is pure claims
 * logic plus (for tier 2) the zkAgeProof's public-input bindings.
 *
 * For tier-2 responses the Worker checks everything EXCEPT the UltraHonk
 * proof itself: bb.js instantiates WASM from bytes at runtime, which the
 * Workers runtime prohibits, and its WASM alone would exhaust the free
 * plan's script budget — so the final cryptographic check runs in the
 * rentals client (and in Node for the e2e suite), against the same
 * checked-in verification key. Hence `zk_pending`, never `allowed`, from
 * the ZK branch here.
 */
export function evaluateRentalPolicy(
  credentials: VerifiableCredential[],
  zkAgeProof: unknown,
  now: Date = new Date(),
): PolicyOutcome {
  const disclosed = disclosedLicenseClaims(credentials);

  // 1. Identity first: whatever the age route, the rental agreement needs
  // the driver's name and license number.
  for (const field of IDENTITY_CLAIM_IDS) {
    if (typeof disclosed[field] !== "string" || disclosed[field] === "") {
      return {
        status: "failed",
        reason: `The presentation does not disclose ${field} — the rental agreement needs the driver's identity.`,
        disclosed,
      };
    }
  }

  // 2. The age gate, by route.
  if (zkAgeProof !== undefined) {
    return evaluateZkRoute(disclosed, zkAgeProof, now);
  }

  const ageFlag = disclosed["age_over_25"];
  if (ageFlag === true) {
    return {
      status: "verified",
      verdict: "allowed",
      reason:
        "The license attests age_over_25 — the counter learned the driver's identity plus one bit, not a birthdate.",
      disclosed,
    };
  }
  if (ageFlag === false) {
    return {
      status: "verified",
      verdict: "denied",
      reason: `The license attests the holder was under ${AGE_YEARS} when it was issued — under this counter's rental age.`,
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
    const birthday = Date.UTC(Number(year) + AGE_YEARS, Number(month) - 1, Number(day));
    const allowed = birthday <= now.getTime();
    return {
      status: "verified",
      verdict: allowed ? "allowed" : "denied",
      reason: allowed
        ? `The disclosed birth date is more than ${AGE_YEARS} years ago — note the counter now knows the full birthdate, not just one bit.`
        : `The disclosed birth date is less than ${AGE_YEARS} years ago.`,
      disclosed,
    };
  }

  return {
    status: "failed",
    reason: "The presentation disclosed neither age_over_25, birth_date, nor a ZK age proof.",
    disclosed,
  };
}

/**
 * The tier-2 route: the presentation disclosed the birthdate commitment
 * (alongside the identity claims) and carried a `zkAgeProof` bundle,
 * signature-covered by the VP wrapper, which already verified.
 *
 * What IS checked here, because the client shouldn't have to re-derive it:
 * - the bundle is well-formed (shape, sizes, known scheme/circuit),
 * - its commitment equals the BBS-disclosed `birthDateCommitment` — the
 *   link between "a proof about SOME birthdate" and "THE birthdate the DMV
 *   signed for this credential",
 * - its threshold is this counter's policy threshold (25, not the shop's
 *   18 — same commitment, different cutoff), and
 * - its cutoff is at most today's cutoff (older is stricter, newer would
 *   shrink the required age), with one day of clock-skew tolerance.
 */
function evaluateZkRoute(
  disclosed: Record<string, unknown>,
  zkAgeProof: unknown,
  now: Date,
): PolicyOutcome {
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
      reason: `The zkAgeProof proves an age_over_${bundle.years} predicate; this counter requires age_over_${AGE_YEARS}.`,
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
      "Signatures, issuer, identity claims, and the proof's public-input bindings verified on the Worker; the UltraHonk proof itself is verified by the rentals client (the free-tier edge runtime cannot run the WASM verifier — see the inspector).",
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
