/**
 * OID4VP wallet side — answer a verifier's presentation request (credkit
 * presentations since N3).
 *
 * The flow mirrors the pinned wire contract in @vgw/protocols:
 *
 *   authorization request (by value, in /present's search params)
 *   → DCQL match against the vault's credentials
 *   → user consent with a disclosure-tier choice
 *   → (tier 2) fetch + pin the verifier's published proof alphabet
 *   → credkit presentation (selective disclosure ± range claims, holder
 *     binding to the master-derived link secret; challenge = nonce,
 *     domain = client_id, folded into the proof transcript natively)
 *   → direct_post to the verifier's response_uri
 *
 * Tier semantics (the demo's privacy ladder):
 *   0 — full disclosure: one pointer at /credentialSubject reveals the whole
 *       subject. Today's status quo.
 *   1 — selective disclosure: only the claims the verifier's DCQL query
 *       matched, plus the issuer's mandatory pointers. Unlinkable across
 *       presentations.
 *   2 — predicate: a credkit CCS range proof over the HIDDEN numeric twin
 *       (`vgw_predicates` in the DCQL query) — the verifier learns one live
 *       bit against ITS OWN cutoff, never the value, and verifies the whole
 *       presentation server-side. Disclosed alongside: exactly the
 *       predicate `claim_set` (nothing at the shop; the rental desk's
 *       identity claims). No WASM, no warm-up, no proving-second waits.
 *
 * What no tier carries anymore: a presenter key. The credkit VP has no
 * `holder` property (credkit rejects one outright) — the verifier sees no
 * identifier at all, which retires the pairwise presenter DID rather than
 * rotating it.
 */

import { deriveLinkSecret, fromBase64Url, scalarFromBase64Url } from "@vgw/keys";
import {
  assertCredkitParamsDocument,
  claimPathToPointer,
  matchDcqlCredentialQuery,
  presentationRequestFromParams,
  type DcqlCredentialMatch,
  type DcqlCredentialQuery,
  type DcqlPredicates,
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
  verifyRangeParams,
  type RangeClaimRequest,
  type RangeParams,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import { inspect } from "../inspector/events";
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

export type PresentationStep = "fetching-params" | "deriving-presentation" | "posting";

/** Result of {@link parsePresentParams} — a tiny state machine for /present. */
export type PresentParams =
  | { kind: "request"; request: PresentationRequest }
  | { kind: "missing" }
  | { kind: "invalid"; reason: string };

/**
 * Read the /present route's search params. The whole unsigned authorization
 * request travels by value, so a missing `client_id` (plus friends) means
 * the page was opened without a request at all.
 */
export function parsePresentParams(searchParams: URLSearchParams): PresentParams {
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

/** What the Present page shows before the user consents. */
export interface VerifierPreview {
  request: PresentationRequest;
  verifierOrigin: string;
  /** Verifier display name from client_metadata, falling back to the origin's host. */
  verifierName: string;
}

/**
 * Describe who is asking. Pure and synchronous — the request came by value,
 * so no network round-trip happens before consent.
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

/** A stored credential that can answer the verifier's query. */
export interface CandidateCredential {
  record: CredentialRecord;
  vc: VerifiableCredential;
  /** The decrypted v3 vault envelope — carries the scalar-encoded blind. */
  payload: CredentialPayload;
  match: DcqlCredentialMatch;
}

/** The single credential query this wallet answers, with its candidates. */
export interface QueryCandidates {
  queryId: string;
  query: DcqlCredentialQuery;
  candidates: CandidateCredential[];
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

/**
 * Match the verifier's DCQL query against the vault's decrypted credentials.
 * This demo wallet answers single-credential queries (the shop and rentals
 * verifiers each ask for exactly one) — anything else fails loudly rather
 * than silently presenting less than the verifier asked for. Requests
 * carrying `vgw_equalities` (the reserved N5 cross-credential linkage) are
 * rejected loudly for the same reason: answering without the demanded
 * linkage would just fail at the verifier.
 */
export function matchCredentials(
  decrypted: { record: CredentialRecord; payload: CredentialPayload }[],
  request: PresentationRequest,
): QueryCandidates {
  if ((request.dcql_query.vgw_equalities?.length ?? 0) > 0) {
    throw new Error(
      "This verifier demands a cross-credential equality proof (vgw_equalities) — this wallet doesn't support linked presentations yet",
    );
  }
  const queries = request.dcql_query.credentials;
  const query = queries[0];
  if (query === undefined || queries.length !== 1) {
    throw new Error(
      `This wallet answers exactly one credential query per request; the verifier sent ${queries.length}`,
    );
  }
  const candidates = decrypted.flatMap(({ record, payload }) => {
    // Pre-v3 envelopes carry no credkit blind and cannot be presented — they
    // are not candidates (re-issuing at the DMV is the only path).
    if (!isPresentableEnvelope(payload)) return [];
    const match = matchDcqlCredentialQuery(payload.vc, query);
    return match === null ? [] : [{ record, vc: payload.vc, payload, match }];
  });
  return { queryId: query.id, query, candidates };
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
  /** Human-readable consent line derived from (encoder, kind, bound). */
  description: string;
  /** For `date1900` + lessOrEqual: the derived "at least N years" label. */
  years?: number;
}

/** Whether (and how) this candidate can answer the verifier's predicate request. */
export type PredicateOption =
  | {
      available: true;
      /** Where the verifier publishes its proof alphabet (same-origin enforced at fetch). */
      paramsUri: string;
      /** The requested range claims, in wire order. */
      range: PredicateRangeDescription[];
      /**
       * Everything tier 2 DISCLOSES: the pointers of the predicate
       * `claim_set` — nothing at the shop; name + license number at the
       * rentals desk. The proofs themselves disclose no value.
       */
      pointers: string[];
      /** Claim label → value for the consent preview, in claim-set order. */
      disclosed: Record<string, unknown>;
    }
  | { available: false; reason: string };

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
      description: `${label} on or after ${iso}`,
    };
  }
  return {
    pointer,
    encoder,
    kind,
    bound,
    digits,
    description: `${label} ${kind === "lessOrEqual" ? "≤" : "≥"} ${bound}`,
  };
}

/**
 * Tier 2 availability is STRUCTURAL: the verifier asked for range claims
 * (`vgw_predicates`), every claimed pointer is a twin this credential's own
 * base proof DECLARES, and every `claim_set` claim has a value to disclose.
 * Deliberately NOT checked: whether the hidden value actually satisfies the
 * bound — an underage holder must be able to attempt the proof and watch
 * the prover refuse (fail closed), not be silently pre-filtered.
 */
export function predicateOption(
  query: DcqlCredentialQuery,
  candidate: { vc: VerifiableCredential; payload: CredentialPayload },
): PredicateOption {
  const predicates: DcqlPredicates | undefined = query.vgw_predicates;
  if (predicates === undefined) {
    return { available: false, reason: "This verifier doesn't request predicate proofs." };
  }
  if ((predicates.membership?.length ?? 0) > 0) {
    return {
      available: false,
      reason:
        "The verifier asks for a set-membership proof — this wallet doesn't support membership proofs yet.",
    };
  }
  const rangeEntries = predicates.range ?? [];
  if (rangeEntries.length === 0) {
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

  const range: PredicateRangeDescription[] = [];
  for (const entry of rangeEntries) {
    const pointer = claimPathToPointer(entry.path);
    const declared = declarations.find((decl) => decl.pointer === pointer);
    if (declared === undefined) {
      const label = String(entry.path[entry.path.length - 1]);
      return {
        available: false,
        reason: `This credential declares no hidden numeric twin for "${label}" — re-issue it at the Utopia DMV to unlock predicate proofs.`,
      };
    }
    range.push(
      describeRangeClaim(pointer, declared.encoder, entry.kind, entry.bound, entry.digits),
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

  return { available: true, paramsUri: predicates.params_uri, range, pointers, disclosed };
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
    // identity claims. The range proofs ride separately and disclose nothing.
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
// Published-params pinning (MIGRATION §8, Appendix D.3)
// ---------------------------------------------------------------------------

/**
 * Alphabets that passed the full pinning ritual, keyed by `${uri}#${hash}`.
 * `verifyRangeParams` costs 2 pairings per digit — run once per alphabet,
 * remembered for the tab's lifetime (the hash key makes a rotated alphabet
 * a different entry, never a stale hit).
 */
const verifiedParamsCache = new Map<string, RangeParams>();

/**
 * Fetch and PIN the verifier's published proof alphabet. The discipline
 * (anti-tag, MIGRATION §8): same-origin with the response endpoint, the
 * SAME public artifact every holder fetches, sha256(octets) equal to BOTH
 * the document's hash and every DCQL claim's params_hash, full point
 * validation on decode, and a one-time pairing check. Any mismatch throws —
 * nothing is proven against an unpinned alphabet.
 */
async function resolveRangeParams(
  request: PresentationRequest,
  predicate: Extract<PredicateOption, { available: true }>,
): Promise<RangeParams> {
  const responseOrigin = new URL(request.response_uri).origin;
  const paramsUrl = new URL(predicate.paramsUri);
  if (paramsUrl.origin !== responseOrigin) {
    throw new Error(
      `The verifier's params_uri (${predicate.paramsUri}) is not on its own origin (${responseOrigin}) — refusing a third-party proof alphabet`,
    );
  }

  let response: Response;
  try {
    response = await fetch(paramsUrl);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Could not fetch the verifier's proof alphabet (${predicate.paramsUri}): ${detail}`,
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(
      `The verifier's proof alphabet endpoint (${predicate.paramsUri}) answered HTTP ${response.status}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`The verifier's proof alphabet (${predicate.paramsUri}) is not valid JSON`);
  }
  const document = assertCredkitParamsDocument(parsed);
  if (document.suite !== CREDKIT_CRYPTOSUITE) {
    throw new Error(
      `The verifier's proof alphabet is for cryptosuite "${document.suite}" — this wallet presents only ${CREDKIT_CRYPTOSUITE}`,
    );
  }
  if (document.range === undefined) {
    throw new Error("The verifier's proof alphabet document publishes no range params");
  }

  // THE hash: sha256 of the published octets. It must equal what the
  // document claims about itself AND what the DCQL request pinned — the
  // same value credkit embeds in the proof and the verifier restates.
  const octets = fromBase64Url(document.range.params);
  const hash = await rangeParamsHashBase64Url(octets);
  if (hash !== document.range.hash) {
    throw new Error(
      "The published proof alphabet does not match its own declared hash — refusing it",
    );
  }
  for (const claim of predicate.range) {
    // The request's params_hash values were validated as present; every one
    // must name this exact artifact.
    const requested = requestParamsHash(request, claim.pointer);
    if (requested !== hash) {
      throw new Error(
        "The verification request pins a different proof alphabet than the verifier publishes — refusing to prove against it",
      );
    }
  }
  inspect.emit({
    label: "Verifier proof alphabet fetched & hash-pinned",
    data: {
      paramsUri: predicate.paramsUri,
      suite: document.suite,
      base: document.range.base,
      hash,
      octetsBytes: octets.length,
    },
  });

  const cacheKey = `${predicate.paramsUri}#${hash}`;
  const cached = verifiedParamsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const params = rangeParamsFromBase64Url(document.range.params);
  if (params.base !== document.range.base) {
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

/** The params_hash the request pinned for the claim at `pointer`. */
function requestParamsHash(
  request: PresentationRequest,
  pointer: string,
): string | undefined {
  for (const entry of request.dcql_query.credentials[0]?.vgw_predicates?.range ?? []) {
    if (claimPathToPointer(entry.path) === pointer) return entry.params_hash;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The ceremony
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
 * Run the full presentation ceremony and direct_post the result. Mirrors
 * `acceptCredentialOffer`'s discipline: the master secret is snapshotted
 * before the first await and zeroed on every exit path, and the lock signal
 * is honored at each phase boundary.
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

  // The vault envelope must be the v3 credkit shape — anything else has no
  // blind to bind with and can only be fixed by re-issuance.
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

  // 1 (tier 2 only). Fetch + pin the verifier's PUBLISHED proof alphabet —
  // the same artifact every other holder fetches (MIGRATION §8).
  let rangeClaims: RangeClaimRequest[] | undefined;
  if (tier === 2 && predicate !== undefined && predicate.available) {
    step("fetching-params");
    const params = await resolveRangeParams(request, predicate);
    // Claims in the request's wire order — the verifier restates them
    // positionally at verification.
    rangeClaims = predicate.range.map((claim) => ({
      pointer: claim.pointer,
      kind: claim.kind,
      bound: BigInt(claim.bound),
      digits: claim.digits,
      params,
    }));
  }

  // 2. The presentation: one credkit VP folding selective disclosure, the
  // range claims (tier 2), the holder binding, and challenge/domain into a
  // single transcript. There is no presenter key to derive and no wrapper
  // signature to add: the VP deliberately carries NO holder identifier.
  step("deriving-presentation");
  const selectivePointers = tierPointers(tier, candidate.match, predicate);
  const linkSecret = await deriveLinkSecret(masterSecret);
  let secretProverBlind: bigint;
  try {
    secretProverBlind = scalarFromBase64Url(candidate.payload.secretProverBlind);
  } catch {
    linkSecret.fill(0);
    throw new Error(
      "This credential's stored blind is malformed — re-issue it at the Utopia DMV",
    );
  }
  let presentation: VerifiablePresentation;
  try {
    presentation = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: candidate.vc,
          selectivePointers,
          ...(rangeClaims !== undefined ? { rangeClaims } : {}),
          holderBinding: { linkSecret, secretProverBlind },
        },
      ],
      challenge: request.nonce,
      domain: request.client_id,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (/does not fit/.test(detail) && predicate !== undefined && predicate.available) {
      // The §9 fail-closed beat: the value does not satisfy the bound, so
      // the prover REFUSES — there is no such thing as proving a false
      // statement, only failing to prove a true one.
      const asked = predicate.range.map((claim) => claim.description).join("; ");
      inspect.emit({
        label: "Range proof refused (fail closed)",
        data: { reason: detail, requested: asked },
      });
      throw new Error(
        `The proof could not be generated: this credential's hidden value does not satisfy the verifier's bound (${asked}). ` +
          `The prover fails closed — it cannot emit a proof for a statement that isn't true. Nothing was sent.`,
        { cause },
      );
    }
    throw cause;
  } finally {
    linkSecret.fill(0);
  }
  inspect.emit({
    label: "Presentation derived",
    data: {
      tier,
      selectivePointers,
      ...(predicate !== undefined && predicate.available
        ? { rangeClaims: predicate.range.map((claim) => claim.description) }
        : {}),
      challenge: request.nonce,
      domain: request.client_id,
      holderIdentifier: "none — the presentation carries no holder key or DID",
    },
  });

  // 3. direct_post to the verifier (form-encoded, per OID4VP).
  step("posting");
  const body = new URLSearchParams({
    vp_token: JSON.stringify({ [opts.queryId]: [presentation] }),
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
