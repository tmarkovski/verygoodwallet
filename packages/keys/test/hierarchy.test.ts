import { describe, expect, it } from "vitest";
import {
  ISSUANCE_POP_INFO_PREFIX,
  LINK_SECRET_INFO,
  PRF_EVAL_INPUT,
  VAULT_INFO,
  decryptJson,
  deriveIssuancePopSeed,
  deriveLinkSecret,
  deriveVaultKey,
  describeHierarchy,
  encryptJson,
  fromHex,
  hkdfDerive,
  issuancePopInfo,
  previewSecret,
  toHex,
} from "../src/index.js";

const MASTER = fromHex(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);

const DMV = "https://dmv.verygoodwallet.com";

describe("domain-separation constants", () => {
  it("are exactly the protocol-mandated strings", () => {
    expect(PRF_EVAL_INPUT).toBe("vgw/v1/master-secret");
    expect(VAULT_INFO).toBe("vgw/v1/vault");
    expect(LINK_SECRET_INFO).toBe("vgw/v1/link-secret");
    expect(ISSUANCE_POP_INFO_PREFIX).toBe("vgw/v1/issuance-pop:");
    expect(issuancePopInfo(DMV)).toBe(`vgw/v1/issuance-pop:${DMV}`);
  });
});

describe("deriveIssuancePopSeed", () => {
  it("matches the fixed test vector (regression pin)", async () => {
    expect(toHex(await deriveIssuancePopSeed(MASTER, DMV))).toBe(
      "1f9e94085de66efb725b27c6181c43a883a9895f0311c1d2158b535d1626df70",
    );
  });

  it("is deterministic and 32 bytes", async () => {
    const a = await deriveIssuancePopSeed(MASTER, DMV);
    const b = await deriveIssuancePopSeed(MASTER, DMV);
    expect(toHex(a)).toBe(toHex(b));
    expect(a.length).toBe(32);
  });

  it("differs across origins (pairwise separation)", async () => {
    const dmv = await deriveIssuancePopSeed(MASTER, DMV);
    const other = await deriveIssuancePopSeed(
      MASTER,
      "https://other-issuer.example",
    );
    expect(toHex(dmv)).not.toBe(toHex(other));
  });

  it("differs from the retired holder and presenter branches (new derivation, not a rename)", async () => {
    // N2 replaced `vgw/v1/holder:<origin>` with `vgw/v1/issuance-pop:<origin>`
    // (MIGRATION §6), and N4 removed `vgw/v1/presenter:<origin>` outright.
    // A different info string MUST give a different seed — reusing retired
    // bytes would silently keep an old key alive under a new name.
    const issuancePop = await deriveIssuancePopSeed(MASTER, DMV);
    const legacyHolder = await hkdfDerive(MASTER, `vgw/v1/holder:${DMV}`);
    const retiredPresenter = await hkdfDerive(MASTER, `vgw/v1/presenter:${DMV}`);
    expect(toHex(issuancePop)).not.toBe(toHex(legacyHolder));
    expect(toHex(issuancePop)).not.toBe(toHex(retiredPresenter));
  });

  it("differ from the vault branch", async () => {
    const vaultBytes = await hkdfDerive(MASTER, VAULT_INFO);
    const issuancePop = await deriveIssuancePopSeed(MASTER, DMV);
    expect(toHex(vaultBytes)).not.toBe(toHex(issuancePop));
  });
});

describe("deriveLinkSecret", () => {
  it("matches the fixed test vector (regression pin)", async () => {
    expect(toHex(await deriveLinkSecret(MASTER))).toBe(
      "e37c98cf67e8aa41dec39664f11987207a5cf32b7afff22ffae09e910172885a",
    );
  });

  it("is deterministic and 32 bytes — the ONE secret, every session", async () => {
    const a = await deriveLinkSecret(MASTER);
    const b = await deriveLinkSecret(MASTER);
    expect(toHex(a)).toBe(toHex(b));
    expect(a.length).toBe(32);
  });

  it("takes no origin: it is not pairwise, by design", async () => {
    // The signature admits no origin. Pin the shape so a future "helpful"
    // origin parameter shows up as a loud diff here: cross-credential
    // equality requires the SAME secret at every issuance (MIGRATION §6).
    expect(deriveLinkSecret.length).toBe(1);
  });

  it("differs from the vault and issuance-pop branches", async () => {
    const link = toHex(await deriveLinkSecret(MASTER));
    expect(link).not.toBe(toHex(await hkdfDerive(MASTER, VAULT_INFO)));
    expect(link).not.toBe(toHex(await deriveIssuancePopSeed(MASTER, DMV)));
  });

  it("differs across masters", async () => {
    const otherMaster = new Uint8Array(MASTER);
    otherMaster[31] = (otherMaster[31] ?? 0) ^ 0x01;
    expect(toHex(await deriveLinkSecret(MASTER))).not.toBe(
      toHex(await deriveLinkSecret(otherMaster)),
    );
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
  };

  it("returns the full tree structure without a master (no previews)", async () => {
    const tree = await describeHierarchy(origins);
    expect(tree.info).toBe(PRF_EVAL_INPUT);
    expect(tree.preview).toBeUndefined();
    expect(tree.children).toHaveLength(3);

    const infos = tree.children.map((node) => node.info);
    expect(infos).toEqual([
      VAULT_INFO,
      LINK_SECRET_INFO,
      issuancePopInfo(DMV),
    ]);
    for (const child of tree.children) {
      expect(child.preview).toBeUndefined();
      expect(child.children).toEqual([]);
      expect(child.label.length).toBeGreaterThan(0);
    }
  });

  it("has no per-verifier branch of any kind — the presenter key is retired, not rotated", async () => {
    // The credkit presentation carries no holder identifier, so no
    // presentation-side key exists to derive (MIGRATION §6, N4).
    const tree = await describeHierarchy(origins);
    for (const child of tree.children) {
      expect(child.info).not.toContain("presenter");
    }
  });

  it("labels the per-issuer branch as the issuance PoP seed", async () => {
    const tree = await describeHierarchy(origins);
    const popNode = tree.children.find((n) => n.info === issuancePopInfo(DMV));
    expect(popNode?.label).toBe(`issuance PoP seed (${DMV})`);
  });

  it("includes hashed previews when a master is provided", async () => {
    const tree = await describeHierarchy({ master: MASTER, ...origins });
    expect(tree.preview).toBe("630dcd29");
    for (const child of tree.children) {
      expect(child.preview).toMatch(/^[0-9a-f]{8}$/);
    }
    // Previews match previewSecret of the actual derived seeds.
    const popNode = tree.children.find((n) => n.info === issuancePopInfo(DMV));
    expect(popNode?.preview).toBe(
      await previewSecret(await deriveIssuancePopSeed(MASTER, DMV)),
    );
    const vaultNode = tree.children.find((n) => n.info === VAULT_INFO);
    expect(vaultNode?.preview).toBe(
      await previewSecret(await hkdfDerive(MASTER, VAULT_INFO)),
    );
    const linkNode = tree.children.find((n) => n.info === LINK_SECRET_INFO);
    expect(linkNode?.preview).toBe(
      await previewSecret(await deriveLinkSecret(MASTER)),
    );
  });

  it("previews never expose raw derived bytes", async () => {
    const tree = await describeHierarchy({ master: MASTER, ...origins });
    const popSeedHex = toHex(await deriveIssuancePopSeed(MASTER, DMV));
    for (const child of tree.children) {
      expect(popSeedHex).not.toContain(child.preview);
    }
  });

  it("handles empty origin lists (vault + link-secret branches only)", async () => {
    const tree = await describeHierarchy({});
    expect(tree.children).toHaveLength(2);
    expect(tree.children.map((n) => n.info)).toEqual([VAULT_INFO, LINK_SECRET_INFO]);
  });
});
