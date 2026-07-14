/**
 * Poseidon birthdate commitment for the ZK tier (M4).
 *
 * `commitment = Poseidon2(value, blinding)` over the BN254 scalar field, via
 * `poseidon-lite` (circomlib-compatible constants). The issuer signs the
 * commitment into the credential; the wallet keeps the opening (value +
 * blinding) privately in the vault; the Noir circuit later proves statements
 * like `value <= cutoff` against the commitment without revealing the value.
 *
 * IMPORTANT: the Noir circuit MUST use a circomlib-compatible Poseidon
 * implementation, or its hashes will not match commitments produced here.
 */

// The arity-2 subpath, NOT the package root: poseidon-lite is CommonJS with
// no sideEffects marker, so bundlers keep the root's re-export of every
// arity's round constants (~400 KB) in whatever chunk imports it.
import { poseidon2 } from "poseidon-lite/poseidon2";
import { toHex } from "./encoding.js";

/** BN254 (alt_bn128) scalar field modulus — the field circomlib Poseidon operates over. */
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HEX_STRING = /^(0x)?[0-9a-fA-F]+$/;

/**
 * Days since the Unix epoch for a `'YYYY-MM-DD'` date, computed in UTC.
 * `'1970-01-01'` → 0, `'1970-01-02'` → 1, `'2000-01-01'` → 10957.
 * Dates before 1970 yield negative values. Throws on malformed strings and
 * impossible calendar dates (e.g. `'2023-02-30'`).
 */
export function daysSinceEpoch(isoDate: string): number {
  const match = ISO_DATE.exec(isoDate);
  if (!match) {
    throw new Error(`daysSinceEpoch: expected 'YYYY-MM-DD', got ${JSON.stringify(isoDate)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`daysSinceEpoch: invalid calendar date ${JSON.stringify(isoDate)}`);
  }
  return ms / MS_PER_DAY;
}

export interface CommitmentResult {
  /** `0x`-prefixed, 64-hex-char (32-byte, zero-padded) Poseidon commitment. */
  commitment: string;
  /** `0x`-prefixed hex of the blinding factor bytes. Store privately in the vault. */
  blinding: string;
}

/** Canonicalize an integer into the BN254 scalar field (negative values wrap). */
function toField(value: bigint): bigint {
  const reduced = value % BN254_SCALAR_FIELD;
  return reduced < 0n ? reduced + BN254_SCALAR_FIELD : reduced;
}

/** Big-endian bytes → bigint. */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const byte of bytes) {
    out = (out << 8n) | BigInt(byte);
  }
  return out;
}

/** Parse a `0x`-optional hex string into a bigint. Throws on invalid input. */
function hexToBigInt(hexString: string): bigint {
  if (!HEX_STRING.test(hexString)) {
    throw new Error(`Invalid hex string: ${JSON.stringify(hexString)}`);
  }
  return BigInt(hexString.startsWith("0x") || hexString.startsWith("0X")
    ? hexString
    : `0x${hexString}`);
}

function toFieldHex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

/**
 * Create a Poseidon commitment to an integer value (typically a birthdate as
 * days since epoch): `poseidon2([value, blinding])`.
 *
 * When `blinding` is omitted, 31 random bytes are drawn — always below the
 * BN254 field modulus (2^248 - 1 < p). A supplied blinding must interpret
 * (big-endian) to a value below the field modulus.
 */
export function createCommitment(
  value: number,
  blinding?: Uint8Array,
): CommitmentResult {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`createCommitment: value must be a safe integer, got ${value}`);
  }
  const blindingBytes =
    blinding ?? globalThis.crypto.getRandomValues(new Uint8Array(31));
  const blindingField = bytesToBigInt(blindingBytes);
  if (blindingField >= BN254_SCALAR_FIELD) {
    throw new RangeError(
      "createCommitment: blinding must be below the BN254 scalar field modulus",
    );
  }
  const commitment = poseidon2([toField(BigInt(value)), blindingField]);
  return {
    commitment: toFieldHex(commitment),
    blinding: `0x${toHex(blindingBytes)}`,
  };
}

/**
 * Verify that `commitment` opens to `value` under `blinding` (both hex
 * strings as returned by {@link createCommitment}). Returns `false` — never
 * throws — on any mismatch or malformed input.
 */
export function verifyCommitment(
  value: number,
  blinding: string,
  commitment: string,
): boolean {
  try {
    if (!Number.isSafeInteger(value)) return false;
    const blindingField = hexToBigInt(blinding);
    if (blindingField >= BN254_SCALAR_FIELD) return false;
    const expected = poseidon2([toField(BigInt(value)), blindingField]);
    return expected === hexToBigInt(commitment);
  } catch {
    return false;
  }
}
