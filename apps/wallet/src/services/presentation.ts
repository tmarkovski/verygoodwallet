/**
 * OID4VP wallet side — answer a verifier's presentation request (credkit
 * presentations since N3; multi-credential composites since N5b).
 *
 * The flow mirrors the pinned wire contract in @vgw/protocols:
 *
 *   authorization request (by value, in /present's search params)
 *   → DCQL match against the vault's credentials (per query, in query order)
 *   → user consent with a disclosure-tier choice (single-credential requests)
 *     or the fixed composite consent (multi-query / equality-linked requests)
 *   → (proof routes) fetch + pin the verifier's published proof alphabets
 *   → credkit presentation (selective disclosure ± range/membership claims ±
 *     link-secret equalities, holder binding to the master-derived link
 *     secret; challenge = nonce, domain = client_id, folded into the proof
 *     transcript natively)
 *   → direct_post to the verifier's response_uri
 *
 * Tier semantics (the demo's privacy ladder, single-credential requests):
 *   0 — full disclosure: one pointer at /credentialSubject reveals the whole
 *       subject. Today's status quo.
 *   1 — selective disclosure: only the claims the verifier's DCQL query
 *       matched, plus the issuer's mandatory pointers. Unlinkable across
 *       presentations.
 *   2 — predicate: credkit CCS range and/or set-membership proofs over the
 *       HIDDEN numeric twins (`vgw_predicates` in the DCQL query) — the
 *       verifier learns one live bit per claim against ITS OWN cutoff/set,
 *       never the value, and verifies the whole presentation server-side.
 *       Disclosed alongside: exactly the predicate `claim_set` (nothing at
 *       the shop; the rental desk's identity claims). No WASM, no warm-up,
 *       no proving-second waits.
 *
 * Composite requests (MIGRATION Appendix D.5): when the query carries more
 * than one credential query, or `vgw_equalities`, the tier ladder does NOT
 * apply — the request's shape is fixed (each query's `vgw_predicates` +
 * `claim_set` says exactly what to prove and disclose), and the wallet
 * answers ALL queries with ONE graph VP posted under the FIRST query's id
 * (D.5.1). Equality references support `link_secret` ONLY — every statement
 * carries the SAME wallet link secret by construction (each credential's own
 * `secretProverBlind`), so "these credentials belong to one holder" costs no
 * disclosure at all. Pointer-twin equality refs are rejected loudly: a later
 * milestone's mechanism, deliberately not silently ignored (D.5.7).
 *
 * What no tier carries anymore: a presenter key. The credkit VP has no
 * `holder` property (credkit rejects one outright) — the verifier sees no
 * identifier at all, which retires the pairwise presenter DID rather than
 * rotating it.
 */

import { deriveLinkSecret, fromBase64Url, scalarFromBase64Url } from "@vgw/keys";
import {
  REQUEST_URI_PARAM,
  assertCredkitParamsDocument,
  claimPathToPointer,
  matchDcqlCredentialQuery,
  presentationRequestFromJson,
  presentationRequestFromParams,
  type DcqlCredentialMatch,
  type DcqlCredentialQuery,
  type DcqlPredicates,
  type DcqlQuery,
  type DirectPostResult,
  type PresentationRequest,
} from "@vgw/protocols";
import {
  CREDKIT_CRYPTOSUITE,
  createCredkitPresentation,
  credkitNumericDeclarations,
  credkitProofMode,
  rangeParamsFromBase64Url,
  rangeParamsHashBase64Url,
  setParamsFromBase64Url,
  setParamsHashBase64Url,
  verifyRangeParams,
  verifySetParams,
  type GraphEquality,
  type MembershipClaimRequest,
  type RangeClaimRequest,
  type RangeParams,
  type SetMembershipParams,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import { inspect } from "../inspector/events";
import { kindLabel } from "./meta";
import type { CredentialPayload, CredentialRecord } from "./db";

/**
 * The protocol phases for a tier, in execution order, with UI labels.
 * `onStep` fires with each id as the phase begins so the Present page can
 * render progress. Tier 2 adds the params fetch — pinning the verifier's
 * published alphabet before anything is proven.
 */
export function presentationSteps(
  tier: DisclosureTier,
): { id: PresentationStep; label: string }[] {
  return [
    ...(tier === 2
      ? [{ id: "fetching-params" as const, label: "Fetching the verifier's proof alphabet" }]
      : []),
    { id: "deriving-presentation", label: "Deriving the presentation proof" },
    { id: "posting", label: "Sending it to the verifier" },
  ];
}

/**
 * The composite ceremony's phases: the params fetch happens whenever any
 * statement proves anything (in practice always — a composite request's
 * point is its proofs), then ONE graph proof covers every statement.
 */
export function compositePresentationSteps(
  fetchesParams: boolean,
): { id: PresentationStep; label: string }[] {
  return [
    ...(fetchesParams
      ? [{ id: "fetching-params" as const, label: "Fetching the verifier's proof alphabets" }]
      : []),
    { id: "deriving-presentation", label: "Deriving the linked presentation proof" },
    { id: "posting", label: "Sending it to the verifier" },
  ];
}

export type PresentationStep = "fetching-params" | "deriving-presentation" | "posting";

/** Result of {@link parsePresentParams} — a tiny state machine for /present. */
export type PresentParams =
  | { kind: "request"; request: PresentationRequest }
  | { kind: "by-reference"; requestUri: string }
  | { kind: "missing" }
  | { kind: "invalid"; reason: string };

/**
 * Read the /present route's search params. The link normally names the
 * request by reference (`request_uri` — the QR-friendly form, resolved by
 * {@link fetchPresentationRequest}); the whole unsigned authorization
 * request traveling by value in the query string remains supported. Neither
 * shape present means the page was opened without a request at all.
 */
export function parsePresentParams(searchParams: URLSearchParams): PresentParams {
  const requestUri = searchParams.get(REQUEST_URI_PARAM);
  if (requestUri !== null) {
    let parsed: URL;
    try {
      parsed = new URL(requestUri);
    } catch {
      return { kind: "invalid", reason: "The request_uri is not a valid URL" };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { kind: "invalid", reason: "The request_uri must be http(s)" };
    }
    return { kind: "by-reference", requestUri };
  }
  if (
    searchParams.get("client_id") === null &&
    searchParams.get("response_uri") === null &&
    searchParams.get("dcql_query") === null
  ) {
    return { kind: "missing" };
  }
  try {
    return { kind: "request", request: presentationRequestFromParams(searchParams) };
  } catch (err) {
    return { kind: "invalid", reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve a by-reference presentation request: fetch the JSON the verifier
 * parked for this session and run it through the same validation gate the
 * by-value route uses. One extra check the by-value route can't have: the
 * fetched request's `response_uri` must be on the request_uri's own origin —
 * the party serving the request and the party receiving the response are
 * the same verifier, so a request that points elsewhere is a substitution.
 */
export async function fetchPresentationRequest(
  requestUri: string,
): Promise<PresentationRequest> {
  const response = await fetch(requestUri, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "The verifier no longer has this request — it may have expired. Start the verification again from the verifier's site."
        : `The verifier's request endpoint answered ${response.status}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error("The verifier's request endpoint did not return JSON");
  }
  const request = presentationRequestFromJson(parsed);
  if (new URL(request.response_uri).origin !== new URL(requestUri).origin) {
    throw new Error(
      "The fetched request's response_uri is not on the verifier's own origin",
    );
  }
  return request;
}

/** What the Present page shows before the user consents. */
export interface VerifierPreview {
  request: PresentationRequest;
  verifierOrigin: string;
  /** Verifier display name from client_metadata, falling back to the origin's host. */
  verifierName: string;
}

/**
 * Describe who is asking. Pure and synchronous over an already-resolved
 * request — any by-reference fetch happened before this.
 */
export function previewPresentationRequest(request: PresentationRequest): VerifierPreview {
  const verifierOrigin = new URL(request.response_uri).origin;
  const name = request.client_metadata?.client_name;
  return {
    request,
    verifierOrigin,
    // client_metadata is verifier-controlled JSON: only a non-empty string
    // may reach the UI (same rule as issuer display names).
    verifierName:
      typeof name === "string" && name !== "" ? name : new URL(verifierOrigin).host,
  };
}

/** A stored credential that can answer one of the verifier's queries. */
export interface CandidateCredential {
  record: CredentialRecord;
  vc: VerifiableCredential;
  /** The decrypted v3 vault envelope — carries the scalar-encoded blind. */
  payload: CredentialPayload;
  match: DcqlCredentialMatch;
}

/** One credential query of the request, with the vault's candidates for it. */
export interface QueryCandidates {
  queryId: string;
  query: DcqlCredentialQuery;
  candidates: CandidateCredential[];
}

/** Everything {@link matchCredentials} learned about a request. */
export interface MatchedRequest {
  /** One entry per credential query, in `dcql_query.credentials` order. */
  queries: QueryCandidates[];
  /**
   * True when the request fixes its own shape — more than one credential
   * query, or cross-credential equalities. Composite requests bypass the
   * tier ladder: each query's `vgw_predicates` + `claim_set` says exactly
   * what is proven and disclosed (MIGRATION Appendix D.5.7).
   */
  composite: boolean;
}

/** Only the versioned credkit envelope can be presented. */
function isPresentableEnvelope(payload: CredentialPayload): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    payload.version === 3 &&
    typeof payload.secretProverBlind === "string" &&
    payload.secretProverBlind !== ""
  );
}

/** Human label for what a credential query asks for, e.g. "Resident registration". */
function queryKindLabel(query: DcqlCredentialQuery): string {
  const types = query.meta?.type_values?.[0] ?? [];
  const specific = [...types].reverse().find((t) => t !== "VerifiableCredential");
  return specific !== undefined ? kindLabel(specific) : "credential";
}

/**
 * Match the verifier's DCQL query against the vault's decrypted credentials,
 * per credential query, in the request's query order.
 *
 * Single-query requests behave exactly as before N5b: an empty candidate
 * list is a *result* the consent page renders as guidance. A COMPOSITE
 * request (multi-query or equality-linked) is all-or-nothing — the demanded
 * linkage spans every query, so an unanswerable member fails loudly here,
 * naming the query and the fix (re-issuance at the DMV). Requests carrying
 * pointer-twin equality references are rejected loudly too: this wallet
 * links statements through the hidden link secret only (D.5.7).
 */
export function matchCredentials(
  decrypted: { record: CredentialRecord; payload: CredentialPayload }[],
  request: PresentationRequest,
): MatchedRequest {
  // Surface an unsupported equality shape before any consent renders.
  equalityStatementGroups(request.dcql_query);

  const queries = request.dcql_query.credentials.map((query) => ({
    queryId: query.id,
    query,
    candidates: decrypted.flatMap(({ record, payload }) => {
      // Pre-v3 envelopes carry no credkit blind and cannot be presented —
      // they are not candidates (re-issuing at the DMV is the only path).
      if (!isPresentableEnvelope(payload)) return [];
      const match = matchDcqlCredentialQuery(payload.vc, query);
      return match === null ? [] : [{ record, vc: payload.vc, payload, match }];
    }),
  }));

  const composite =
    queries.length > 1 || (request.dcql_query.vgw_equalities?.length ?? 0) > 0;
  if (composite) {
    const unsatisfiable = queries.find((entry) => entry.candidates.length === 0);
    if (unsatisfiable !== undefined) {
      throw new Error(
        `This request cannot be answered: you don't hold a ${queryKindLabel(unsatisfiable.query)} ` +
          `(credential query "${unsatisfiable.queryId}") — get one issued at the Utopia DMV, ` +
          `then answer this request again.`,
      );
    }
  }
  return { queries, composite };
}

/**
 * Map the request's `vgw_equalities` (query-id references) to credkit's
 * statement-indexed {@link GraphEquality} groups, by query order — statement
 * i answers `dcql_query.credentials[i]`, on both sides of the wire.
 *
 * `link_secret` references only: every VGW credential is blind-signed over
 * the ONE master-derived link secret, so the linkage is provable with zero
 * disclosure. A `path` (pointer-twin) reference is REJECTED loudly — a later
 * milestone's mechanism, deliberately not ignored (MIGRATION D.5.7).
 */
function equalityStatementGroups(dcql: DcqlQuery): GraphEquality[] {
  const statementByQueryId = new Map(dcql.credentials.map((query, i) => [query.id, i]));
  return (dcql.vgw_equalities ?? []).map((group) =>
    group.map((ref) => {
      if (!("link_secret" in ref)) {
        throw new Error(
          `This verifier demands a pointer-twin equality (query "${ref.query}", path ` +
            `${JSON.stringify(ref.path)}) — this wallet links credentials through the hidden ` +
            `link secret only.`,
        );
      }
      const statement = statementByQueryId.get(ref.query);
      if (statement === undefined) {
        // Unreachable for requests validated by assertDcqlQuery.
        throw new Error(`vgw_equalities references unknown credential query "${ref.query}"`);
      }
      return { statement, linkSecret: true as const };
    }),
  );
}

export type DisclosureTier = 0 | 1 | 2;

/** One range claim of the predicate route, described for consent + proving. */
export interface PredicateRangeDescription {
  /** RFC-6901 pointer of the DECLARED twin the proof is about. */
  pointer: string;
  /** The twin's declared encoder id (from the credential's own base proof). */
  encoder: string;
  kind: "greaterOrEqual" | "lessOrEqual";
  /** The verifier's inclusive bound, decimal string, in encoder units. */
  bound: string;
  digits: number;
  /** The alphabet hash the request pinned for this claim (D.3 ritual). */
  paramsHash: string;
  /** Human-readable consent line derived from (encoder, kind, bound). */
  description: string;
  /** For `date1900` + lessOrEqual: the derived "at least N years" label. */
  years?: number;
}

/** One set-membership claim of the predicate route (N5), described for consent. */
export interface PredicateMembershipDescription {
  /** RFC-6901 pointer of the DECLARED twin the proof is about. */
  pointer: string;
  /** The twin's declared encoder id (from the credential's own base proof). */
  encoder: string;
  /** Which published set (under `sets` in the params document) is proven against. */
  setId: string;
  /** The set-alphabet hash the request pinned for this claim (D.5.5 ritual). */
  paramsHash: string;
  /** Human-readable consent line (the set's SIZE is known only after the fetch). */
  description: string;
}

/** Whether (and how) this candidate can answer the verifier's predicate request. */
export type PredicateOption =
  | {
      available: true;
      /** Where the verifier publishes its proof alphabets (same-origin enforced at fetch). */
      paramsUri: string;
      /** The requested range claims, in wire order. */
      range: PredicateRangeDescription[];
      /** The requested set-membership claims, in wire order (N5). */
      membership: PredicateMembershipDescription[];
      /**
       * Everything the predicate route DISCLOSES: the pointers of the
       * predicate `claim_set` — nothing at the shop; name + license number
       * at the rentals desk. The proofs themselves disclose no value.
       */
      pointers: string[];
      /** Claim label → value for the consent preview, in claim-set order. */
      disclosed: Record<string, unknown>;
    }
  | { available: false; reason: string };

/** The satisfiable branch of {@link PredicateOption}. */
export type AvailablePredicate = Extract<PredicateOption, { available: true }>;

const MS_PER_DAY = 86_400_000;
const EPOCH_1900 = Date.UTC(1900, 0, 1);

function date1900DaysToIso(days: bigint): string {
  return new Date(EPOCH_1900 + Number(days) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Full calendar years elapsed since `iso` as of `now` (birthday semantics). */
function yearsSince(iso: string, now: Date): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  let years = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) {
    years -= 1;
  }
  return years;
}

/**
 * Render one requested range claim for the consent screen, from the
 * credential's DECLARED encoder — never from the verifier's framing.
 */
function describeRangeClaim(
  pointer: string,
  encoder: string,
  kind: "greaterOrEqual" | "lessOrEqual",
  bound: string,
  digits: number,
  paramsHash: string,
  now = new Date(),
): PredicateRangeDescription {
  const label = pointer.slice(pointer.lastIndexOf("/") + 1);
  if (encoder === "date1900") {
    const iso = date1900DaysToIso(BigInt(bound));
    if (kind === "lessOrEqual") {
      const years = yearsSince(iso, now);
      return {
        pointer,
        encoder,
        kind,
        bound,
        digits,
        paramsHash,
        years,
        description: `${label} on or before ${iso} — at least ${years} years old`,
      };
    }
    return {
      pointer,
      encoder,
      kind,
      bound,
      digits,
      paramsHash,
      description: `${label} on or after ${iso}`,
    };
  }
  return {
    pointer,
    encoder,
    kind,
    bound,
    digits,
    paramsHash,
    description: `${label} ${kind === "lessOrEqual" ? "≤" : "≥"} ${bound}`,
  };
}

/** Render one requested membership claim for the consent screen. */
function describeMembershipClaim(
  pointer: string,
  encoder: string,
  setId: string,
  paramsHash: string,
): PredicateMembershipDescription {
  const label = pointer.slice(pointer.lastIndexOf("/") + 1);
  return {
    pointer,
    encoder,
    setId,
    paramsHash,
    description:
      `${label} is one of the verifier's published set "${setId}" — ` +
      `the value itself stays hidden`,
  };
}

/**
 * Predicate availability is STRUCTURAL: the verifier asked for range and/or
 * membership claims (`vgw_predicates`), every claimed pointer is a twin this
 * credential's own base proof DECLARES, and every `claim_set` claim has a
 * value to disclose. Deliberately NOT checked: whether the hidden value
 * actually satisfies the bound or belongs to the set — an ineligible holder
 * must be able to attempt the proof and watch the prover refuse (fail
 * closed), not be silently pre-filtered.
 */
export function predicateOption(
  query: DcqlCredentialQuery,
  candidate: { vc: VerifiableCredential; payload: CredentialPayload },
): PredicateOption {
  const predicates: DcqlPredicates | undefined = query.vgw_predicates;
  if (predicates === undefined) {
    return { available: false, reason: "This verifier doesn't request predicate proofs." };
  }
  const rangeEntries = predicates.range ?? [];
  const membershipEntries = predicates.membership ?? [];
  if (rangeEntries.length === 0 && membershipEntries.length === 0) {
    return { available: false, reason: "The verifier's predicate request is malformed." };
  }

  // The credential's own declared twins, from its signature-bound base proof.
  let declarations;
  try {
    declarations = credkitNumericDeclarations(candidate.vc);
  } catch {
    return {
      available: false,
      reason:
        "This credential predates the credkit upgrade — re-issue it at the Utopia DMV to unlock predicate proofs.",
    };
  }
  const declared = (path: (string | number)[]) => {
    const pointer = claimPathToPointer(path);
    return { pointer, decl: declarations.find((decl) => decl.pointer === pointer) };
  };
  const undeclaredReason = (path: (string | number)[]) => ({
    available: false as const,
    reason:
      `This credential declares no hidden numeric twin for "${String(path[path.length - 1])}" — ` +
      `re-issue it at the Utopia DMV to unlock predicate proofs.`,
  });

  const range: PredicateRangeDescription[] = [];
  for (const entry of rangeEntries) {
    const { pointer, decl } = declared(entry.path);
    if (decl === undefined) return undeclaredReason(entry.path);
    range.push(
      describeRangeClaim(
        pointer,
        decl.encoder,
        entry.kind,
        entry.bound,
        entry.digits,
        entry.params_hash,
      ),
    );
  }

  const membership: PredicateMembershipDescription[] = [];
  for (const entry of membershipEntries) {
    const { pointer, decl } = declared(entry.path);
    if (decl === undefined) return undeclaredReason(entry.path);
    membership.push(
      describeMembershipClaim(pointer, decl.encoder, entry.set_id, entry.params_hash),
    );
  }

  // The predicate claim_set — the verifier's declaration of what must be
  // DISCLOSED alongside the proofs. Every claim in it must exist on this
  // credential, or the route is unanswerable.
  const pointers: string[] = [];
  const disclosed: Record<string, unknown> = {};
  for (const ref of predicates.claim_set ?? []) {
    const setClaim = query.claims?.find((c) => c.id === ref);
    if (setClaim === undefined) {
      return { available: false, reason: "The verifier's predicate request is malformed." };
    }
    const value = claimValue(candidate.vc, setClaim.path);
    if (value === undefined) {
      const label = String(setClaim.path[setClaim.path.length - 1]);
      return {
        available: false,
        reason: `This credential is missing "${label}", which the verifier requires alongside the proof.`,
      };
    }
    pointers.push(claimPathToPointer(setClaim.path));
    disclosed[String(setClaim.path[setClaim.path.length - 1])] = value;
  }

  return {
    available: true,
    paramsUri: predicates.params_uri,
    range,
    membership,
    pointers,
    disclosed,
  };
}

function claimValue(vc: VerifiableCredential, path: (string | number)[]): unknown {
  let current: unknown = vc;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/** The selective-disclosure pointers a tier reveals. */
export function tierPointers(
  tier: DisclosureTier,
  match: DcqlCredentialMatch,
  predicate?: PredicateOption,
): string[] {
  if (tier === 0) {
    // One subtree pointer = the whole credentialSubject, id included.
    return ["/credentialSubject"];
  }
  if (tier === 2) {
    if (predicate === undefined || !predicate.available) {
      throw new Error("Tier 2 requires a satisfiable predicate option for this credential");
    }
    // The predicate claim_set — nothing at the shop; the rental desk's
    // identity claims. The proofs ride separately and disclose nothing.
    return predicate.pointers;
  }
  return match.claims.map((claim) => claim.pointer);
}

/**
 * True when the credential embeds a subject identifier. Credentials issued
 * before the unlinkable-by-default change carry one, and selective
 * disclosure reveals node ids structurally — so EVERY tier disclosing
 * subject claims reveals it. The consent screen must say so.
 */
export function hasEmbeddedSubjectId(vc: VerifiableCredential): boolean {
  const subject = vc.credentialSubject;
  return (
    subject !== undefined && !Array.isArray(subject) && typeof subject["id"] === "string"
  );
}

/**
 * What a tier will reveal, as claim → value pairs for the consent screen.
 * (Issuer identity and the validity window are mandatory disclosures in
 * every tier; the UI states that in prose.)
 */
export function disclosurePreview(
  tier: DisclosureTier,
  vc: VerifiableCredential,
  match: DcqlCredentialMatch,
  predicate?: PredicateOption,
): Record<string, unknown> {
  const subject = vc.credentialSubject;
  const disclosed: Record<string, unknown> = {};
  // An embedded subject id rides along in every derived proof (structural
  // node-id disclosure) — list it truthfully regardless of tier.
  if (subject !== undefined && !Array.isArray(subject) && typeof subject["id"] === "string") {
    disclosed["subject id"] = subject["id"];
  }
  if (tier === 2) {
    if (predicate !== undefined && predicate.available) {
      Object.assign(disclosed, predicate.disclosed);
      for (const claim of predicate.range) {
        disclosed[lastSegment(claim.pointer)] =
          `proven, not shown: ${claim.description} — the value never leaves this wallet`;
      }
      for (const claim of predicate.membership) {
        disclosed[lastSegment(claim.pointer)] = `proven, not shown: ${claim.description}`;
      }
    }
    return disclosed;
  }
  if (tier === 1) {
    for (const claim of match.claims) {
      disclosed[lastSegment(claim.pointer)] = claim.value;
    }
    return disclosed;
  }
  if (subject !== undefined && !Array.isArray(subject)) {
    const license = subject["driversLicense"];
    if (typeof license === "object" && license !== null && !Array.isArray(license)) {
      for (const [key, value] of Object.entries(license)) {
        if (key === "type") continue;
        disclosed[key] = value;
      }
    }
  }
  return disclosed;
}

function lastSegment(pointer: string): string {
  return pointer.slice(pointer.lastIndexOf("/") + 1);
}

// ---------------------------------------------------------------------------
// The composite plan (MIGRATION Appendix D.5.7)
// ---------------------------------------------------------------------------

/** One statement of a composite presentation, resolved for consent + proving. */
export interface CompositeStatement {
  queryId: string;
  candidate: CandidateCredential;
  /** Present when the query demands proofs; always satisfiable (or we threw). */
  predicate?: AvailablePredicate;
  /** Selective-disclosure pointers — fixed by the request's shape, no tiers. */
  pointers: string[];
  /** Consent lines: everything this statement PROVES about hidden twins. */
  proven: string[];
  /** Claim label → value this statement DISCLOSES. */
  disclosed: Record<string, unknown>;
}

/**
 * Resolve a composite request into one statement per query, in query order.
 * When several stored credentials match a query the FIRST candidate is
 * auto-picked — demo simplicity over a per-query picker; the consent screen
 * names each chosen credential so the choice is visible.
 *
 * The request's shape is fixed (D.5.7): a query with `vgw_predicates` proves
 * its claims and discloses exactly its `claim_set`; a query without proves
 * nothing and disclosure follows the DCQL match. Anything unanswerable
 * throws loudly, naming the query.
 */
export function compositeStatements(matches: MatchedRequest): CompositeStatement[] {
  return matches.queries.map(({ queryId, query, candidates }) => {
    const candidate = candidates[0];
    if (candidate === undefined) {
      throw new Error(
        `This request cannot be answered: you don't hold a ${queryKindLabel(query)} ` +
          `(credential query "${queryId}") — get one issued at the Utopia DMV, ` +
          `then answer this request again.`,
      );
    }
    if (query.vgw_predicates === undefined) {
      return {
        queryId,
        candidate,
        pointers: candidate.match.claims.map((claim) => claim.pointer),
        proven: [],
        disclosed: Object.fromEntries(
          candidate.match.claims.map((claim) => [lastSegment(claim.pointer), claim.value]),
        ),
      };
    }
    const predicate = predicateOption(query, candidate);
    if (!predicate.available) {
      throw new Error(`Credential query "${queryId}" cannot be answered: ${predicate.reason}`);
    }
    return {
      queryId,
      candidate,
      predicate,
      pointers: predicate.pointers,
      proven: [
        ...predicate.range.map((claim) => claim.description),
        ...predicate.membership.map((claim) => claim.description),
      ],
      disclosed: predicate.disclosed,
    };
  });
}

// ---------------------------------------------------------------------------
// Published-params pinning (MIGRATION §8, Appendix D.3, D.5.5)
// ---------------------------------------------------------------------------

/**
 * Alphabets that passed the full pinning ritual, keyed by `${uri}#${hash}`
 * (sets by `${uri}#set:${id}#${hash}`). `verifyRangeParams` costs 2 pairings
 * per digit and `verifySetParams` 2 per member — run once per alphabet,
 * remembered for the tab's lifetime (the hash key makes a rotated alphabet
 * a different entry, never a stale hit).
 */
const verifiedParamsCache = new Map<string, RangeParams>();
const verifiedSetParamsCache = new Map<string, SetMembershipParams>();

/** Everything one statement proves, with the pinned live params attached. */
interface ResolvedProofClaims {
  rangeClaims?: RangeClaimRequest[];
  membershipClaims?: MembershipClaimRequest[];
}

/**
 * Fetch and PIN the verifier's published proof alphabets for every proving
 * statement. The discipline (anti-tag, MIGRATION §8): same-origin with the
 * response endpoint, the SAME public artifact every holder fetches, one
 * fetch per distinct params_uri (the SAME document supplies the range
 * alphabet and every `sets[set_id]`), sha256(octets) equal to BOTH the
 * document's own hash and every DCQL claim's params_hash, full point
 * validation on decode, and a one-time pairing check per alphabet. Any
 * mismatch throws — nothing is proven against an unpinned alphabet.
 */
async function resolveProofClaims(
  request: PresentationRequest,
  predicates: readonly (AvailablePredicate | undefined)[],
): Promise<(ResolvedProofClaims | undefined)[]> {
  const responseOrigin = new URL(request.response_uri).origin;
  const documents = new Map<string, Awaited<ReturnType<typeof fetchParamsDocument>>>();
  const rangeParamsByUri = new Map<string, RangeParams>();
  const setParamsByKey = new Map<string, SetMembershipParams>();

  for (const predicate of predicates) {
    if (predicate === undefined) continue;
    const paramsUrl = new URL(predicate.paramsUri);
    if (paramsUrl.origin !== responseOrigin) {
      throw new Error(
        `The verifier's params_uri (${predicate.paramsUri}) is not on its own origin (${responseOrigin}) — refusing a third-party proof alphabet`,
      );
    }
    let document = documents.get(predicate.paramsUri);
    if (document === undefined) {
      document = await fetchParamsDocument(predicate.paramsUri);
      documents.set(predicate.paramsUri, document);
    }
    for (const claim of predicate.range) {
      // The request's params_hash values were validated as present; every
      // one must name the exact published artifact — checked BEFORE the
      // expensive pairing validation.
      if (claim.paramsHash !== (await rangeParamsDocumentHash(document))) {
        throw new Error(
          "The verification request pins a different proof alphabet than the verifier publishes — refusing to prove against it",
        );
      }
    }
    if (predicate.range.length > 0 && !rangeParamsByUri.has(predicate.paramsUri)) {
      rangeParamsByUri.set(
        predicate.paramsUri,
        await pinRangeParams(predicate.paramsUri, document),
      );
    }
    for (const claim of predicate.membership) {
      const key = `${predicate.paramsUri}#set:${claim.setId}`;
      if (!setParamsByKey.has(key)) {
        setParamsByKey.set(
          key,
          await pinSetParams(predicate.paramsUri, document, claim.setId, claim.paramsHash),
        );
      }
    }
  }

  return predicates.map((predicate) => {
    if (predicate === undefined) return undefined;
    const resolved: ResolvedProofClaims = {};
    if (predicate.range.length > 0) {
      const params = rangeParamsByUri.get(predicate.paramsUri)!;
      // Claims in the request's wire order — the verifier restates them
      // positionally at verification.
      resolved.rangeClaims = predicate.range.map((claim) => ({
        pointer: claim.pointer,
        kind: claim.kind,
        bound: BigInt(claim.bound),
        digits: claim.digits,
        params,
      }));
    }
    if (predicate.membership.length > 0) {
      resolved.membershipClaims = predicate.membership.map((claim) => ({
        pointer: claim.pointer,
        params: setParamsByKey.get(`${predicate.paramsUri}#set:${claim.setId}`)!,
      }));
    }
    return resolved;
  });
}

interface FetchedParamsDocument {
  document: ReturnType<typeof assertCredkitParamsDocument>;
  /** Lazily-computed sha256 of the range octets (memoized per fetch). */
  rangeHash?: string;
}

async function fetchParamsDocument(paramsUri: string): Promise<FetchedParamsDocument> {
  let response: Response;
  try {
    response = await fetch(paramsUri);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Could not fetch the verifier's proof alphabet (${paramsUri}): ${detail}`,
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(
      `The verifier's proof alphabet endpoint (${paramsUri}) answered HTTP ${response.status}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`The verifier's proof alphabet (${paramsUri}) is not valid JSON`);
  }
  const document = assertCredkitParamsDocument(parsed);
  if (document.suite !== CREDKIT_CRYPTOSUITE) {
    throw new Error(
      `The verifier's proof alphabet is for cryptosuite "${document.suite}" — this wallet presents only ${CREDKIT_CRYPTOSUITE}`,
    );
  }
  return { document };
}

/** sha256 of the document's published range octets (THE hash, memoized). */
async function rangeParamsDocumentHash(fetched: FetchedParamsDocument): Promise<string> {
  if (fetched.document.range === undefined) {
    throw new Error("The verifier's proof alphabet document publishes no range params");
  }
  fetched.rangeHash ??= await rangeParamsHashBase64Url(
    fromBase64Url(fetched.document.range.params),
  );
  return fetched.rangeHash;
}

/**
 * Pin + validate the published range alphabet: sha256(octets) must equal the
 * document's own declared hash (the DCQL claims are checked by the caller —
 * same value, the one credkit embeds in the proof and the verifier
 * restates), decode with full point validation, then the one-time pairing
 * check, cached by hash.
 */
async function pinRangeParams(
  paramsUri: string,
  fetched: FetchedParamsDocument,
): Promise<RangeParams> {
  const range = fetched.document.range;
  if (range === undefined) {
    throw new Error("The verifier's proof alphabet document publishes no range params");
  }
  const octets = fromBase64Url(range.params);
  const hash = await rangeParamsDocumentHash(fetched);
  if (hash !== range.hash) {
    throw new Error(
      "The published proof alphabet does not match its own declared hash — refusing it",
    );
  }
  inspect.emit({
    label: "Verifier proof alphabet fetched & hash-pinned",
    data: {
      paramsUri,
      suite: fetched.document.suite,
      base: range.base,
      hash,
      octetsBytes: octets.length,
    },
  });

  const cacheKey = `${paramsUri}#${hash}`;
  const cached = verifiedParamsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const params = rangeParamsFromBase64Url(range.params);
  if (params.base !== range.base) {
    throw new Error(
      "The published proof alphabet's base does not match its document — refusing it",
    );
  }
  // One-time cryptographic validation (2 pairings per digit): a malformed
  // alphabet would make every proof silently unverifiable.
  if (!verifyRangeParams(params)) {
    throw new Error("The verifier's proof alphabet failed its pairing check — refusing it");
  }
  verifiedParamsCache.set(cacheKey, params);
  inspect.emit({
    label: "Proof alphabet validated (pairing check) & cached",
    data: { base: params.base, cacheKey },
  });
  return params;
}

/**
 * Pin + validate one published set alphabet (D.5.5): the SAME fetched
 * document supplies `sets[set_id]`; sha256(octets) must equal BOTH the
 * document's declared hash for the set AND the DCQL claim's params_hash
 * (credkit's own wire `membershipParamsHash` of the same octets), decode
 * with full point validation, then the one-time pairing check per member,
 * cached by hash.
 */
async function pinSetParams(
  paramsUri: string,
  fetched: FetchedParamsDocument,
  setId: string,
  claimParamsHash: string,
): Promise<SetMembershipParams> {
  const entry = fetched.document.sets?.[setId];
  if (entry === undefined) {
    throw new Error(
      `The verifier's proof alphabet document publishes no set "${setId}" — refusing to prove membership against it`,
    );
  }
  const octets = fromBase64Url(entry.params);
  const hash = await setParamsHashBase64Url(octets);
  if (hash !== entry.hash) {
    throw new Error(
      `The published set "${setId}" does not match its own declared hash — refusing it`,
    );
  }
  if (hash !== claimParamsHash) {
    throw new Error(
      `The verification request pins a different set alphabet for "${setId}" than the verifier publishes — refusing to prove against it`,
    );
  }

  const cacheKey = `${paramsUri}#set:${setId}#${hash}`;
  const cached = verifiedSetParamsCache.get(cacheKey);
  if (cached !== undefined) {
    inspect.emit({
      label: "Verifier set alphabet fetched & hash-pinned",
      data: { paramsUri, setId, hash, members: cached.members.length, cached: true },
    });
    return cached;
  }

  const params = setParamsFromBase64Url(entry.params);
  inspect.emit({
    label: "Verifier set alphabet fetched & hash-pinned",
    data: {
      paramsUri,
      setId,
      hash,
      members: params.members.length,
      octetsBytes: octets.length,
    },
  });
  // One-time cryptographic validation (2 pairings per member).
  if (!verifySetParams(params)) {
    throw new Error(
      `The verifier's set alphabet "${setId}" failed its pairing check — refusing it`,
    );
  }
  verifiedSetParamsCache.set(cacheKey, params);
  inspect.emit({
    label: "Set alphabet validated (pairing check) & cached",
    data: { setId, members: params.members.length, cacheKey },
  });
  return params;
}

// ---------------------------------------------------------------------------
// The ceremonies
// ---------------------------------------------------------------------------

export type PresentCredentialOptions = {
  request: PresentationRequest;
  queryId: string;
  candidate: CandidateCredential;
  tier: DisclosureTier;
  masterSecret: Uint8Array;
  /** Aborted when the session locks — see AcceptCredentialOfferOptions. */
  signal?: AbortSignal;
  onStep?: (step: PresentationStep) => void;
};

export interface PresentCredentialResult {
  /** Where the verifier wants the user afterwards (its result page). */
  redirectUri?: string;
  /** The presentation as posted, for the "what was shared" recap. */
  presentation: VerifiablePresentation;
}

/**
 * The vault envelope must be the v3 credkit shape with a holder-bound
 * credkit proof — anything else can only be fixed by re-issuance.
 */
function assertPresentable(candidate: CandidateCredential): void {
  if (!isPresentableEnvelope(candidate.payload)) {
    throw new Error(
      "This credential predates the credkit upgrade and cannot be presented — re-issue it at the Utopia DMV",
    );
  }
  let proofMode;
  try {
    proofMode = credkitProofMode(candidate.vc);
  } catch {
    throw new Error(
      "This credential does not carry a credkit proof and cannot be presented — re-issue it at the Utopia DMV",
    );
  }
  if (proofMode !== "holderBound") {
    throw new Error(
      "This credential is not bound to this wallet's link secret — re-issue it at the Utopia DMV",
    );
  }
}

/** Decode a candidate's stored blind, with the re-issue error on failure. */
function decodeStoredBlind(candidate: CandidateCredential): bigint {
  try {
    return scalarFromBase64Url(candidate.payload.secretProverBlind);
  } catch {
    throw new Error(
      "This credential's stored blind is malformed — re-issue it at the Utopia DMV",
    );
  }
}

/**
 * Run `createCredkitPresentation` and surface credkit's fail-closed prover
 * refusal (an out-of-range value or a set non-member) as a friendly error —
 * there is no such thing as proving a false statement, only failing to
 * prove a true one (MIGRATION §9). Nothing is posted on refusal.
 */
async function deriveOrRefuse(
  options: Parameters<typeof createCredkitPresentation>[0],
  provenDescriptions: string[],
): Promise<VerifiablePresentation> {
  try {
    return await createCredkitPresentation(options);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (/does not fit|not a member of the set/.test(detail) && provenDescriptions.length > 0) {
      const asked = provenDescriptions.join("; ");
      inspect.emit({
        label: "Proof refused (fail closed)",
        data: { reason: detail, requested: asked },
      });
      throw new Error(
        `The proof could not be generated: this credential's hidden value does not satisfy the verifier's requirement (${asked}). ` +
          `The prover fails closed — it cannot emit a proof for a statement that isn't true. Nothing was sent.`,
        { cause },
      );
    }
    throw cause;
  }
}

/** direct_post the vp_token (form-encoded, per OID4VP) and read the ack. */
async function directPost(
  request: PresentationRequest,
  vpToken: Record<string, VerifiablePresentation[]>,
): Promise<DirectPostResult> {
  const body = new URLSearchParams({
    vp_token: JSON.stringify(vpToken),
    state: request.state,
  });
  let response: Response;
  try {
    response = await fetch(request.response_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Could not reach the verifier's response endpoint (${request.response_uri}): ${detail}`,
      { cause },
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `The verifier rejected the presentation (HTTP ${response.status})${describeOauthError(text)}`,
    );
  }
  let result: DirectPostResult = {};
  try {
    result = JSON.parse(text) as DirectPostResult;
  } catch {
    // An empty/non-JSON 200 is a valid acknowledgement; there is just no
    // redirect_uri to follow.
  }
  inspect.emit({
    label: "Verifier accepted the presentation",
    data: { responseUri: request.response_uri, response: result },
  });
  return result;
}

/**
 * Run the full single-credential presentation ceremony and direct_post the
 * result. Mirrors `acceptCredentialOffer`'s discipline: the master secret is
 * snapshotted before the first await and zeroed on every exit path, and the
 * lock signal is honored at each phase boundary.
 */
export async function presentCredential(
  opts: PresentCredentialOptions,
): Promise<PresentCredentialResult> {
  const step = (id: PresentationStep) => {
    opts.signal?.throwIfAborted();
    opts.onStep?.(id);
  };
  const masterSecret = opts.masterSecret.slice();
  try {
    return await runPresentCredential(opts, masterSecret, step);
  } finally {
    masterSecret.fill(0);
  }
}

async function runPresentCredential(
  opts: PresentCredentialOptions,
  masterSecret: Uint8Array,
  step: (id: PresentationStep) => void,
): Promise<PresentCredentialResult> {
  const { request, candidate, tier } = opts;

  assertPresentable(candidate);

  // Tier-2 preconditions resolve BEFORE any key material is derived.
  const predicate =
    tier === 2
      ? predicateOption(request.dcql_query.credentials[0] as DcqlCredentialQuery, candidate)
      : undefined;
  if (tier === 2 && (predicate === undefined || !predicate.available)) {
    throw new Error(
      predicate !== undefined && !predicate.available
        ? `The predicate tier is not available: ${predicate.reason}`
        : "The predicate tier is not available for this request",
    );
  }

  // 1 (tier 2 only). Fetch + pin the verifier's PUBLISHED proof alphabets —
  // the same artifact every other holder fetches (MIGRATION §8).
  let claims: ResolvedProofClaims | undefined;
  if (tier === 2 && predicate !== undefined && predicate.available) {
    step("fetching-params");
    [claims] = await resolveProofClaims(request, [predicate]);
  }

  // 2. The presentation: one credkit VP folding selective disclosure, the
  // range/membership claims (tier 2), the holder binding, and
  // challenge/domain into a single transcript. There is no presenter key to
  // derive and no wrapper signature to add: the VP deliberately carries NO
  // holder identifier.
  step("deriving-presentation");
  const selectivePointers = tierPointers(tier, candidate.match, predicate);
  const secretProverBlind = decodeStoredBlind(candidate);
  const linkSecret = await deriveLinkSecret(masterSecret);
  let presentation: VerifiablePresentation;
  try {
    presentation = await deriveOrRefuse(
      {
        credentials: [
          {
            verifiableCredential: candidate.vc,
            selectivePointers,
            ...(claims?.rangeClaims !== undefined ? { rangeClaims: claims.rangeClaims } : {}),
            ...(claims?.membershipClaims !== undefined
              ? { membershipClaims: claims.membershipClaims }
              : {}),
            holderBinding: { linkSecret, secretProverBlind },
          },
        ],
        challenge: request.nonce,
        domain: request.client_id,
      },
      predicate !== undefined && predicate.available
        ? [
            ...predicate.range.map((claim) => claim.description),
            ...predicate.membership.map((claim) => claim.description),
          ]
        : [],
    );
  } finally {
    linkSecret.fill(0);
  }
  inspect.emit({
    label: "Presentation derived",
    data: {
      tier,
      selectivePointers,
      ...(predicate !== undefined && predicate.available
        ? {
            ...(predicate.range.length > 0
              ? { rangeClaims: predicate.range.map((claim) => claim.description) }
              : {}),
            ...(predicate.membership.length > 0
              ? { membershipClaims: predicate.membership.map((claim) => claim.description) }
              : {}),
          }
        : {}),
      challenge: request.nonce,
      domain: request.client_id,
      holderIdentifier: "none — the presentation carries no holder key or DID",
    },
  });

  // 3. direct_post to the verifier.
  step("posting");
  const result = await directPost(request, { [opts.queryId]: [presentation] });

  return {
    presentation,
    ...(typeof result.redirect_uri === "string" && result.redirect_uri !== ""
      ? { redirectUri: result.redirect_uri }
      : {}),
  };
}

export type PresentCompositeOptions = {
  request: PresentationRequest;
  /** From {@link matchCredentials} — must be a composite request. */
  matches: MatchedRequest;
  masterSecret: Uint8Array;
  /** Aborted when the session locks. */
  signal?: AbortSignal;
  onStep?: (step: PresentationStep) => void;
};

/**
 * Run the composite presentation ceremony (MIGRATION Appendix D.5): one
 * graph VP answering EVERY credential query, statements in query order,
 * link-secret equalities proving one holder holds them all, posted under
 * the FIRST query's id (D.5.1). Same key discipline as the single-credential
 * ceremony: the master secret is snapshotted and zeroed on every exit path,
 * the ONE link secret is derived once and zeroed after proving, and the
 * lock signal is honored at each phase boundary.
 */
export async function presentComposite(
  opts: PresentCompositeOptions,
): Promise<PresentCredentialResult> {
  const step = (id: PresentationStep) => {
    opts.signal?.throwIfAborted();
    opts.onStep?.(id);
  };
  const masterSecret = opts.masterSecret.slice();
  try {
    return await runPresentComposite(opts, masterSecret, step);
  } finally {
    masterSecret.fill(0);
  }
}

async function runPresentComposite(
  opts: PresentCompositeOptions,
  masterSecret: Uint8Array,
  step: (id: PresentationStep) => void,
): Promise<PresentCredentialResult> {
  const { request } = opts;

  // The fixed plan: one statement per query, everything resolvable before
  // any network or key material is touched.
  const statements = compositeStatements(opts.matches);
  for (const statement of statements) {
    assertPresentable(statement.candidate);
  }

  // Equality references (query ids) → statement indices, by query order.
  // link_secret refs only; a path ref throws loudly (D.5.7).
  const equalities = equalityStatementGroups(request.dcql_query);
  if (equalities.length > 0) {
    const statementByQueryId = new Map(
      request.dcql_query.credentials.map((query, i) => [query.id, i]),
    );
    inspect.emit({
      label: "Equalities mapped to statements",
      data: {
        groups: request.dcql_query.vgw_equalities?.map((group) =>
          group.map((ref) => ({
            query: ref.query,
            statement: statementByQueryId.get(ref.query),
            witness: "link secret (hidden)",
          })),
        ),
      },
    });
  }

  // 1. Fetch + pin every published proof alphabet this request needs — one
  // fetch per distinct params_uri; the same document supplies range + sets.
  const proving = statements.map((statement) => statement.predicate);
  let resolved: (ResolvedProofClaims | undefined)[] = statements.map(() => undefined);
  if (proving.some((predicate) => predicate !== undefined)) {
    step("fetching-params");
    resolved = await resolveProofClaims(request, proving);
  }

  // 2. ONE graph presentation across all statements. Every statement carries
  // the SAME wallet link secret (each with its credential's own blind), so
  // the demanded equalities hold by construction.
  step("deriving-presentation");
  const blinds = statements.map((statement) => decodeStoredBlind(statement.candidate));
  const linkSecret = await deriveLinkSecret(masterSecret);
  let presentation: VerifiablePresentation;
  try {
    presentation = await deriveOrRefuse(
      {
        credentials: statements.map((statement, i) => ({
          verifiableCredential: statement.candidate.vc,
          selectivePointers: statement.pointers,
          ...(resolved[i]?.rangeClaims !== undefined
            ? { rangeClaims: resolved[i]!.rangeClaims }
            : {}),
          ...(resolved[i]?.membershipClaims !== undefined
            ? { membershipClaims: resolved[i]!.membershipClaims }
            : {}),
          holderBinding: { linkSecret, secretProverBlind: blinds[i]! },
        })),
        ...(equalities.length > 0 ? { equalities } : {}),
        challenge: request.nonce,
        domain: request.client_id,
      },
      statements.flatMap((statement) => statement.proven),
    );
  } finally {
    linkSecret.fill(0);
  }

  // The D.5.1 vp_token convention: the single graph VP answers ALL queries,
  // posted under the FIRST credential query's id.
  const postedUnder = statements[0]!.queryId;
  inspect.emit({
    label: "Composite presentation derived",
    data: {
      statements: statements.map((statement, i) => ({
        statement: i,
        queryId: statement.queryId,
        credential: statement.candidate.record.meta.name,
        selectivePointers: statement.pointers,
        proves: statement.proven,
      })),
      equalities: equalities.length,
      postedUnder,
      challenge: request.nonce,
      domain: request.client_id,
      holderIdentifier: "none — one holder proven, nobody named",
    },
  });

  // 3. direct_post to the verifier.
  step("posting");
  const result = await directPost(request, { [postedUnder]: [presentation] });

  return {
    presentation,
    ...(typeof result.redirect_uri === "string" && result.redirect_uri !== ""
      ? { redirectUri: result.redirect_uri }
      : {}),
  };
}

function describeOauthError(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)["error"] === "string"
    ) {
      const record = parsed as Record<string, unknown>;
      const description =
        typeof record["error_description"] === "string"
          ? ` — ${record["error_description"]}`
          : "";
      return `: ${String(record["error"])}${description}`;
    }
  } catch {
    // Not JSON; fall through to the raw (truncated) body.
  }
  const trimmed = body.trim();
  return trimmed === "" ? "" : `: ${trimmed.slice(0, 200)}`;
}
