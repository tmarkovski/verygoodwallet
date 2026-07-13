/**
 * OID4VP wallet side — answer a verifier's presentation request (milestone
 * M3, the shop age gate).
 *
 * The flow mirrors the pinned wire contract in @vgw/protocols:
 *
 *   authorization request (by value, in /present's search params)
 *   → DCQL match against the vault's credentials
 *   → user consent with a disclosure-tier choice
 *   → pairwise presenter key (per-verifier HKDF branch) → BBS derived proof
 *   → signed presentation (challenge = nonce, domain = client_id)
 *   → direct_post to the verifier's response_uri
 *
 * Tier semantics (the demo's privacy ladder):
 *   0 — full disclosure: one pointer at /credentialSubject reveals the whole
 *       subject, including the issuer-pairwise subject id (a correlation
 *       handle verifiers could collude on). Today's status quo.
 *   1 — selective disclosure: only the claims the verifier's DCQL query
 *       matched, plus the issuer's mandatory pointers. Unlinkable across
 *       presentations.
 *   2 — ZK predicate: not yet (milestone M4); the consent UI shows it
 *       disabled rather than pretending.
 */

import { derivePresenterSeed, previewSecret } from "@vgw/keys";
import {
  matchDcqlCredentialQuery,
  presentationRequestFromParams,
  type DcqlCredentialMatch,
  type DcqlCredentialQuery,
  type DirectPostResult,
  type PresentationRequest,
} from "@vgw/protocols";
import {
  deriveCredential,
  generateEd25519KeyPair,
  signPresentation,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import { inspect } from "../inspector/events";
import type { CredentialRecord } from "./db";

/**
 * The protocol phases, in execution order, with UI labels. `onStep` fires
 * with each id as the phase begins so the Present page can render progress.
 */
export const PRESENTATION_STEPS = [
  { id: "deriving-presenter", label: "Deriving a pairwise presenter key" },
  { id: "deriving-disclosure", label: "Deriving the selective disclosure" },
  { id: "signing-presentation", label: "Signing the presentation" },
  { id: "posting", label: "Sending it to the verifier" },
] as const;

export type PresentationStep = (typeof PRESENTATION_STEPS)[number]["id"];

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
  match: DcqlCredentialMatch;
}

/** The single credential query this wallet answers, with its candidates. */
export interface QueryCandidates {
  queryId: string;
  query: DcqlCredentialQuery;
  candidates: CandidateCredential[];
}

/**
 * Match the verifier's DCQL query against the vault's decrypted credentials.
 * This demo wallet answers single-credential queries (the shop and rentals
 * verifiers each ask for exactly one) — anything else fails loudly rather
 * than silently presenting less than the verifier asked for.
 */
export function matchCredentials(
  decrypted: { record: CredentialRecord; vc: VerifiableCredential }[],
  request: PresentationRequest,
): QueryCandidates {
  const queries = request.dcql_query.credentials;
  const query = queries[0];
  if (query === undefined || queries.length !== 1) {
    throw new Error(
      `This wallet answers exactly one credential query per request; the verifier sent ${queries.length}`,
    );
  }
  const candidates = decrypted.flatMap(({ record, vc }) => {
    const match = matchDcqlCredentialQuery(vc, query);
    return match === null ? [] : [{ record, vc, match }];
  });
  return { queryId: query.id, query, candidates };
}

export type DisclosureTier = 0 | 1;

/** The bbs-2023 selective pointers a tier would disclose. */
export function tierPointers(tier: DisclosureTier, match: DcqlCredentialMatch): string[] {
  if (tier === 0) {
    // One subtree pointer = the whole credentialSubject, id included.
    return ["/credentialSubject"];
  }
  return match.claims.map((claim) => claim.pointer);
}

/**
 * True when the credential embeds a subject identifier. Credentials issued
 * before the unlinkable-by-default change carry one, and bbs-2023 reveals
 * node ids structurally — so EVERY tier disclosing subject claims reveals
 * it. The consent screen must say so.
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
): Record<string, unknown> {
  const subject = vc.credentialSubject;
  const disclosed: Record<string, unknown> = {};
  // An embedded subject id rides along in every derived proof (structural
  // node-id disclosure) — list it truthfully regardless of tier.
  if (subject !== undefined && !Array.isArray(subject) && typeof subject["id"] === "string") {
    disclosed["subject id"] = subject["id"];
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
  /** The signed presentation, for the "what was shared" recap. */
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

  // 1. Pairwise presenter key for THIS verifier only — a different DID at
  // every verifier, so presentations cannot be correlated by key.
  step("deriving-presenter");
  const verifierOrigin = new URL(request.response_uri).origin;
  const presenterSeed = await derivePresenterSeed(masterSecret, verifierOrigin);
  let presenter;
  try {
    presenter = await generateEd25519KeyPair(presenterSeed);
    inspect.emit({
      label: "Presenter seed derived",
      data: {
        verifierOrigin,
        preview: await previewSecret(presenterSeed),
        presenterDid: presenter.controller,
      },
    });
  } finally {
    presenterSeed.fill(0);
  }

  // 2. The disclosure: a bbs-2023 derived proof revealing exactly the
  // tier's pointers (plus the issuer's mandatory ones). Each derivation is
  // unlinkable to every other derivation of the same credential.
  step("deriving-disclosure");
  const selectivePointers = tierPointers(tier, candidate.match);
  const derived = await deriveCredential({
    verifiableCredential: candidate.vc,
    selectivePointers,
  });
  inspect.emit({
    label: "Selective disclosure derived",
    data: { tier, selectivePointers },
  });

  // 3. The presentation wrapper, signed by the presenter key over the
  // verifier's nonce (challenge) and identifier (domain) — replay armor.
  step("signing-presentation");
  const presentation = await signPresentation({
    credentials: [derived],
    keyPair: presenter,
    challenge: request.nonce,
    domain: request.client_id,
  });
  inspect.emit({
    label: "Presentation signed",
    data: { challenge: request.nonce, domain: request.client_id, presentation },
  });

  // 4. direct_post to the verifier (form-encoded, per OID4VP).
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
