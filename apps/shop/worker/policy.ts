/**
 * The Nightcap's verification policy: what it asks for (DCQL) and how it
 * judges what comes back.
 *
 * The query prefers the mdoc-style `age_over_18` flag and falls back to the
 * raw `birth_date` for credentials issued before the flags existed — a
 * deliberate exhibit: the fallback discloses strictly more than the flag,
 * and the result page shows that difference. The ZK tier (M4) will beat
 * both.
 */

import type { DcqlQuery } from "@vgw/protocols";
import type { VerifiableCredential } from "@vgw/vc-kit";
import type { SessionOutcome } from "./sessions.js";

/** The single credential query id — key of this query's vp_token entry. */
export const AGE_QUERY_ID = "utopia_dl_age";

/** Path segments shared by both claims. */
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
      ],
      claim_sets: [["age_flag"], ["dob"]],
    },
  ],
};

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
