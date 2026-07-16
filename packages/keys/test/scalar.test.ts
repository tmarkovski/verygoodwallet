import { describe, expect, it } from "vitest";
import { getCiphersuite, SUITE_BY_FIXTURE_DIR, i2osp } from "@credkit/bbs";
import {
  BLS12_381_SCALAR_FIELD_ORDER,
  scalarFromBase64Url,
  scalarToBase64Url,
  toBase64Url,
} from "../src/index.js";

const r = BLS12_381_SCALAR_FIELD_ORDER;

describe("BLS12_381_SCALAR_FIELD_ORDER", () => {
  it("equals the order credkit's pinned sha-2026-era ciphersuite reports", () => {
    // The constant is pinned locally so this module never drags noble-curves
    // suite construction in; this pin is what keeps it honest against credkit.
    expect(r).toBe(getCiphersuite(SUITE_BY_FIXTURE_DIR["bls12-381-sha-256"]).order);
  });
});

describe("scalarToBase64Url / scalarFromBase64Url", () => {
  it("round-trips scalars across the whole field", () => {
    for (const scalar of [0n, 1n, 2n ** 128n + 12345n, r - 1n]) {
      const encoded = scalarToBase64Url(scalar);
      expect(typeof encoded).toBe("string");
      expect(scalarFromBase64Url(encoded)).toBe(scalar);
    }
  });

  it("always encodes to exactly 32 bytes (43 unpadded base64url chars)", () => {
    expect(scalarToBase64Url(1n)).toHaveLength(43);
    expect(scalarToBase64Url(r - 1n)).toHaveLength(43);
  });

  it("encode rejects negatives and values >= the field order r", () => {
    expect(() => scalarToBase64Url(-1n)).toThrow(/non-negative/);
    expect(() => scalarToBase64Url(r)).toThrow(/field order/);
    expect(() => scalarToBase64Url(r + 1n)).toThrow(/field order/);
  });

  it("decode rejects inputs that are not exactly 32 bytes", () => {
    expect(() => scalarFromBase64Url(toBase64Url(new Uint8Array(31)))).toThrow(
      /expected 32 bytes, got 31/,
    );
    expect(() => scalarFromBase64Url(toBase64Url(new Uint8Array(33)))).toThrow(
      /expected 32 bytes, got 33/,
    );
    expect(() => scalarFromBase64Url("")).toThrow(/expected 32 bytes/);
  });

  it("decode rejects 32-byte values >= the field order r", () => {
    expect(() => scalarFromBase64Url(toBase64Url(i2osp(r, 32)))).toThrow(
      /field order/,
    );
    // All-ones is far above r — the classic “random 32 bytes are not a scalar”.
    expect(() =>
      scalarFromBase64Url(toBase64Url(new Uint8Array(32).fill(0xff))),
    ).toThrow(/field order/);
    // The largest valid scalar still decodes.
    expect(scalarFromBase64Url(toBase64Url(i2osp(r - 1n, 32)))).toBe(r - 1n);
  });

  it("decode rejects non-base64url input", () => {
    expect(() => scalarFromBase64Url("not/valid+base64")).toThrow();
  });
});
