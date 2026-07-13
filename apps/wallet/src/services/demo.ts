/**
 * "Add demo credential" — gives the wallet content before the DMV issuer
 * exists (milestone M2).
 *
 * A LOCAL demo-issuer BBS keypair is derived from the wallet's own key
 * hierarchy (`deriveHolderSeed(master, 'demo-issuer.local')`), a Utopia
 * Driver's License is built with a Poseidon birthdate commitment, signed
 * with a bbs-2023 base proof, and stored encrypted. The commitment opening
 * (value + blinding) is kept INSIDE the encrypted payload envelope — it is
 * needed for the ZK tier (M4) and must never be stored in the clear.
 */

import {
  createCommitment,
  daysSinceEpoch,
  deriveHolderSeed,
  encryptJson,
  previewSecret,
} from "@vgw/keys";
import {
  buildUtopiaDriversLicense,
  generateBbsKeyPair,
  signCredential,
} from "@vgw/vc-kit";
import { inspect } from "../inspector/events";
import {
  addCredential,
  type CredentialPayload,
  type CredentialRecord,
} from "./db";
import { metaFromCredential } from "./meta";

/** Pseudo-origin for the local demo issuer branch of the key hierarchy. */
export const DEMO_ISSUER_ORIGIN = "demo-issuer.local";
export const DEMO_ISSUER_NAME = "Utopia DMV";

const DEMO_SUBJECT = {
  givenName: "Jamie",
  familyName: "Voss",
  birthDate: "1996-03-14",
} as const;

/** Unambiguous document number, e.g. `UDL-K4Q7-XW2M`. */
function randomDocumentNumber(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const byte of bytes) out += alphabet.charAt(byte % alphabet.length);
  return `UDL-${out.slice(0, 4)}-${out.slice(4)}`;
}

export interface AddDemoCredentialOptions {
  accountId: number;
  masterSecret: Uint8Array;
  vaultKey: CryptoKey;
}

export async function addDemoCredential({
  accountId,
  masterSecret,
  vaultKey,
}: AddDemoCredentialOptions): Promise<CredentialRecord> {
  // 1. Demo issuer key: a holder branch of this wallet's own hierarchy.
  const issuerSeed = await deriveHolderSeed(masterSecret, DEMO_ISSUER_ORIGIN);
  inspect.emit({
    label: "Holder seed derived",
    data: {
      issuerOrigin: DEMO_ISSUER_ORIGIN,
      preview: await previewSecret(issuerSeed),
    },
  });

  const keyPair = await generateBbsKeyPair(issuerSeed);
  inspect.emit({
    label: "Demo issuer BBS keypair generated",
    data: { controller: keyPair.controller },
  });

  // 2. Poseidon commitment to the birthdate (opening stays in the vault).
  const birthDays = daysSinceEpoch(DEMO_SUBJECT.birthDate);
  const opening = createCommitment(birthDays);
  inspect.emit({
    label: "Birthdate commitment created",
    data: {
      scheme: "poseidon2(daysSinceEpoch(birthDate), blinding)",
      commitment: opening.commitment,
    },
  });

  // 3. Build + sign the Utopia DL (bbs-2023 base proof).
  const unsigned = buildUtopiaDriversLicense({
    givenName: DEMO_SUBJECT.givenName,
    familyName: DEMO_SUBJECT.familyName,
    birthDate: DEMO_SUBJECT.birthDate,
    documentNumber: randomDocumentNumber(),
    birthDateCommitment: opening.commitment,
    issuer: { id: keyPair.controller, name: DEMO_ISSUER_NAME },
  });

  const signed = await signCredential({ credential: unsigned, keyPair });
  inspect.emit({
    label: "Credential signed (bbs-2023 base proof)",
    data: {
      name: typeof signed.name === "string" ? signed.name : undefined,
      issuer: keyPair.controller,
    },
  });

  // 4. Encrypt the full envelope (VC + commitment opening) under the vault key.
  const envelope: CredentialPayload = {
    vc: signed,
    commitmentOpening: {
      value: birthDays,
      blinding: opening.blinding,
      commitment: opening.commitment,
    },
  };
  const payload = await encryptJson(vaultKey, envelope);
  inspect.emit({
    label: "Credential encrypted at rest",
    data: { cipher: "AES-GCM-256 (vault key)", payloadChars: payload.length },
  });

  // 5. Store; only `meta` is plaintext.
  return addCredential({ accountId, meta: metaFromCredential(signed), payload });
}
