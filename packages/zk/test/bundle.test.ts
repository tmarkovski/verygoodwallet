import { describe, expect, it } from "vitest";
import { toBase64Url } from "@vgw/keys";
import { assertAgeProofBundle } from "../src/bundle.js";
import { fieldHex, normalizeFieldHex } from "../src/encoding.js";

const validBundle = () => ({
  scheme: "noir-ultrahonk",
  circuit: "vgw-age-check-v1",
  years: 18,
  cutoffDays: 14073,
  commitment: "0x1bfcce1ef910a81af7ab624ca61296ab94eb642bf1936a80c580ca18a4067980",
  proof: toBase64Url(new Uint8Array(14656).fill(7)),
});

describe("assertAgeProofBundle", () => {
  it("accepts a valid bundle and decodes the proof", () => {
    const { bundle, proofBytes } = assertAgeProofBundle(validBundle());
    expect(bundle.years).toBe(18);
    expect(proofBytes.length).toBe(14656);
  });

  it("normalizes an un-prefixed commitment to canonical 0x form", () => {
    const raw = validBundle();
    raw.commitment = raw.commitment.slice(2).toUpperCase();
    const { bundle } = assertAgeProofBundle(raw);
    expect(bundle.commitment).toBe(validBundle().commitment);
  });

  it.each([
    ["scheme", { scheme: "groth16" }, /scheme/],
    ["circuit", { circuit: "other-circuit" }, /circuit/],
    ["years", { years: 0 }, /years/],
    ["years", { years: "18" }, /years/],
    ["cutoffDays", { cutoffDays: -1 }, /cutoffDays/],
    ["cutoffDays", { cutoffDays: 1.5 }, /cutoffDays/],
    ["commitment", { commitment: "not-hex" }, /commitment/],
    ["proof", { proof: "" }, /proof/],
    ["proof", { proof: "!!!" }, /proof/],
  ])("rejects a bad %s", (_name, patch, message) => {
    expect(() => assertAgeProofBundle({ ...validBundle(), ...patch })).toThrow(message);
  });

  it("rejects implausibly small and large proofs", () => {
    expect(() =>
      assertAgeProofBundle({ ...validBundle(), proof: toBase64Url(new Uint8Array(10)) }),
    ).toThrow(/implausible size/);
    expect(() =>
      assertAgeProofBundle({
        ...validBundle(),
        proof: toBase64Url(new Uint8Array(300_000)),
      }),
    ).toThrow(/implausible size/);
  });

  it("rejects non-objects", () => {
    expect(() => assertAgeProofBundle(null)).toThrow(/object/);
    expect(() => assertAgeProofBundle([])).toThrow(/object/);
    expect(() => assertAgeProofBundle("proof")).toThrow(/object/);
  });
});

describe("field encoding", () => {
  it("round-trips through canonical form", () => {
    expect(fieldHex(0x36f9)).toBe(`0x${"36f9".padStart(64, "0")}`);
    expect(normalizeFieldHex("36F9")).toBe(fieldHex(0x36f9));
    expect(normalizeFieldHex(fieldHex(123n))).toBe(fieldHex(123n));
  });

  it("rejects out-of-field and malformed values", () => {
    expect(() => fieldHex(-1n)).toThrow(/out of/);
    expect(() => normalizeFieldHex("0x" + "f".repeat(64))).toThrow(/out of/);
    expect(() => normalizeFieldHex("xyz")).toThrow(/hex/);
    expect(() => normalizeFieldHex("0x" + "a".repeat(65))).toThrow(/hex/);
  });
});
