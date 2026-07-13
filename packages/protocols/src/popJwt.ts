/**
 * OID4VCI proof-of-possession JWT (compact JWS, EdDSA over Ed25519).
 *
 * The wallet proves control of its pairwise did:key by signing a short-lived
 * JWT over the issuer's `c_nonce`. The issuer verifies it statelessly: the
 * public key is recovered from the `kid` (a did:key needs no registry), the
 * nonce binds the proof to a token exchange, and `iat` freshness bounds
 * replay in lieu of single-use nonce tracking (documented demo tradeoff —
 * there is no server-side session state anywhere).
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { fromBase64Url, toBase64Url, utf8 } from "@vgw/keys";
import { didKeyToEd25519PublicKey, ed25519KeyPairFromSeed } from "./didkey.js";

/** JOSE `typ` for OID4VCI key proofs — pins the JWT to this one purpose. */
export const PROOF_JWT_TYP = "openid4vci-proof+jwt";

export interface ProofJwtHeader {
  alg: "EdDSA";
  typ: typeof PROOF_JWT_TYP;
  kid: string;
}

export interface ProofJwtPayload {
  iss: string;
  aud: string;
  iat: number;
  nonce: string;
}

export interface CreateProofJwtOptions {
  /** 32-byte Ed25519 private key (the holder seed from `deriveHolderSeed`). */
  seed: Uint8Array;
  /** The credential issuer identifier (its origin). */
  audience: string;
  /** The `c_nonce` from the token response. */
  nonce: string;
  /** Unix seconds; defaults to now. Override only in tests. */
  issuedAt?: number;
}

/** Create the compact-JWS key proof the wallet sends to the credential endpoint. */
export function createProofJwt(opts: CreateProofJwtOptions): string {
  const { did, verificationMethodId } = ed25519KeyPairFromSeed(opts.seed);
  const header: ProofJwtHeader = {
    alg: "EdDSA",
    typ: PROOF_JWT_TYP,
    kid: verificationMethodId,
  };
  const payload: ProofJwtPayload = {
    iss: did,
    aud: opts.audience,
    iat: opts.issuedAt ?? Math.floor(Date.now() / 1000),
    nonce: opts.nonce,
  };
  const signingInput = `${toBase64Url(utf8(JSON.stringify(header)))}.${toBase64Url(
    utf8(JSON.stringify(payload)),
  )}`;
  const signature = ed25519.sign(utf8(signingInput), opts.seed);
  return `${signingInput}.${toBase64Url(signature)}`;
}

export interface VerifyProofJwtOptions {
  jwt: string;
  /** The issuer's own identifier — the proof must be addressed to it. */
  audience: string;
  /** The `c_nonce` the issuer minted (carried inside the access token). */
  nonce: string;
  /** Reject proofs older than this. Default 600s. */
  maxAgeSeconds?: number;
  /** Tolerated forward clock drift for `iat`. Default 300s. */
  clockSkewSeconds?: number;
}

export interface VerifiedProofJwt {
  /** The holder's pairwise did:key — becomes `credentialSubject.id`. */
  holderDid: string;
  payload: ProofJwtPayload;
}

function decodeJsonSegment(segment: string, name: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(segment)));
  } catch (cause) {
    throw new Error(`verifyProofJwt: ${name} is not base64url-encoded JSON`, {
      cause,
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verifyProofJwt: ${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Verify a key proof. Every check throws a distinct, descriptive error so
 * the issuer can return actionable `error_description`s.
 *
 * The `kid` is the sole source of the verification key; when `iss` is present
 * it must name the same DID, otherwise a stolen proof body could be re-signed
 * under an attacker key while claiming someone else's identity.
 */
export function verifyProofJwt(opts: VerifyProofJwtOptions): VerifiedProofJwt {
  const maxAgeSeconds = opts.maxAgeSeconds ?? 600;
  const clockSkewSeconds = opts.clockSkewSeconds ?? 300;

  const segments = opts.jwt.split(".");
  if (segments.length !== 3) {
    throw new Error("verifyProofJwt: expected a compact JWS with 3 segments");
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    headerSegment === "" ||
    payloadSegment === "" ||
    signatureSegment === ""
  ) {
    throw new Error("verifyProofJwt: empty JWS segment");
  }

  const header = decodeJsonSegment(headerSegment, "header");
  if (header["typ"] !== PROOF_JWT_TYP) {
    throw new Error(
      `verifyProofJwt: typ must be ${JSON.stringify(PROOF_JWT_TYP)}`,
    );
  }
  if (header["alg"] !== "EdDSA") {
    throw new Error("verifyProofJwt: alg must be EdDSA");
  }
  const kid = header["kid"];
  if (typeof kid !== "string" || kid === "") {
    throw new Error("verifyProofJwt: missing kid");
  }
  const kidDid = kid.split("#")[0] ?? "";
  // Throws if the kid's DID is not a well-formed Ed25519 did:key.
  const publicKey = didKeyToEd25519PublicKey(kidDid);

  const payload = decodeJsonSegment(payloadSegment, "payload");
  const iss = payload["iss"];
  if (iss !== undefined && iss !== kidDid) {
    throw new Error("verifyProofJwt: iss does not match kid DID");
  }

  let signature: Uint8Array;
  try {
    signature = fromBase64Url(signatureSegment);
  } catch (cause) {
    throw new Error("verifyProofJwt: signature is not valid base64url", {
      cause,
    });
  }
  const signingInput = utf8(`${headerSegment}.${payloadSegment}`);
  let signatureValid = false;
  try {
    signatureValid = ed25519.verify(signature, signingInput, publicKey);
  } catch {
    // Malformed signature/point lengths throw inside noble; treat as invalid.
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new Error("verifyProofJwt: invalid signature");
  }

  // Claims are checked only after the signature: unauthenticated data gets no
  // say in which error the caller sees.
  if (payload["aud"] !== opts.audience) {
    throw new Error("verifyProofJwt: aud mismatch");
  }
  if (payload["nonce"] !== opts.nonce) {
    throw new Error("verifyProofJwt: nonce mismatch");
  }
  const iat = payload["iat"];
  if (typeof iat !== "number" || !Number.isFinite(iat)) {
    throw new Error("verifyProofJwt: missing or non-numeric iat");
  }
  const now = Math.floor(Date.now() / 1000);
  if (iat > now + clockSkewSeconds) {
    throw new Error("verifyProofJwt: iat is in the future");
  }
  if (iat < now - maxAgeSeconds) {
    throw new Error(`verifyProofJwt: proof is older than ${maxAgeSeconds}s`);
  }

  return { holderDid: kidDid, payload: payload as unknown as ProofJwtPayload };
}
