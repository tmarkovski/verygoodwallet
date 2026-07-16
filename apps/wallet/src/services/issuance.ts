/**
 * OID4VCI wallet side — accept a credential offer from a remote issuer over
 * the pre-authorized code flow (credkit blind issuance since N2).
 *
 * The flow mirrors the pinned wire contract in @vgw/protocols:
 *
 *   offer (by reference) → issuer metadata → token (pre-authorized code)
 *   → link-secret commitment (`createHolderBinding`) + PoP JWT signing the
 *     commitment digest (pairwise-per-issuer Ed25519 key) → blind-signed
 *     credential
 *
 * Every protocol message is emitted to the inspector drawer as it crosses the
 * wire — the drawer IS the product. Before anything is stored the wallet
 * verifies, fail-closed: subject binding (no foreign subject id), issuer
 * proof ownership, and the credkit holder RECEIPT CHECK — the whole pipeline
 * is recomputed and the issuer's blind signature verified against the
 * wallet's own link secret and this issuance's blind. Only then is the
 * credential encrypted into the vault as a versioned v3 envelope; the blind
 * is stored (not re-derivable), the link secret never is (PRF-derived).
 */

import {
  deriveIssuancePopSeed,
  deriveLinkSecret,
  encryptJson,
  previewSecret,
  scalarToBase64Url,
  toBase64Url,
} from "@vgw/keys";
import {
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  commitmentDigest,
  createProofJwt,
  ed25519KeyPairFromSeed,
  type CredentialOffer,
  type CredentialRequest,
  type CredentialResponse,
  type IssuerMetadata,
} from "@vgw/protocols";
import {
  createHolderBinding,
  verifyIssuedCredkitCredential,
  type HolderBinding,
  type VerifiableCredential,
} from "@vgw/vc-kit";
import { inspect } from "../inspector/events";
import {
  addCredential,
  type CredentialPayload,
  type CredentialRecord,
} from "./db";
import { issuerDid, metaFromCredential } from "./meta";

/**
 * The protocol phases, in execution order, with UI labels. `onStep` fires
 * with each id as the phase begins so the Offer page can render progress.
 */
export const ISSUANCE_STEPS = [
  { id: "fetching-offer", label: "Fetching the credential offer" },
  { id: "fetching-metadata", label: "Reading issuer metadata" },
  { id: "requesting-token", label: "Redeeming the pre-authorized code" },
  { id: "creating-proof", label: "Committing to the link secret & proving possession" },
  { id: "requesting-credential", label: "Requesting the blind-signed credential" },
  { id: "verifying", label: "Verifying the issuer's blind signature" },
  { id: "storing", label: "Encrypting into the vault" },
] as const;

export type IssuanceStep = (typeof ISSUANCE_STEPS)[number]["id"];

/** Result of {@link parseOfferParams} — a tiny state machine for the /offer route. */
export type OfferParams =
  | { kind: "uri"; offerUri: string }
  | { kind: "inline"; offer: CredentialOffer }
  | { kind: "missing" }
  | { kind: "invalid"; reason: string };

/**
 * Read the /offer route's search params. `credential_offer_uri` (the pinned
 * wallet_link shape) is preferred; an inline `credential_offer` JSON value is
 * also accepted so QR payloads that embed the offer directly still work.
 */
export function parseOfferParams(searchParams: URLSearchParams): OfferParams {
  const offerUri = searchParams.get("credential_offer_uri");
  if (offerUri !== null && offerUri !== "") {
    try {
      new URL(offerUri);
    } catch {
      return {
        kind: "invalid",
        reason: `credential_offer_uri is not a valid URL: ${offerUri}`,
      };
    }
    return { kind: "uri", offerUri };
  }
  const inline = searchParams.get("credential_offer");
  if (inline !== null && inline !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(inline);
    } catch {
      return { kind: "invalid", reason: "credential_offer is not valid JSON" };
    }
    try {
      return {
        kind: "inline",
        offer: assertCredentialOffer(parsed, "The inline credential_offer"),
      };
    } catch (err) {
      return {
        kind: "invalid",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { kind: "missing" };
}

/**
 * An offer, either by reference (fetched) or by value (already parsed).
 * `acceptCredentialOffer({ offerUri, ... })` is the canonical entry point;
 * the by-value form lets the Offer page reuse what it already previewed.
 */
export type OfferSource =
  | { offerUri: string; offer?: undefined }
  | { offer: CredentialOffer; offerUri?: undefined };

/**
 * True for `http://` issuers that are not local loopback — the one case where
 * the Offer page must warn: bearer tokens and the issued credential would
 * cross the network in the clear.
 */
export function isInsecureIssuerOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return true;
  }
  if (url.protocol !== "http:") return false;
  const host = url.hostname;
  return !(
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
}

/** What the Offer page shows before the user consents. */
export interface OfferPreview {
  offer: CredentialOffer;
  metadata: IssuerMetadata;
  issuerOrigin: string;
  /** Issuer display name from metadata, falling back to the origin's host. */
  issuerName: string;
  /** Credential display name from metadata, falling back to the configuration id. */
  credentialName: string;
}

/**
 * Resolve the offer and issuer metadata so the user can see who is offering
 * what BEFORE consenting. No keys are derived and nothing is signed here —
 * consent must come before any use of the wallet's key hierarchy.
 */
export async function previewCredentialOffer(
  source: OfferSource,
): Promise<OfferPreview> {
  const offer = await resolveOffer(source);
  const issuerOrigin = new URL(offer.credential_issuer).origin;
  const metadata = await fetchIssuerMetadata(offer);
  const configurationId = firstConfigurationId(offer);
  const configuration = metadata.credential_configurations_supported[configurationId];
  return {
    offer,
    metadata,
    issuerOrigin,
    issuerName: displayName(metadata.display?.[0]?.name) ?? new URL(issuerOrigin).host,
    credentialName: displayName(configuration?.display?.[0]?.name) ?? configurationId,
  };
}

/**
 * Display names come from the issuer's metadata, which assertIssuerMetadata
 * only shape-checks around the endpoints — a hostile document can put any
 * JSON here, and a non-string rendered as a React child would crash the page.
 * Only a non-empty string may reach the UI; anything else means "use the
 * caller's fallback".
 */
function displayName(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export type AcceptCredentialOfferOptions = {
  accountId: number;
  masterSecret: Uint8Array;
  vaultKey: CryptoKey;
  /**
   * Issuer metadata already fetched by {@link previewCredentialOffer} — skips
   * a redundant network round-trip (and a duplicate inspector event) when the
   * user accepts right after previewing. Still sanity-checked against the offer.
   */
  metadata?: IssuerMetadata;
  /**
   * Aborted when the session locks (the session's `lockSignal`). Locking
   * revokes the key material, so the flow stops at the next phase boundary —
   * nothing may be signed or stored on behalf of a locked session.
   */
  signal?: AbortSignal;
  onStep?: (step: IssuanceStep) => void;
} & OfferSource;

/**
 * Run the full pre-authorized code flow against a remote issuer and store the
 * received credential encrypted, exactly like the demo path: only `meta` ends
 * up in plaintext; the VC and its `secretProverBlind` live inside the vault.
 */
export async function acceptCredentialOffer(
  opts: AcceptCredentialOfferOptions,
): Promise<CredentialRecord> {
  const step = (id: IssuanceStep) => {
    // Locking mid-flight aborts the signal — stop before the next phase
    // rather than continue a ceremony whose key material was revoked.
    opts.signal?.throwIfAborted();
    opts.onStep?.(id);
  };

  // Snapshot the master secret before the first await: logout() zeroes the
  // session's buffer IN PLACE, so a mid-flight lock would otherwise turn the
  // PoP-seed and link-secret derivations below into HKDF over all-zero
  // input — keys anyone can recompute. The copy is zeroed on every exit path.
  const masterSecret = opts.masterSecret.slice();
  try {
    return await runAcceptCredentialOffer(opts, masterSecret, step);
  } finally {
    masterSecret.fill(0);
  }
}

async function runAcceptCredentialOffer(
  opts: AcceptCredentialOfferOptions,
  masterSecret: Uint8Array,
  step: (id: IssuanceStep) => void,
): Promise<CredentialRecord> {
  // 1. The offer: who is issuing, what, and under which one-time code.
  step("fetching-offer");
  const offer = await resolveOffer(opts);
  const issuerOrigin = new URL(offer.credential_issuer).origin;

  // 2. Issuer metadata names the token/credential endpoints. The metadata's
  // self-declared credential_issuer must match the offer's — a mismatch means
  // the offer points at a server that doesn't consider itself this issuer.
  step("fetching-metadata");
  const metadata = opts.metadata ?? (await fetchIssuerMetadata(offer));
  if (metadata.credential_issuer !== offer.credential_issuer) {
    throw new Error(
      `Issuer metadata claims credential_issuer "${metadata.credential_issuer}" but the offer names "${offer.credential_issuer}"`,
    );
  }

  // 3. Redeem the pre-authorized code for an access token + c_nonce.
  step("requesting-token");
  const token = await requestToken(metadata.token_endpoint, offer);

  // 4. Two derivations, two jobs (MIGRATION §3.3, §6). BINDING: the ONE
  // master-derived link secret — the same at every issuance, or credentials
  // won't link — blind-committed via createHolderBinding; the issuer signs
  // the commitment without ever seeing the secret. FRESHNESS: a pairwise
  // Ed25519 PoP key for THIS issuer only (its kid is issuer-visible, so a
  // reused key would be a cross-issuer correlation handle), whose JWT signs
  // the issuer's c_nonce AND the commitment's digest — attesting liveness of
  // a party holding this very commitment.
  step("creating-proof");
  const popSeed = await deriveIssuancePopSeed(masterSecret, issuerOrigin);
  const holder = ed25519KeyPairFromSeed(popSeed);
  inspect.emit({
    label: "Issuance PoP seed derived",
    data: {
      issuerOrigin,
      preview: await previewSecret(popSeed),
      popDid: holder.did,
    },
  });
  const linkSecret = await deriveLinkSecret(masterSecret);
  const binding = createHolderBinding({ linkSecret });
  const commitment = toBase64Url(binding.commitmentWithProof);
  const digest = await commitmentDigest(binding.commitmentWithProof);
  inspect.emit({
    label: "Link-secret commitment created",
    data: {
      scheme: "credkit blind-BBS commit (BLS12-381)",
      linkSecretPreview: await previewSecret(linkSecret),
      commitmentBytes: binding.commitmentWithProof.length,
      commitmentDigest: digest,
    },
  });
  const jwt = createProofJwt({
    seed: popSeed,
    audience: offer.credential_issuer,
    nonce: token.c_nonce,
    commitmentDigest: digest,
  });
  inspect.emit({
    label: "Proof-of-possession JWT created",
    data: {
      jwt,
      audience: offer.credential_issuer,
      nonce: token.c_nonce,
      vgw_commitment_digest: digest,
    },
  });

  // 5. Request the credential: bearer token + key proof + the commitment as
  // a request extension (the standard proof slot stays untouched — §3.3).
  step("requesting-credential");
  const request: CredentialRequest = {
    credential_configuration_id: firstConfigurationId(offer),
    proof: { proof_type: "jwt", jwt },
    vgw_holder_commitment: commitment,
  };
  const response = await requestCredential(
    metadata.credential_endpoint,
    token.access_token,
    request,
  );
  const vc = extractCredential(response, metadata.credential_endpoint);

  // 6. Fail-closed integrity checks (incl. the credkit receipt check) before
  // anything touches the vault.
  step("verifying");
  await verifyReceivedCredential(vc, holder.did, binding);

  // 7. Store the versioned v3 envelope. The blind goes INSIDE the encrypted
  // envelope, scalar-encoded (it is a bigint; JSON.stringify would throw) —
  // it is random per issuance and NOT re-derivable: losing it bricks the
  // credential. The link secret is deliberately not stored (PRF-derived).
  step("storing");
  const envelope: CredentialPayload = {
    version: 3,
    vc,
    secretProverBlind: scalarToBase64Url(binding.secretProverBlind),
  };
  const payload = await encryptJson(opts.vaultKey, envelope);
  inspect.emit({
    label: "Credential encrypted at rest",
    data: { cipher: "AES-GCM-256 (vault key)", payloadChars: payload.length },
  });
  // encryptJson awaited above: re-check the lock so nothing enters the vault
  // on behalf of a session that locked during the final encryption.
  opts.signal?.throwIfAborted();
  return addCredential({
    accountId: opts.accountId,
    meta: metaFromCredential(vc),
    payload,
  });
}

// ---------------------------------------------------------------------------
// Protocol steps
// ---------------------------------------------------------------------------

async function resolveOffer(source: OfferSource): Promise<CredentialOffer> {
  if (source.offer !== undefined) {
    // Inline offers still go through validation — they came off a URL.
    return assertCredentialOffer(source.offer, "The credential offer");
  }
  const raw = await fetchJson("the credential offer", source.offerUri);
  const offer = assertCredentialOffer(
    raw,
    `The credential offer at ${source.offerUri}`,
  );
  inspect.emit({
    label: "Credential offer received",
    data: { offerUri: source.offerUri, offer },
  });
  return offer;
}

async function fetchIssuerMetadata(offer: CredentialOffer): Promise<IssuerMetadata> {
  const url = new URL(
    "/.well-known/openid-credential-issuer",
    offer.credential_issuer,
  ).toString();
  const raw = await fetchJson("the issuer metadata document", url);
  const metadata = assertIssuerMetadata(raw, url);
  if (metadata.credential_issuer !== offer.credential_issuer) {
    throw new Error(
      `Issuer metadata at ${url} claims credential_issuer "${metadata.credential_issuer}" but the offer names "${offer.credential_issuer}"`,
    );
  }
  inspect.emit({ label: "Issuer metadata received", data: { url, metadata } });
  return metadata;
}

interface ValidatedTokenResponse {
  access_token: string;
  c_nonce: string;
}

async function requestToken(
  tokenEndpoint: string,
  offer: CredentialOffer,
): Promise<ValidatedTokenResponse> {
  // OAuth token requests are form-encoded (RFC 6749 §4); the issuer also
  // accepts JSON, but the wallet speaks the standard form.
  const body = new URLSearchParams({
    grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE,
    "pre-authorized_code": preAuthorizedCode(offer),
  });
  const raw = await fetchJson("the issuer's token endpoint", tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!isRecord(raw)) {
    throw new Error(
      `The issuer's token endpoint (${tokenEndpoint}) returned a non-object response`,
    );
  }
  const accessToken = raw["access_token"];
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new Error(
      `The issuer's token endpoint (${tokenEndpoint}) returned no access_token`,
    );
  }
  const cNonce = raw["c_nonce"];
  if (typeof cNonce !== "string" || cNonce === "") {
    throw new Error(
      `The issuer's token endpoint (${tokenEndpoint}) returned no c_nonce — the wallet cannot build a key proof without one`,
    );
  }
  inspect.emit({
    label: "Token response received",
    data: { endpoint: tokenEndpoint, response: raw },
  });
  return { access_token: accessToken, c_nonce: cNonce };
}

async function requestCredential(
  credentialEndpoint: string,
  accessToken: string,
  request: CredentialRequest,
): Promise<CredentialResponse> {
  const raw = await fetchJson(
    "the issuer's credential endpoint",
    credentialEndpoint,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
    },
  );
  inspect.emit({
    label: "Credential response received",
    data: { endpoint: credentialEndpoint, response: raw },
  });
  if (!isRecord(raw) || !Array.isArray(raw["credentials"])) {
    throw new Error(
      `The issuer's credential endpoint (${credentialEndpoint}) returned no credentials array`,
    );
  }
  return raw as unknown as CredentialResponse;
}

function extractCredential(
  response: CredentialResponse,
  credentialEndpoint: string,
): VerifiableCredential {
  const entry = response.credentials[0];
  // isRecord(entry) before entry.credential: `credentials: [null]` must be a
  // protocol error the user can read, not a TypeError from the property access.
  if (!isRecord(entry) || !isRecord(entry.credential)) {
    throw new Error(
      `The issuer's credential endpoint (${credentialEndpoint}) returned an empty or malformed credentials array`,
    );
  }
  const vc = entry.credential;
  if (vc["@context"] === undefined || vc["type"] === undefined) {
    throw new Error(
      `The issuer's credential endpoint (${credentialEndpoint}) returned something that is not a verifiable credential (missing @context/type)`,
    );
  }
  return vc as unknown as VerifiableCredential;
}

/**
 * Everything that must hold before the credential may enter the vault. Each
 * failure is a distinct, recoverable error naming exactly what didn't check
 * out — the Offer page surfaces these verbatim.
 */
async function verifyReceivedCredential(
  vc: VerifiableCredential,
  popDid: string,
  binding: HolderBinding,
): Promise<void> {
  // Subject binding: an ABSENT subject id is the expected shape — selective
  // disclosure reveals node ids structurally, so the issuer deliberately
  // omits any holder DID (holder binding is the blind-signed link secret).
  // But if a credential DOES name a subject, it must be this wallet's
  // pairwise PoP DID, or someone else's credential could be planted here.
  const subject = vc.credentialSubject;
  if (subject === undefined || Array.isArray(subject)) {
    throw new Error(
      "The received credential has no single credentialSubject to bind to this wallet",
    );
  }
  const subjectId = subject["id"];
  if (subjectId !== undefined && subjectId !== popDid) {
    throw new Error(
      `The received credential is bound to "${String(subjectId)}" instead of this wallet's DID "${popDid}" — refusing to store it`,
    );
  }

  // Issuer identity: a DID must be present (verification binds to it) and
  // the proof's verification method must belong to that DID, or the VC could
  // name one issuer while carrying an unrelated key's signature.
  const issuer = issuerDid(vc);
  if (issuer === undefined) {
    throw new Error("The received credential names no issuer DID");
  }
  // The typed `proof` field is really issuer-controlled JSON: keep only real
  // objects so `proof: null` (or null array entries) falls through to the
  // descriptive unbound-proof error below instead of a TypeError.
  const proofCandidates: unknown[] = Array.isArray(vc.proof)
    ? vc.proof
    : vc.proof !== undefined
      ? [vc.proof]
      : [];
  const proofs = proofCandidates.filter(isRecord);
  const proofBoundToIssuer = proofs.some((proof) => {
    const vm = proof["verificationMethod"];
    return typeof vm === "string" && (vm === issuer || vm.startsWith(`${issuer}#`));
  });
  if (!proofBoundToIssuer) {
    throw new Error(
      `The received credential's proof is not controlled by its declared issuer "${issuer}"`,
    );
  }

  // The credkit holder receipt check (replaces the retired opening
  // validation AND the old derive/verify roundtrip): recompute the whole
  // pipeline from the received credential and verify the issuer's blind
  // signature against the wallet's own link secret and this issuance's
  // blind. True means the credential is exactly what was requested — signed
  // by the key in its proof, bound to OUR link secret, twins intact. False
  // means it must never enter the vault.
  const receiptOk = await verifyIssuedCredkitCredential({
    verifiableCredential: vc,
    holderBinding: {
      linkSecret: binding.linkSecret,
      secretProverBlind: binding.secretProverBlind,
    },
  });
  inspect.emit({
    label: "Issuer blind signature verified (receipt check)",
    data: { verified: receiptOk, issuer, cryptosuite: "credkit-bbs-sha-2026" },
  });
  if (!receiptOk) {
    throw new Error(
      "The issuer's blind signature did not verify against this wallet's link secret — refusing to store the credential",
    );
  }
}

// ---------------------------------------------------------------------------
// Shape validation + small helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCredentialOffer(value: unknown, source: string): CredentialOffer {
  if (!isRecord(value)) {
    throw new Error(`${source} is not a JSON object`);
  }
  const issuer = value["credential_issuer"];
  if (typeof issuer !== "string" || issuer === "") {
    throw new Error(`${source} is missing credential_issuer`);
  }
  try {
    new URL(issuer);
  } catch {
    throw new Error(`${source} has an invalid credential_issuer URL: ${issuer}`);
  }
  const ids = value["credential_configuration_ids"];
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === "string" && id !== "")
  ) {
    throw new Error(`${source} lists no credential_configuration_ids`);
  }
  const grants = value["grants"];
  const grant = isRecord(grants) ? grants[PRE_AUTHORIZED_CODE_GRANT_TYPE] : undefined;
  if (
    !isRecord(grant) ||
    typeof grant["pre-authorized_code"] !== "string" ||
    grant["pre-authorized_code"] === ""
  ) {
    throw new Error(
      `${source} carries no pre-authorized_code grant — this wallet only supports the pre-authorized code flow`,
    );
  }
  return value as unknown as CredentialOffer;
}

function assertIssuerMetadata(value: unknown, url: string): IssuerMetadata {
  if (!isRecord(value)) {
    throw new Error(`The issuer metadata document (${url}) is not a JSON object`);
  }
  for (const field of ["credential_issuer", "credential_endpoint", "token_endpoint"] as const) {
    const endpoint = value[field];
    if (typeof endpoint !== "string" || endpoint === "") {
      throw new Error(`The issuer metadata document (${url}) is missing ${field}`);
    }
    try {
      new URL(endpoint);
    } catch {
      throw new Error(
        `The issuer metadata document (${url}) has an invalid ${field} URL: ${endpoint}`,
      );
    }
  }
  if (!isRecord(value["credential_configurations_supported"])) {
    throw new Error(
      `The issuer metadata document (${url}) is missing credential_configurations_supported`,
    );
  }
  return value as unknown as IssuerMetadata;
}

function preAuthorizedCode(offer: CredentialOffer): string {
  return offer.grants[PRE_AUTHORIZED_CODE_GRANT_TYPE]["pre-authorized_code"];
}

function firstConfigurationId(offer: CredentialOffer): string {
  const id = offer.credential_configuration_ids[0];
  // Unreachable after assertCredentialOffer; kept for noUncheckedIndexedAccess.
  if (id === undefined) {
    throw new Error("The credential offer lists no credential_configuration_ids");
  }
  return id;
}

/**
 * Fetch + parse JSON with errors a person can act on: every failure names
 * what was being fetched and from where, and surfaces OAuth error bodies
 * (`error`/`error_description`) when the issuer sends them.
 */
async function fetchJson(
  what: string,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not reach ${what} (${url}): ${detail}`, { cause });
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Request to ${what} (${url}) failed with HTTP ${response.status}${describeOauthError(text)}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`${what} (${url}) did not return valid JSON`, { cause });
  }
}

function describeOauthError(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (isRecord(parsed) && typeof parsed["error"] === "string") {
      const description =
        typeof parsed["error_description"] === "string"
          ? ` — ${parsed["error_description"]}`
          : "";
      return `: ${parsed["error"]}${description}`;
    }
  } catch {
    // Not JSON; fall through to the raw (truncated) body.
  }
  const trimmed = body.trim();
  return trimmed === "" ? "" : `: ${trimmed.slice(0, 200)}`;
}
