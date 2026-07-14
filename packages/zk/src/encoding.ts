/**
 * Field-element encoding shared by the prover and verifier wrappers: both
 * sides must serialize public inputs byte-identically, or the same statement
 * would hash to different transcripts.
 */

import { BN254_SCALAR_FIELD } from "@vgw/keys";

const HEX_STRING = /^(0x)?[0-9a-fA-F]{1,64}$/;

/** Canonical public-input form: `0x` + 64 lowercase hex chars (32 bytes). */
export function fieldHex(value: bigint | number): string {
  const big = typeof value === "number" ? BigInt(value) : value;
  if (big < 0n || big >= BN254_SCALAR_FIELD) {
    throw new RangeError(`fieldHex: value out of the BN254 scalar field: ${big}`);
  }
  return `0x${big.toString(16).padStart(64, "0")}`;
}

/** Parse a `0x`-optional hex field element into canonical form. Throws on junk. */
export function normalizeFieldHex(hex: string): string {
  if (typeof hex !== "string" || !HEX_STRING.test(hex)) {
    throw new Error(`Not a hex field element: ${JSON.stringify(hex)}`);
  }
  const big = BigInt(hex.startsWith("0x") || hex.startsWith("0X") ? hex : `0x${hex}`);
  return fieldHex(big);
}
