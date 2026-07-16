/**
 * The Nightcap's verification policy: what it asks for (DCQL) and how it
 * judges what comes back.
 *
 * The query's alternatives are the demo's privacy ladder, in the shop's
 * order of preference: the credkit range predicate over the HIDDEN
 * `birth_date` twin (learns one bit, valid for ANY cutoff, proven against
 * THIS request's date, no correlation handle), the mdoc-style `age_over_18`
 * flag (one bit, but only cutoffs the issuer anticipated — and stale since
 * issuance), and the raw `birth_date` fallback (discloses strictly the
 * most).
 *
 * Since N3 the whole check runs server-side: credkit's verifier is pure JS
 * (no WASM), so the Worker returns ONE verdict — no `zk_pending`, no
 * client-side proof check, no split runtime.
 */

import type { DcqlQuery } from "@vgw/protocols";
import { CREDKIT_PARAMS_PATH } from "@vgw/protocols";
import { getEncoder, type VerifiableCredential } from "@vgw/vc-kit";
import type { PredicateExhibit, SessionOutcome } from "./sessions.js";
import { RANGE_PARAMS_BASE } from "./params.js";

/** The single credential query id — key of this query's vp_token entry. */
export const AGE_QUERY_ID = "utopia_dl_age";

/** The age threshold this shop gates on. */
export const AGE_YEARS = 18;

/** Digits of the base-16 decomposition (16^4 days ≈ 179 years of range). */
export const RANGE_DIGITS = 4;

/** Path segments shared by all claims. */
const LICENSE_PATH = ["credentialSubject", "driversLicense"] as const;

/** The predicate's twin — must match the DL's issued numeric declaration. */
export const BIRTH_DATE_POINTER = "/credentialSubject/driversLicense/birth_date";

const MS_PER_DAY = 86_400_000;
const EPOCH_1900 = Date.UTC(1900, 0, 1);

/**
 * The cutoff DATE for "at least `years` old as of `now`": real calendar
 * arithmetic (`Date.UTC` rolls Feb 29 over for free), never day-count year
 * approximations. Anyone born ON or BEFORE this date has had their
 * `years`th birthday.
 */
export function ageCutoffIso(years: number, now: Date): string {
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
  );
  return cutoff.toISOString().slice(0, 10);
}

/** Inverse of the `date1900` encoder, for the outcome exhibit. */
export function date1900DaysToIso(days: bigint): string {
  return new Date(EPOCH_1900 + Number(days) * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * One offered range claim in token-storable JSON (MIGRATION Appendix D.2):
 * the response endpoint rebuilds its `verifyGraph` expectations from THIS —
 * the verifier's own signed memory — never from the wire.
 */
export interface OfferedRangeClaim {
  pointer: string;
  kind: "greaterOrEqual" | "lessOrEqual";
  /** Decimal string (bigint-safe; `JSON.stringify` chokes on bigints). */
  bound: string;
  digits: number;
}

/** What `buildAgeDcqlQuery` returns: the wire query + the signed-token memory. */
export interface AgeDcqlOffer {
  query: DcqlQuery;
  /** The concrete claims offered, in wire order — travels inside the state token. */
  offeredRangeClaims: OfferedRangeClaim[];
}

/**
 * Build the per-request DCQL query. Per-request because the predicate bound
 * is "18+ as of NOW": the cutoff is pinned at request time, rides inside the
 * signed state token, and is restated verbatim at the response — no
 * re-derivation drift, no clock-skew window.
 */
export function buildAgeDcqlQuery(options: {
  origin: string;
  now: Date;
  /** base64url SHA-256 of this isolate's published range-params octets. */
  paramsHash: string;
}): AgeDcqlOffer {
  const cutoffIso = ageCutoffIso(AGE_YEARS, options.now);
  const bound = getEncoder("date1900").encode(cutoffIso).toString();
  // Older = smaller day number, so "18 or older" is birth_date <= cutoff.
  const kind = "lessOrEqual" as const;

  const query: DcqlQuery = {
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
        // The wallet's DEFAULT is the first satisfiable set; the predicate
        // route is the holder's opt-in via the tier picker.
        claim_sets: [["age_flag"], ["dob"]],
        vgw_predicates: {
          params_uri: `${options.origin}${CREDKIT_PARAMS_PATH}`,
          range: [
            {
              path: [...LICENSE_PATH, "birth_date"],
              kind,
              bound,
              digits: RANGE_DIGITS,
              params_hash: options.paramsHash,
            },
          ],
          // The predicate route discloses NOTHING beyond the issuer's
          // mandatory pointers — the shop needs one bit, not a name.
          claim_set: [],
        },
      },
    ],
  };

  return {
    query,
    offeredRangeClaims: [{ pointer: BIRTH_DATE_POINTER, kind, bound, digits: RANGE_DIGITS }],
  };
}

/**
 * Judge a predicate-route response: `verifyCredkitPresentation` already
 * proved — server-side, cryptographically — that the HIDDEN birth_date twin
 * satisfies the restated bound. What remains is narration: the shop learned
 * one live bit, no birthdate, no flag, no correlation handle.
 */
export function evaluateAgePredicatePolicy(
  credentials: VerifiableCredential[],
  offered: OfferedRangeClaim[],
): Pick<SessionOutcome, "status" | "verdict" | "reason" | "disclosed" | "predicate"> {
  const disclosed = disclosedLicenseClaims(credentials);
  const claim = offered[0];
  if (claim === undefined) {
    // Unreachable: the route is only selected when the token offered claims.
    return {
      status: "failed",
      reason: "No offered predicate to judge this presentation against.",
      disclosed,
    };
  }
  const cutoffIso = date1900DaysToIso(BigInt(claim.bound));
  const predicate: PredicateExhibit = { ...claim, cutoffIso };
  return {
    status: "verified",
    verdict: "allowed",
    reason:
      `The presentation proves birth_date on or before ${cutoffIso} — at least ${AGE_YEARS} years old ` +
      `against THIS request's cutoff, verified entirely on the Worker. The shop learned one live bit: ` +
      `no birthdate, no issuance-frozen flag, and no correlation handle (the proof hides the date behind ` +
      `a per-presentation-randomized twin).`,
    disclosed,
    predicate,
  };
}

/**
 * Judge the verified credentials against the 18+ policy (the disclosure
 * routes). Only called with credentials whose proofs already verified —
 * this is pure claims logic.
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
