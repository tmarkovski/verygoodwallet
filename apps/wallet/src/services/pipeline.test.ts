// TODO(N3): this pins the RETIRED pre-credkit pipeline (bbs-2023 sign/derive
// + Poseidon commitment + legacy envelope) — rewrite it to the credkit
// issue → deriveProof → verify pipeline when the wallet presents credkit
// credentials at N3. Only the removed imports were swapped at N2 to keep
// typecheck green (deriveHolderSeed → the demo-issuer hkdf branch,
// CredentialPayload → LegacyCredentialPayload).
import { expect, it } from "vitest";
import {
  createCommitment,
  daysSinceEpoch,
  decryptJson,
  deriveVaultKey,
  encryptJson,
  hkdfDerive,
  verifyCommitment,
} from "@vgw/keys";
import {
  buildUtopiaDriversLicense,
  deriveCredential,
  generateBbsKeyPair,
  signCredential,
  verifyCredential,
} from "@vgw/vc-kit";
import type { LegacyCredentialPayload } from "./db";

it("demo pipeline: derive -> sign -> encrypt -> decrypt -> disclose -> verify", async () => {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const vaultKey = await deriveVaultKey(master);
  const seed = await hkdfDerive(master, "vgw/v1/demo-issuer");
  const keyPair = await generateBbsKeyPair(seed);

  const birthDate = "1996-03-14";
  const days = daysSinceEpoch(birthDate);
  const opening = createCommitment(days);
  expect(verifyCommitment(days, opening.blinding, opening.commitment)).toBe(true);

  const unsigned = buildUtopiaDriversLicense({
    givenName: "Jamie",
    familyName: "Voss",
    birthDate,
    documentNumber: "UDL-TEST-0001",
    birthDateCommitment: opening.commitment,
    issuer: { id: keyPair.controller, name: "Utopia DMV" },
  });
  const signed = await signCredential({ credential: unsigned, keyPair });

  const payload = await encryptJson(vaultKey, {
    vc: signed,
    commitmentOpening: { value: days, blinding: opening.blinding, commitment: opening.commitment },
  } satisfies LegacyCredentialPayload);
  const envelope = await decryptJson<LegacyCredentialPayload>(vaultKey, payload);

  const derived = await deriveCredential({
    verifiableCredential: envelope.vc,
    selectivePointers: ["/credentialSubject/driversLicense/birthDateCommitment"],
  });
  const result = await verifyCredential({ credential: derived, expectedIssuer: keyPair.controller });
  expect(result).toEqual({ verified: true });

  const subject = derived.credentialSubject as Record<string, Record<string, unknown>>;
  const dl = subject["driversLicense"] ?? {};
  expect(dl["birthDateCommitment"]).toBe(opening.commitment);
  expect(dl["birth_date"]).toBeUndefined();
  expect(dl["document_number"]).toBeUndefined();
}, 30_000);
