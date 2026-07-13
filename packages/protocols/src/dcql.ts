/**
 * DCQL evaluation — the wallet-side matcher that decides which stored
 * credentials can answer a verifier's query, and exactly which claims doing
 * so would disclose.
 *
 * The subset implemented matches the wire types in oid4vp.ts: `ldp_vc`
 * format, `meta.type_values`, `claims` paths with optional `values`
 * filters, and `claim_sets` alternatives (first satisfiable set wins —
 * they are in the verifier's order of preference).
 */

import type { DcqlClaimQuery, DcqlCredentialQuery, DcqlQuery } from "./oid4vp.js";

/** One claim a match would disclose. */
export interface DcqlClaimMatch {
  claim: DcqlClaimQuery;
  /** The claim's path as a JSON pointer — the derive `selectivePointers` form. */
  pointer: string;
  /** The claim's current value in the credential (shown on the consent screen). */
  value: unknown;
}

/** A credential that satisfies one credential query. */
export interface DcqlCredentialMatch {
  /** Which claim_set alternative was satisfied (0 when there are no claim_sets). */
  claimSetIndex: number;
  /** The claims disclosure would reveal, in query order. */
  claims: DcqlClaimMatch[];
}

/**
 * Convert a DCQL claims path to a JSON pointer usable as a bbs-2023
 * selective-disclosure pointer (RFC 6901 escaping: `~` → `~0`, `/` → `~1`).
 */
export function claimPathToPointer(path: (string | number)[]): string {
  return path
    .map((segment) =>
      typeof segment === "number"
        ? `/${segment}`
        : `/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    )
    .join("");
}

/** Walk a DCQL path: strings key into objects, integers index arrays. */
function valueAtPath(root: unknown, path: (string | number)[]): { found: boolean; value?: unknown } {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof segment === "string") {
      if (typeof current !== "object" || current === null || Array.isArray(current)) {
        return { found: false };
      }
      current = (current as Record<string, unknown>)[segment];
    } else {
      if (!Array.isArray(current) || segment >= current.length) {
        return { found: false };
      }
      current = current[segment];
    }
    if (current === undefined) {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

function matchClaim(credential: unknown, claim: DcqlClaimQuery): DcqlClaimMatch | null {
  const result = valueAtPath(credential, claim.path);
  if (!result.found) return null;
  if (claim.values !== undefined && !claim.values.some((v) => v === result.value)) {
    return null;
  }
  return { claim, pointer: claimPathToPointer(claim.path), value: result.value };
}

function matchesTypeValues(credential: unknown, typeValues: string[][] | undefined): boolean {
  if (typeValues === undefined) return true;
  if (typeof credential !== "object" || credential === null) return false;
  const rawType = (credential as Record<string, unknown>)["type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  return typeValues.some((required) => required.every((t) => types.includes(t)));
}

/**
 * Evaluate one credential query against one credential. Returns what a
 * presentation would disclose, or null if this credential cannot satisfy
 * the query.
 */
export function matchDcqlCredentialQuery(
  credential: unknown,
  query: DcqlCredentialQuery,
): DcqlCredentialMatch | null {
  if (!matchesTypeValues(credential, query.meta?.type_values)) {
    return null;
  }
  if (query.claims === undefined) {
    // No claims requested: the credential itself (mandatory fields only) satisfies.
    return { claimSetIndex: 0, claims: [] };
  }

  const byId = new Map<string, DcqlClaimQuery>();
  for (const claim of query.claims) {
    if (claim.id !== undefined) byId.set(claim.id, claim);
  }

  // Without claim_sets every claim must match; with them, the first fully
  // satisfiable alternative wins.
  const alternatives: DcqlClaimQuery[][] =
    query.claim_sets === undefined
      ? [query.claims]
      : query.claim_sets.map((set) =>
          set.map((ref) => {
            const claim = byId.get(ref);
            // Unreachable for queries validated by assertDcqlQuery.
            if (claim === undefined) {
              throw new Error(`claim_sets references unknown claim id "${ref}"`);
            }
            return claim;
          }),
        );

  for (const [index, alternative] of alternatives.entries()) {
    const matches: DcqlClaimMatch[] = [];
    for (const claim of alternative) {
      const match = matchClaim(credential, claim);
      if (match === null) break;
      matches.push(match);
    }
    if (matches.length === alternative.length) {
      return { claimSetIndex: index, claims: matches };
    }
  }
  return null;
}

/** Candidates for one credential query across a set of stored credentials. */
export interface DcqlQueryCandidates {
  query: DcqlCredentialQuery;
  /** Index into the caller's credential list + what presenting it would disclose. */
  candidates: { index: number; match: DcqlCredentialMatch }[];
}

/**
 * Evaluate a whole DCQL query against the caller's credentials. The request
 * is satisfiable iff every entry has at least one candidate.
 */
export function matchDcqlQuery(
  credentials: unknown[],
  query: DcqlQuery,
): DcqlQueryCandidates[] {
  return query.credentials.map((credentialQuery) => ({
    query: credentialQuery,
    candidates: credentials.flatMap((credential, index) => {
      const match = matchDcqlCredentialQuery(credential, credentialQuery);
      return match === null ? [] : [{ index, match }];
    }),
  }));
}
