/**
 * Scalar ↔ base64url codec for the credkit `secretProverBlind`.
 *
 * The blind is a bigint scalar (credkit `Scalar`), and the vault's
 * `encryptJson` runs `JSON.stringify`, which throws on bigints — so the
 * scalar is encoded at the persistence boundary and the vault stays
 * JSON-only (MIGRATION Appendix B). Encoding reuses `@credkit/bbs`'s
 * `i2osp`/`os2ip` (the exact big-endian octet mapping the BBS spec uses)
 * rather than a hand-rolled encoder; decode fails closed on anything that is
 * not exactly 32 bytes or not a valid scalar.
 */

import { i2osp, os2ip } from "@credkit/bbs";
import { fromBase64Url, toBase64Url } from "./encoding.js";

/**
 * Order of the BLS12-381 scalar field (r) — the field credkit's BBS scalars
 * live in. `@credkit/bbs` exposes it only as `Ciphersuite.order` (behind
 * `getCiphersuite`, which drags the whole noble-curves suite construction in),
 * so the constant is pinned here and a regression test asserts equality with
 * the credkit value.
 */
export const BLS12_381_SCALAR_FIELD_ORDER =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/** Serialized scalar length in octets (credkit `Ciphersuite.scalarLength`). */
const SCALAR_LENGTH = 32;

/**
 * Encode a BLS12-381 scalar as unpadded base64url of its 32-byte big-endian
 * form (`i2osp(scalar, 32)`). Throws on negatives and on values outside the
 * scalar field — an out-of-range value could never decode back.
 */
export function scalarToBase64Url(scalar: bigint): string {
  if (scalar < 0n) {
    throw new Error("scalarToBase64Url: scalar must be non-negative");
  }
  if (scalar >= BLS12_381_SCALAR_FIELD_ORDER) {
    throw new Error(
      "scalarToBase64Url: value is not a BLS12-381 scalar (>= the field order r)",
    );
  }
  return toBase64Url(i2osp(scalar, SCALAR_LENGTH));
}

/**
 * Decode a base64url string produced by {@link scalarToBase64Url} back into a
 * bigint scalar. Fails closed: the input must decode to exactly 32 bytes and
 * to a value below the BLS12-381 scalar field order r.
 */
export function scalarFromBase64Url(s: string): bigint {
  const bytes = fromBase64Url(s);
  if (bytes.length !== SCALAR_LENGTH) {
    throw new Error(
      `scalarFromBase64Url: expected ${SCALAR_LENGTH} bytes, got ${bytes.length}`,
    );
  }
  const scalar = os2ip(bytes);
  if (scalar >= BLS12_381_SCALAR_FIELD_ORDER) {
    throw new Error(
      "scalarFromBase64Url: value is not a BLS12-381 scalar (>= the field order r)",
    );
  }
  return scalar;
}
