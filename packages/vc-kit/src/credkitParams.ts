/**
 * credkit range-proof alphabets — minting, wire codec, and pinning helpers
 * (MIGRATION §8, Appendix D.3). Suite-pinned to `credkit-bbs-sha-2026` like
 * everything else in the facade; apps never import `@credkit/range` directly.
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
  octetsToRangeParams,
  rangeParamsToOctets,
  verifyRangeParams,
  type RangeParams,
} from '@credkit/range';
import { mockRandomScalars } from '@credkit/bbs';
import { credkitCiphersuite } from './keys.js';

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
// Local unpadded base64url codec (RFC 4648 §5) — deliberately dependency-free
// (vc-kit does not depend on @vgw/keys; adding a hashing/encoding package for
// two ten-line helpers would be worse).
// ---------------------------------------------------------------------------

const B64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64URL_LOOKUP: ReadonlyMap<string, number> = new Map(
  [...B64URL_ALPHABET].map((char, index) => [char, index]),
);

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function base64UrlToBytes(s: string): Uint8Array {
  if (s.length % 4 === 1) {
    throw new Error('Invalid base64url string: bad length');
  }
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let index = 0;
  for (const char of s) {
    const value = B64URL_LOOKUP.get(char);
    if (value === undefined) {
      throw new Error(`Invalid base64url character: ${JSON.stringify(char)}`);
    }
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
