/**
 * HKDF-SHA-256 via native WebCrypto (`globalThis.crypto.subtle`).
 *
 * All wallet key derivation flows through this single primitive so that the
 * derivation is auditable in one place: HKDF with a fixed 32-byte zero salt
 * and a domain-separation `info` string per branch.
 */

import { utf8 } from "./encoding.js";

/** Fixed HKDF salt: 32 zero bytes. Domain separation comes from `info`, not the salt. */
const ZERO_SALT = new Uint8Array(32);

/**
 * Derive `length` bytes from `ikm` using HKDF-SHA-256 with a 32-byte zero
 * salt and the given `info` domain-separation string.
 */
export async function hkdfDerive(
  ikm: Uint8Array,
  info: string,
  length = 32,
): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ZERO_SALT,
      info: utf8(info) as BufferSource,
    },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}
