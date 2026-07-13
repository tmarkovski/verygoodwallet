import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { fromHex, toHex } from "@vgw/keys";
import { didKeyToEd25519PublicKey, ed25519KeyPairFromSeed } from "./didkey.js";

// Pinned cross-implementation vector: if the multicodec prefix, base58
// alphabet, or noble's key derivation ever drift, this exact string breaks.
const SEED = fromHex(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);
const EXPECTED_DID = "did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd";
const EXPECTED_PUBLIC_KEY_HEX =
  "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";

describe("ed25519KeyPairFromSeed", () => {
  it("matches the pinned did:key vector", () => {
    const { publicKey, did, verificationMethodId } = ed25519KeyPairFromSeed(SEED);
    expect(toHex(publicKey)).toBe(EXPECTED_PUBLIC_KEY_HEX);
    expect(did).toBe(EXPECTED_DID);
    expect(verificationMethodId).toBe(
      `${EXPECTED_DID}#${EXPECTED_DID.slice("did:key:".length)}`,
    );
  });

  it("matches the RFC 8032 TEST 1 public key", () => {
    const { publicKey, did } = ed25519KeyPairFromSeed(
      fromHex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"),
    );
    expect(toHex(publicKey)).toBe(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    );
    expect(did).toBe("did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw");
  });

  it("is deterministic and pairwise (different seeds, different DIDs)", () => {
    const other = new Uint8Array(SEED);
    other[0] = (other[0] ?? 0) ^ 0x01;
    expect(ed25519KeyPairFromSeed(SEED).did).toBe(ed25519KeyPairFromSeed(SEED).did);
    expect(ed25519KeyPairFromSeed(other).did).not.toBe(EXPECTED_DID);
  });

  it("rejects seeds that are not 32 bytes", () => {
    expect(() => ed25519KeyPairFromSeed(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => ed25519KeyPairFromSeed(new Uint8Array(0))).toThrow(/32 bytes/);
    expect(() => ed25519KeyPairFromSeed(new Uint8Array(64))).toThrow(/32 bytes/);
  });
});

describe("didKeyToEd25519PublicKey", () => {
  it("round-trips the generated did:key", () => {
    const { publicKey, did } = ed25519KeyPairFromSeed(SEED);
    expect(didKeyToEd25519PublicKey(did)).toEqual(publicKey);
  });

  it("rejects non-did:key identifiers", () => {
    expect(() => didKeyToEd25519PublicKey("did:web:example.com")).toThrow(
      /expected a did:key/,
    );
    expect(() => didKeyToEd25519PublicKey("")).toThrow(/expected a did:key/);
  });

  it("rejects non-base58btc multibase prefixes", () => {
    // 'u' would be multibase base64url — only 'z' (base58btc) is valid here.
    expect(() => didKeyToEd25519PublicKey("did:key:uAAAA")).toThrow(/z/);
  });

  it("rejects invalid base58 characters", () => {
    // 0, O, I, l are excluded from the base58 alphabet.
    expect(() => didKeyToEd25519PublicKey("did:key:z0OIl")).toThrow(/base58/);
  });

  it("rejects a non-ed25519 multicodec prefix", () => {
    // 0xec 0x01 is x25519-pub: right shape, wrong key type.
    const x25519 = new Uint8Array([0xec, 0x01, ...new Uint8Array(32)]);
    expect(() =>
      didKeyToEd25519PublicKey(`did:key:z${base58.encode(x25519)}`),
    ).toThrow(/multicodec/);
  });

  it("rejects truncated and oversized key bytes", () => {
    const short = new Uint8Array([0xed, 0x01, ...new Uint8Array(16)]);
    const long = new Uint8Array([0xed, 0x01, ...new Uint8Array(33)]);
    expect(() =>
      didKeyToEd25519PublicKey(`did:key:z${base58.encode(short)}`),
    ).toThrow(/32-byte/);
    expect(() =>
      didKeyToEd25519PublicKey(`did:key:z${base58.encode(long)}`),
    ).toThrow(/32-byte/);
  });
});
