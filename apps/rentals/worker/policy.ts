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
 *   identity + age_over_25 flag       (one bit, frozen at issuance)
 *   identity + birth_date             (fallback — discloses strictly the most)
 *   identity + range predicate        (one bit, proven against TODAY's cutoff
 *                                      over the HIDDEN birth_date twin)
 *
 * The teaching point vs the shop: the predicate proves a DIFFERENT cutoff
 * (25, not 18) from the SAME hidden twin — any cutoff, live — while nothing
 * about the two visits is correlatable: no presenter key, no commitment, and
 * a per-presentation-randomized proof. Since N3 the whole check runs
 * server-side (credkit needs no WASM): one verdict, no `zk_pending`.
 */

import type { DcqlQuery } from "@vgw/protocols";
import { CREDKIT_PARAMS_PATH } from "@vgw/protocols";
import { getEncoder, type VerifiableCredential } from "@vgw/vc-kit";
import type { PredicateExhibit, SessionOutcome } from "./sessions.js";
import { RANGE_PARAMS_BASE } from "./params.js";

/** The single credential query id — key of this query's vp_token entry. */
export const RENTAL_QUERY_ID = "utopia_dl_rental";

/** The age threshold this rental counter gates on. */
export const AGE_YEARS = 25;

/** Digits of the base-16 decomposition (16^4 days ≈ 179 years of range). */
export const RANGE_DIGITS = 4;

/** Path segments shared by all claims. */
const LICENSE_PATH = ["credentialSubject", "driversLicense"] as const;

/** The predicate's twin — must match the DL's issued numeric declaration. */
export const BIRTH_DATE_POINTER = "/credentialSubject/driversLicense/birth_date";

/** The identity claims every rental agreement needs, whatever the age route. */
const IDENTITY_CLAIM_IDS = ["given_name", "family_name", "document_number"] as const;

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

/** What `buildRentalDcqlQuery` returns: the wire query + the signed-token memory. */
export interface RentalDcqlOffer {
  query: DcqlQuery;
  /** The concrete claims offered, in wire order — travels inside the state token. */
  offeredRangeClaims: OfferedRangeClaim[];
}

/**
 * Build the per-request DCQL query. Per-request because the predicate bound
 * is "25+ as of NOW": the cutoff is pinned at request time, rides inside the
 * signed state token, and is restated verbatim at the response — no
 * re-derivation drift, no clock-skew window.
 */
export function buildRentalDcqlQuery(options: {
  origin: string;
  now: Date;
  /** base64url SHA-256 of this isolate's published range-params octets. */
  paramsHash: string;
}): RentalDcqlOffer {
  const cutoffIso = ageCutoffIso(AGE_YEARS, options.now);
  const bound = getEncoder("date1900").encode(cutoffIso).toString();
  // Older = smaller day number, so "25 or older" is birth_date <= cutoff.
  const kind = "lessOrEqual" as const;

  const query: DcqlQuery = {
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
        ],
        // Identity rides in every alternative; the wallet's DEFAULT is the
        // first satisfiable set, and the predicate route is the holder's
        // opt-in via the tier picker.
        claim_sets: [
          ["given_name", "family_name", "document_number", "age_flag"],
          ["given_name", "family_name", "document_number", "dob"],
        ],
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
          // The predicate route still discloses the rental agreement's
          // identity claims — the privacy ladder applies to the AGE question.
          claim_set: [...IDENTITY_CLAIM_IDS],
        },
      },
    ],
  };

  return {
    query,
    offeredRangeClaims: [{ pointer: BIRTH_DATE_POINTER, kind, bound, digits: RANGE_DIGITS }],
  };
}

type PolicyOutcome = Pick<
  SessionOutcome,
  "status" | "verdict" | "reason" | "disclosed" | "predicate"
>;

/**
 * Identity first: whatever the age route, the rental agreement needs the
 * driver's name and license number. Returns undefined when satisfied.
 */
function identityFailure(disclosed: Record<string, unknown>): PolicyOutcome | undefined {
  for (const field of IDENTITY_CLAIM_IDS) {
    if (typeof disclosed[field] !== "string" || disclosed[field] === "") {
      return {
        status: "failed",
        reason: `The presentation does not disclose ${field} — the rental agreement needs the driver's identity.`,
        disclosed,
      };
    }
  }
  return undefined;
}

/**
 * Judge a predicate-route response: `verifyCredkitPresentation` already
 * proved — server-side, cryptographically — that the HIDDEN birth_date twin
 * satisfies the restated bound. The identity disclosures are still enforced
 * here (all routes need them); the age question itself cost one live bit.
 */
export function evaluateRentalPredicatePolicy(
  credentials: VerifiableCredential[],
  offered: OfferedRangeClaim[],
): PolicyOutcome {
  const disclosed = disclosedLicenseClaims(credentials);
  const identity = identityFailure(disclosed);
  if (identity !== undefined) return identity;

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
      `against THIS request's cutoff, verified entirely on the Worker. The counter learned the driver's ` +
      `identity plus one live bit: no birthdate, no issuance-frozen flag, and no correlation handle ` +
      `beyond the identity values the rental agreement itself requires.`,
    disclosed,
    predicate,
  };
}

/**
 * Judge the verified credentials against the rental policy (the disclosure
 * routes). Only called with credentials whose proofs already verified —
 * this is pure claims logic.
 */
export function evaluateRentalPolicy(
  credentials: VerifiableCredential[],
  now: Date = new Date(),
): PolicyOutcome {
  const disclosed = disclosedLicenseClaims(credentials);
  const identity = identityFailure(disclosed);
  if (identity !== undefined) return identity;

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
    reason: "The presentation disclosed neither age_over_25 nor birth_date.",
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
