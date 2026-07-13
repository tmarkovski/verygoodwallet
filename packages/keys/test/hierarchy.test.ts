import { describe, expect, it } from "vitest";
import {
  HOLDER_INFO_PREFIX,
  PRESENTER_INFO_PREFIX,
  PRF_EVAL_INPUT,
  VAULT_INFO,
  decryptJson,
  deriveHolderSeed,
  derivePresenterSeed,
  deriveVaultKey,
  describeHierarchy,
  encryptJson,
  fromHex,
  hkdfDerive,
  holderInfo,
  presenterInfo,
  previewSecret,
  toHex,
} from "../src/index.js";

const MASTER = fromHex(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);

const DMV = "https://dmv.verygoodwallet.com";
const SHOP = "https://shop.verygoodwallet.com";

describe("domain-separation constants", () => {
  it("are exactly the protocol-mandated strings", () => {
    expect(PRF_EVAL_INPUT).toBe("vgw/v1/master-secret");
    expect(VAULT_INFO).toBe("vgw/v1/vault");
    expect(HOLDER_INFO_PREFIX).toBe("vgw/v1/holder:");
    expect(PRESENTER_INFO_PREFIX).toBe("vgw/v1/presenter:");
    expect(holderInfo(DMV)).toBe(`vgw/v1/holder:${DMV}`);
    expect(presenterInfo(SHOP)).toBe(`vgw/v1/presenter:${SHOP}`);
  });
});

describe("deriveHolderSeed / derivePresenterSeed", () => {
  it("match fixed test vectors (regression pin)", async () => {
    expect(toHex(await deriveHolderSeed(MASTER, DMV))).toBe(
      "f4197dddffb8ad0c30821cd6331ce0c51e1d62b05cc79bcd28a7e57ebe59c4db",
    );
    expect(toHex(await derivePresenterSeed(MASTER, SHOP))).toBe(
      "51bf08b2612ad66c37a31f7ad6b88752d33e44cba1f9eb35ce2d340664de698c",
    );
  });

  it("are deterministic", async () => {
    const a = await deriveHolderSeed(MASTER, DMV);
    const b = await deriveHolderSeed(MASTER, DMV);
    expect(toHex(a)).toBe(toHex(b));
  });

  it("are 32 bytes", async () => {
    expect((await deriveHolderSeed(MASTER, DMV)).length).toBe(32);
    expect((await derivePresenterSeed(MASTER, SHOP)).length).toBe(32);
  });

  it("differ across origins (pairwise separation)", async () => {
    const dmv = await deriveHolderSeed(MASTER, DMV);
    const other = await deriveHolderSeed(MASTER, "https://other-issuer.example");
    expect(toHex(dmv)).not.toBe(toHex(other));

    const shop = await derivePresenterSeed(MASTER, SHOP);
    const rentals = await derivePresenterSeed(
      MASTER,
      "https://rentals.verygoodwallet.com",
    );
    expect(toHex(shop)).not.toBe(toHex(rentals));
  });

  it("differ across branches for the same origin (holder vs presenter)", async () => {
    const holder = await deriveHolderSeed(MASTER, DMV);
    const presenter = await derivePresenterSeed(MASTER, DMV);
    expect(toHex(holder)).not.toBe(toHex(presenter));
  });

  it("differ from the vault branch", async () => {
    const vaultBytes = await hkdfDerive(MASTER, VAULT_INFO);
    const holder = await deriveHolderSeed(MASTER, DMV);
    expect(toHex(vaultBytes)).not.toBe(toHex(holder));
  });
});

describe("deriveVaultKey", () => {
  it("returns a non-extractable AES-GCM-256 key with encrypt/decrypt usages", async () => {
    const key = await deriveVaultKey(MASTER);
    expect(key.type).toBe("secret");
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect([...key.usages].sort()).toEqual(["decrypt", "encrypt"]);
  });

  it("derives the same key material across calls (roundtrip across instances)", async () => {
    const keyA = await deriveVaultKey(MASTER);
    const keyB = await deriveVaultKey(MASTER);
    const payload = await encryptJson(keyA, { hello: "vault" });
    await expect(decryptJson(keyB, payload)).resolves.toEqual({ hello: "vault" });
  });

  it("derives different keys from different masters", async () => {
    const otherMaster = new Uint8Array(MASTER);
    otherMaster[31] = (otherMaster[31] ?? 0) ^ 0x01;
    const keyA = await deriveVaultKey(MASTER);
    const keyB = await deriveVaultKey(otherMaster);
    const payload = await encryptJson(keyA, "secret");
    await expect(decryptJson(keyB, payload)).rejects.toThrow();
  });
});

describe("previewSecret", () => {
  it("returns the first 8 hex chars of SHA-256 (fixed vector)", async () => {
    // SHA-256(00 01 ... 1f) starts with 630dcd29...
    expect(await previewSecret(MASTER)).toBe("630dcd29");
  });

  it("is 8 lowercase hex characters and never contains the raw secret", async () => {
    const secret = fromHex("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    const preview = await previewSecret(secret);
    expect(preview).toMatch(/^[0-9a-f]{8}$/);
    expect(toHex(secret)).not.toContain(preview);
  });

  it("differs for different secrets", async () => {
    const a = await previewSecret(fromHex("00"));
    const b = await previewSecret(fromHex("01"));
    expect(a).not.toBe(b);
  });
});

describe("describeHierarchy", () => {
  const origins = {
    issuerOrigins: [DMV],
    verifierOrigins: [SHOP, "https://rentals.verygoodwallet.com"],
  };

  it("returns the full tree structure without a master (no previews)", async () => {
    const tree = await describeHierarchy(origins);
    expect(tree.info).toBe(PRF_EVAL_INPUT);
    expect(tree.preview).toBeUndefined();
    expect(tree.children).toHaveLength(4);

    const infos = tree.children.map((node) => node.info);
    expect(infos).toEqual([
      VAULT_INFO,
      holderInfo(DMV),
      presenterInfo(SHOP),
      presenterInfo("https://rentals.verygoodwallet.com"),
    ]);
    for (const child of tree.children) {
      expect(child.preview).toBeUndefined();
      expect(child.children).toEqual([]);
      expect(child.label.length).toBeGreaterThan(0);
    }
  });

  it("includes hashed previews when a master is provided", async () => {
    const tree = await describeHierarchy({ master: MASTER, ...origins });
    expect(tree.preview).toBe("630dcd29");
    for (const child of tree.children) {
      expect(child.preview).toMatch(/^[0-9a-f]{8}$/);
    }
    // Previews match previewSecret of the actual derived seeds.
    const holderNode = tree.children.find((n) => n.info === holderInfo(DMV));
    expect(holderNode?.preview).toBe(
      await previewSecret(await deriveHolderSeed(MASTER, DMV)),
    );
    const vaultNode = tree.children.find((n) => n.info === VAULT_INFO);
    expect(vaultNode?.preview).toBe(
      await previewSecret(await hkdfDerive(MASTER, VAULT_INFO)),
    );
  });

  it("previews never expose raw derived bytes", async () => {
    const tree = await describeHierarchy({ master: MASTER, ...origins });
    const holderSeedHex = toHex(await deriveHolderSeed(MASTER, DMV));
    for (const child of tree.children) {
      expect(holderSeedHex).not.toContain(child.preview);
    }
  });

  it("handles empty origin lists (vault branch only)", async () => {
    const tree = await describeHierarchy({});
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.info).toBe(VAULT_INFO);
  });
});
