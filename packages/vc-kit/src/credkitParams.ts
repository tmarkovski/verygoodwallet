/**
 * credkit proof alphabets — minting, wire codec, and pinning helpers for
 * BOTH alphabet kinds: range-proof digit alphabets (MIGRATION §8, Appendix
 * D.3) and, since N5, arbitrary-set membership alphabets (D.5.5). Suite-
 * pinned to `credkit-bbs-sha-2026` like everything else in the facade; apps
 * never import `@credkit/range` directly.
 *
 * The alphabet is a verifier-signed Boneh–Boyen digit set: the verifier
 * picks a signing scalar x once, publishes y = G2·x plus one signature per
 * digit, and discards x. `createRangeParams` draws x RANDOMLY, so the same
 * verifier would serve a different alphabet per isolate/cold-start — every
 * proof would fail the paramsHash restatement. `mintSeededRangeParams`
 * settles that with a DETERMINISTIC mint: the one-time scalar derives from a
 * secret seed under an app-specific DST via the IETF `seeded_random_scalars`
 * KDF (credkit's `mockRandomScalars` — off-label name, exactly the right
 * primitive), so every isolate serves byte-identical params with zero
 * storage. The seed must stay secret: x is derivable from it, and x lets
 * anyone BB-sign out-of-alphabet digits — forging range proofs that verifier
 * alone would accept. Rotating the seed rotates the alphabet and fails
 * in-flight sessions closed.
 *
 * Holder side: consume the PUBLISHED bytes (`rangeParamsFromBase64Url` —
 * full point validation), pin `rangeParamsHashBase64Url(octets)` against
 * both the document hash and the DCQL claim's params_hash, and run
 * `verifyRangeParams` ONCE per alphabet (2 pairings per digit — cache it).
 */
import {
  createRangeParams,
  createSetParams,
  octetsToRangeParams,
  octetsToSetParams,
  rangeParamsToOctets,
  setParamsToOctets,
  verifyRangeParams,
  verifySetParams,
  type RangeParams,
  type SetMembershipParams,
} from '@credkit/range';
import { mockRandomScalars } from '@credkit/bbs';
import { credkitCiphersuite } from './keys.js';
import { base64UrlToBytes, bytesToBase64Url } from './encoding.js';

/** Options for {@link mintSeededRangeParams}. */
export interface MintSeededRangeParamsOptions {
  /** The verifier's SECRET params seed (see the module note on its trust level). */
  seed: string;
  /**
   * App-specific domain-separation tag, e.g.
   * `VGW-SHOP-CREDKIT-RANGE-PARAMS-V1` — two verifiers sharing a seed still
   * get distinct alphabets.
   */
  dst: string;
  /** Digit alphabet size (VGW age proofs use base 16, digits 4). */
  base: number;
}

/**
 * Deterministically mint a range-params alphabet from a secret seed (suite
 * pinned). Same seed + DST ⇒ byte-identical params on every call, isolate,
 * and cold start.
 */
export function mintSeededRangeParams(options: MintSeededRangeParamsOptions): RangeParams {
  const suite = credkitCiphersuite();
  return createRangeParams(suite, options.base, {
    randomScalars: mockRandomScalars(suite, options.seed, options.dst),
  });
}

/** Serialize range params to unpadded base64url of `rangeParamsToOctets`. */
export function rangeParamsToBase64Url(params: RangeParams): string {
  return bytesToBase64Url(rangeParamsToOctets(params));
}

/**
 * Decode published range params (suite pinned). Validating: every point is
 * subgroup-checked and identity-rejected; throws on anything malformed.
 * Cryptographic validity of the SIGNATURES is `verifyRangeParams`' job.
 */
export function rangeParamsFromBase64Url(encoded: string): RangeParams {
  return octetsToRangeParams(credkitCiphersuite(), base64UrlToBytes(encoded));
}

/**
 * base64url SHA-256 of a params alphabet — THE params hash everywhere: the
 * published document's `hash`, the DCQL claim's `params_hash`, and (as raw
 * bytes) the value credkit itself embeds in and checks against the wire.
 * Accepts either the serialized octets or the params object.
 */
export async function rangeParamsHashBase64Url(
  params: Uint8Array | RangeParams,
): Promise<string> {
  const octets = params instanceof Uint8Array ? params : rangeParamsToOctets(params);
  const digest = await crypto.subtle.digest('SHA-256', octets as BufferSource);
  return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * Pairing check over an imported alphabet (2 pairings per digit — run once
 * per alphabet and cache by hash, never per proof). Re-exported from
 * `@credkit/range` so callers stay behind the facade.
 */
export { verifyRangeParams };
export type { RangeParams };

// ---------------------------------------------------------------------------
// Set-membership alphabets (N5, MIGRATION Appendix D.5.5) — the same
// Boneh–Boyen construction over an ARBITRARY member set instead of the
// consecutive digit alphabet: one signature per member, published together,
// consumed verbatim by every prover. Everything in the module note applies
// unchanged: deterministic seeded mint (distinct DST per set id, so two sets
// from one seed stay distinct alphabets), secret seed, publish-once-fetch-
// same-bytes, `verifySetParams` once per import, cache by hash.
// ---------------------------------------------------------------------------

/** Options for {@link mintSeededSetParams}. */
export interface MintSeededSetParamsOptions {
  /** The verifier's SECRET params seed (same trust level as the range seed). */
  seed: string;
  /**
   * Domain-separation tag for THIS set, e.g.
   * `VGW-RENTALS-CREDKIT-SET-PARAMS-coastal-V1` — one DST per set id, so a
   * verifier minting several sets from one seed gets distinct alphabets.
   */
  dst: string;
  /**
   * The set's members as distinct scalars, in PUBLICATION order — the
   * transcript binds the order, so it is part of the alphabet's identity.
   */
  members: readonly bigint[];
}

/**
 * Deterministically mint a set-membership alphabet from a secret seed
 * (suite pinned). Same seed + DST + members ⇒ byte-identical params on
 * every call, isolate, and cold start.
 */
export function mintSeededSetParams(
  options: MintSeededSetParamsOptions,
): SetMembershipParams {
  const suite = credkitCiphersuite();
  return createSetParams(suite, options.members, {
    randomScalars: mockRandomScalars(suite, options.seed, options.dst),
  });
}

/** Serialize set params to unpadded base64url of `setParamsToOctets`. */
export function setParamsToBase64Url(params: SetMembershipParams): string {
  return bytesToBase64Url(setParamsToOctets(credkitCiphersuite(), params));
}

/**
 * Decode published set params (suite pinned). Validating: member scalars
 * are range-checked and deduplicated, every point is subgroup-checked and
 * identity-rejected; throws on anything malformed. Cryptographic validity
 * of the SIGNATURES is `verifySetParams`' job.
 */
export function setParamsFromBase64Url(encoded: string): SetMembershipParams {
  return octetsToSetParams(credkitCiphersuite(), base64UrlToBytes(encoded));
}

/**
 * base64url SHA-256 of a set alphabet — THE params hash everywhere: the
 * published document's `sets[id].hash`, the DCQL membership claim's
 * `params_hash`, and (as raw bytes) credkit's own wire
 * `membershipParamsHash`. Accepts either the serialized octets or the
 * params object.
 */
export async function setParamsHashBase64Url(
  params: Uint8Array | SetMembershipParams,
): Promise<string> {
  const octets =
    params instanceof Uint8Array
      ? params
      : setParamsToOctets(credkitCiphersuite(), params);
  const digest = await crypto.subtle.digest('SHA-256', octets as BufferSource);
  return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * Pairing check over an imported set alphabet (2 pairings per MEMBER — run
 * once per import and cache by hash, never per proof). Re-exported from
 * `@credkit/range` so callers stay behind the facade.
 */
export { verifySetParams };
export type { SetMembershipParams };

// The unpadded base64url codec lives in ./encoding.ts (shared with the
// revocation facade; still dependency-free, still internal to vc-kit).
