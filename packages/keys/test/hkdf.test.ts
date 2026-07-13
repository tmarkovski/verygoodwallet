import { describe, expect, it } from "vitest";
import { fromHex, hkdfDerive, toHex } from "../src/index.js";

/** Fixed 32-byte master: 00 01 02 ... 1f. */
const MASTER = fromHex(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);

describe("hkdfDerive", () => {
  it("matches the fixed test vector (regression pin)", async () => {
    // HKDF-SHA-256, salt = 32 zero bytes, info = "vgw/v1/vault", L = 32.
    // Pinned so any change to salt/info/hash handling is caught.
    const out = await hkdfDerive(MASTER, "vgw/v1/vault");
    expect(toHex(out)).toBe(
      "4c4e5cfced08c47be3a3e9a876a1d2efb2ab271c692ed825c5e088034493c1ae",
    );
  });

  it("is deterministic for the same ikm + info", async () => {
    const a = await hkdfDerive(MASTER, "vgw/v1/holder:https://example.com");
    const b = await hkdfDerive(MASTER, "vgw/v1/holder:https://example.com");
    expect(toHex(a)).toBe(toHex(b));
  });

  it("produces different output for different info strings", async () => {
    const a = await hkdfDerive(MASTER, "info-a");
    const b = await hkdfDerive(MASTER, "info-b");
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("produces different output for different ikm", async () => {
    const otherMaster = new Uint8Array(MASTER);
    otherMaster[0] = (otherMaster[0] ?? 0) ^ 0xff;
    const a = await hkdfDerive(MASTER, "vgw/v1/vault");
    const b = await hkdfDerive(otherMaster, "vgw/v1/vault");
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("defaults to 32 bytes and honors the length parameter", async () => {
    expect((await hkdfDerive(MASTER, "x")).length).toBe(32);
    expect((await hkdfDerive(MASTER, "x", 16)).length).toBe(16);
    expect((await hkdfDerive(MASTER, "x", 64)).length).toBe(64);
  });

  it("longer outputs extend (not replace) shorter ones (HKDF expand property)", async () => {
    const short = await hkdfDerive(MASTER, "vgw/v1/vault", 32);
    const long = await hkdfDerive(MASTER, "vgw/v1/vault", 64);
    expect(toHex(long.subarray(0, 32))).toBe(toHex(short));
  });
});
