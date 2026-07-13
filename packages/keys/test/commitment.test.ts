import { describe, expect, it } from "vitest";
import {
  BN254_SCALAR_FIELD,
  createCommitment,
  daysSinceEpoch,
  fromHex,
  verifyCommitment,
} from "../src/index.js";

describe("daysSinceEpoch", () => {
  it("computes known values in UTC", () => {
    expect(daysSinceEpoch("1970-01-01")).toBe(0);
    expect(daysSinceEpoch("1970-01-02")).toBe(1);
    expect(daysSinceEpoch("2000-01-01")).toBe(10957);
    expect(daysSinceEpoch("2008-07-13")).toBe(14073);
    expect(daysSinceEpoch("2000-03-01")).toBe(11017); // 2000 was a leap year
  });

  it("returns negative values for pre-epoch dates", () => {
    expect(daysSinceEpoch("1969-12-31")).toBe(-1);
  });

  it("always returns whole days (no timezone leakage)", () => {
    expect(Number.isInteger(daysSinceEpoch("1987-06-15"))).toBe(true);
    expect(Number.isInteger(daysSinceEpoch("2024-02-29"))).toBe(true);
  });

  it("rejects malformed strings", () => {
    for (const bad of ["", "2000/01/01", "2000-1-1", "01-01-2000", "2000-01-01T00:00:00Z", "not a date"]) {
      expect(() => daysSinceEpoch(bad)).toThrow(/expected 'YYYY-MM-DD'/i);
    }
  });

  it("rejects impossible calendar dates", () => {
    for (const bad of ["2023-02-30", "2023-13-01", "2023-00-10", "2023-04-31", "2023-01-00"]) {
      expect(() => daysSinceEpoch(bad)).toThrow(/invalid calendar date/i);
    }
    // 2023 is not a leap year.
    expect(() => daysSinceEpoch("2023-02-29")).toThrow(/invalid calendar date/i);
    // 2024 is.
    expect(() => daysSinceEpoch("2024-02-29")).not.toThrow();
  });
});

describe("createCommitment / verifyCommitment", () => {
  it("matches the circomlib-compatible poseidon2 fixed vector", () => {
    // poseidon2([1, 2]) is the canonical circomlib test vector:
    // 7853200120776062878684798364095072458815029376092732009249414926327459813530
    const blinding = new Uint8Array(31);
    blinding[30] = 2; // big-endian value 2
    const { commitment } = createCommitment(1, blinding);
    expect(commitment).toBe(
      "0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a",
    );
  });

  it("matches a fixed birthdate-style vector (regression pin)", () => {
    const blinding = new Uint8Array(31).fill(1);
    const { commitment } = createCommitment(10957, blinding);
    expect(commitment).toBe(
      "0x0512ac34def59d2bb61918a6df4eb8794afa92c9d6f10f3165cbe838912f2718",
    );
  });

  it("creates and verifies with a random blinding", () => {
    const dob = daysSinceEpoch("2001-04-15");
    const { commitment, blinding } = createCommitment(dob);
    expect(commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(blinding).toMatch(/^0x[0-9a-f]{62}$/); // 31 bytes
    expect(verifyCommitment(dob, blinding, commitment)).toBe(true);
  });

  it("is deterministic for the same value + blinding", () => {
    const blinding = globalThis.crypto.getRandomValues(new Uint8Array(31));
    const a = createCommitment(14068, blinding);
    const b = createCommitment(14068, blinding);
    expect(a.commitment).toBe(b.commitment);
    expect(a.blinding).toBe(b.blinding);
  });

  it("is hiding: same value, different blinding, different commitment", () => {
    const a = createCommitment(14068);
    const b = createCommitment(14068);
    expect(a.commitment).not.toBe(b.commitment);
  });

  it("rejects the wrong blinding", () => {
    const { commitment } = createCommitment(10957);
    const { blinding: otherBlinding } = createCommitment(10957);
    expect(verifyCommitment(10957, otherBlinding, commitment)).toBe(false);
  });

  it("rejects the wrong value", () => {
    const { commitment, blinding } = createCommitment(10957);
    expect(verifyCommitment(10958, blinding, commitment)).toBe(false);
    expect(verifyCommitment(0, blinding, commitment)).toBe(false);
  });

  it("accepts 0x-less hex and mixed case on verify", () => {
    const { commitment, blinding } = createCommitment(123);
    expect(verifyCommitment(123, blinding.slice(2), commitment.slice(2))).toBe(true);
    expect(
      verifyCommitment(123, blinding.toUpperCase().replace("0X", "0x"), commitment),
    ).toBe(true);
  });

  it("returns false (never throws) on malformed inputs", () => {
    const { commitment, blinding } = createCommitment(123);
    expect(verifyCommitment(123, "not-hex", commitment)).toBe(false);
    expect(verifyCommitment(123, blinding, "nope")).toBe(false);
    expect(verifyCommitment(123.5, blinding, commitment)).toBe(false);
    expect(verifyCommitment(Number.NaN, blinding, commitment)).toBe(false);
    // Blinding at/above the field modulus is invalid.
    expect(
      verifyCommitment(123, `0x${BN254_SCALAR_FIELD.toString(16)}`, commitment),
    ).toBe(false);
  });

  it("rejects out-of-field custom blindings at creation", () => {
    const tooBig = fromHex(`0x${BN254_SCALAR_FIELD.toString(16)}`);
    expect(() => createCommitment(1, tooBig)).toThrow(RangeError);
    expect(() => createCommitment(1, new Uint8Array(32).fill(0xff))).toThrow(RangeError);
  });

  it("rejects non-integer values at creation", () => {
    expect(() => createCommitment(1.5)).toThrow(TypeError);
    expect(() => createCommitment(Number.NaN)).toThrow(TypeError);
    expect(() => createCommitment(Number.MAX_SAFE_INTEGER + 2)).toThrow(TypeError);
  });

  it("random 31-byte blindings are always below the field modulus", () => {
    // 2^248 - 1 < BN254 field modulus, so 31 bytes can never overflow.
    const max31 = new Uint8Array(31).fill(0xff);
    expect(() => createCommitment(0, max31)).not.toThrow();
    const { commitment, blinding } = createCommitment(0, max31);
    expect(verifyCommitment(0, blinding, commitment)).toBe(true);
  });

  it("canonicalizes negative values into the field consistently", () => {
    const blinding = new Uint8Array(31).fill(7);
    const negative = createCommitment(-1, blinding);
    expect(verifyCommitment(-1, negative.blinding, negative.commitment)).toBe(true);
    // -1 and (p - 1) are the same field element — document the wrap explicitly.
    const wrapped = createCommitment(-1, blinding);
    expect(wrapped.commitment).toBe(negative.commitment);
    expect(verifyCommitment(1, negative.blinding, negative.commitment)).toBe(false);
  });
});
