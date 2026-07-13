import { describe, expect, it } from "vitest";
import {
  decryptJson,
  deriveVaultKey,
  encryptJson,
  fromBase64Url,
  fromHex,
  toBase64Url,
} from "../src/index.js";

const MASTER = fromHex(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);

const key = await deriveVaultKey(MASTER);

describe("encryptJson / decryptJson", () => {
  it("round-trips JSON values of every shape", async () => {
    const values: unknown[] = [
      null,
      true,
      42,
      -0.5,
      "a string with unicode 🔑 and \"quotes\"",
      [],
      [1, "two", null],
      { nested: { deeply: { credential: "utopia-dl", tags: ["a", "b"] } } },
      {},
    ];
    for (const value of values) {
      const payload = await encryptJson(key, value);
      await expect(decryptJson(key, payload)).resolves.toEqual(value);
    }
  });

  it("produces base64url payloads of at least iv + tag length", async () => {
    const payload = await encryptJson(key, {});
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    // 12-byte IV + 16-byte GCM tag + at least "{}"
    expect(fromBase64Url(payload).length).toBeGreaterThanOrEqual(12 + 16 + 2);
  });

  it("uses a fresh random IV per call (identical plaintext, distinct payloads)", async () => {
    const a = await encryptJson(key, "same value");
    const b = await encryptJson(key, "same value");
    expect(a).not.toBe(b);
    const ivA = fromBase64Url(a).subarray(0, 12);
    const ivB = fromBase64Url(b).subarray(0, 12);
    expect(ivA).not.toEqual(ivB);
  });

  it("throws on tampered ciphertext (each byte position)", async () => {
    const payload = await encryptJson(key, { balance: 100 });
    const bytes = fromBase64Url(payload);
    // Flip one byte in the IV, in the ciphertext body, and in the GCM tag.
    for (const index of [0, 12, bytes.length - 1]) {
      const tampered = new Uint8Array(bytes);
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      await expect(decryptJson(key, toBase64Url(tampered))).rejects.toThrow();
    }
  });

  it("throws on truncated payloads", async () => {
    const payload = await encryptJson(key, "x");
    const bytes = fromBase64Url(payload);
    await expect(
      decryptJson(key, toBase64Url(bytes.subarray(0, 20))),
    ).rejects.toThrow(/too short/i);
    await expect(decryptJson(key, "")).rejects.toThrow(/too short/i);
  });

  it("throws on garbage payloads", async () => {
    await expect(decryptJson(key, "not base64url!!")).rejects.toThrow();
  });

  it("throws when decrypting with the wrong key", async () => {
    const otherMaster = new Uint8Array(MASTER);
    otherMaster[0] = (otherMaster[0] ?? 0) ^ 0xff;
    const otherKey = await deriveVaultKey(otherMaster);
    const payload = await encryptJson(key, "secret");
    await expect(decryptJson(otherKey, payload)).rejects.toThrow();
  });

  it("rejects values that are not JSON-serializable", async () => {
    await expect(encryptJson(key, undefined)).rejects.toThrow(TypeError);
    await expect(encryptJson(key, () => {})).rejects.toThrow(TypeError);
  });

  it("supports typed decryption", async () => {
    interface StoredCredential {
      id: string;
      claims: Record<string, unknown>;
    }
    const stored: StoredCredential = { id: "cred-1", claims: { age_over_18: true } };
    const payload = await encryptJson(key, stored);
    const roundTripped = await decryptJson<StoredCredential>(key, payload);
    expect(roundTripped.id).toBe("cred-1");
    expect(roundTripped.claims["age_over_18"]).toBe(true);
  });
});
