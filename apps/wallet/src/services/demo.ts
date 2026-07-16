/**
 * "Add demo credential" — gives the wallet content without a network issuer.
 *
 * A LOCAL demo-issuer credkit BBS keypair is derived from the wallet's own
 * key hierarchy, a Utopia Driver's License is blind-issued exactly like the
 * real DMV does it since N2 — the wallet's master-derived link secret is
 * committed via `createHolderBinding`, `birth_date` is numeric-declared
 * (`date1900`) so age predicates prove against a hidden twin, and NO
 * birthDateCommitment exists — then stored encrypted as a versioned v3
 * envelope. The per-credential `secretProverBlind` is kept INSIDE the
 * encrypted payload (it is random, not re-derivable); the link secret is
 * never stored (PRF-derived).
 */

import {
  deriveLinkSecret,
  encryptJson,
  hkdfDerive,
  previewSecret,
  scalarToBase64Url,
} from "@vgw/keys";
import {
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  createHolderBinding,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
} from "@vgw/vc-kit";
import { inspect } from "../inspector/events";
import {
  addCredential,
  type CredentialPayload,
  type CredentialRecord,
} from "./db";
import { metaFromCredential } from "./meta";

export const DEMO_ISSUER_NAME = "Utopia DMV";

/**
 * HKDF info for the demo issuer's key seed. Its own branch, NOT the
 * per-issuer issuance-PoP branch: `deriveIssuancePopSeed` (which replaced
 * the retired `deriveHolderSeed` the demo used to borrow) names an Ed25519
 * request-PoP key, and the demo issuer needs a BBS SIGNING key — a
 * different job deserves a different domain-separation label.
 */
const DEMO_ISSUER_INFO = "vgw/v1/demo-issuer";

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
  // 1. Demo issuer key: its own HKDF branch of this wallet's hierarchy.
  const issuerSeed = await hkdfDerive(masterSecret, DEMO_ISSUER_INFO);
  inspect.emit({
    label: "Demo issuer seed derived",
    data: {
      info: DEMO_ISSUER_INFO,
      preview: await previewSecret(issuerSeed),
    },
  });

  const keyPair = generateCredkitBbsKeyPair(issuerSeed);
  inspect.emit({
    label: "Demo issuer BBS keypair generated (credkit keyGen)",
    data: { controller: keyPair.controller },
  });

  // 2. Holder binding: the wallet's ONE link secret, blind-committed. The
  // same secret every real issuance uses — that is what makes the demo
  // credential linkable to real ones in cross-credential proofs.
  const linkSecret = await deriveLinkSecret(masterSecret);
  const binding = createHolderBinding({ linkSecret });
  inspect.emit({
    label: "Link-secret commitment created",
    data: {
      scheme: "credkit blind-BBS commit (BLS12-381)",
      linkSecretPreview: await previewSecret(linkSecret),
      commitmentBytes: binding.commitmentWithProof.length,
    },
  });

  // 3. Build + blind-sign the Utopia DL (credkit-bbs-sha-2026 base proof,
  // birth_date numeric-declared, no birthDateCommitment).
  const unsigned = buildUtopiaDriversLicense({
    givenName: DEMO_SUBJECT.givenName,
    familyName: DEMO_SUBJECT.familyName,
    birthDate: DEMO_SUBJECT.birthDate,
    documentNumber: randomDocumentNumber(),
    issuer: { id: keyPair.controller, name: DEMO_ISSUER_NAME },
  });

  const signed = await issueCredkitCredential({
    credential: unsigned,
    keyPair,
    numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
    holderCommitment: binding.commitmentWithProof,
  });
  inspect.emit({
    label: "Credential blind-signed (credkit-bbs-sha-2026 base proof)",
    data: {
      name: typeof signed.name === "string" ? signed.name : undefined,
      issuer: keyPair.controller,
    },
  });

  // 4. Encrypt the versioned v3 envelope (VC + scalar-encoded blind) under
  // the vault key.
  const envelope: CredentialPayload = {
    version: 3,
    vc: signed,
    secretProverBlind: scalarToBase64Url(binding.secretProverBlind),
  };
  const payload = await encryptJson(vaultKey, envelope);
  inspect.emit({
    label: "Credential encrypted at rest",
    data: { cipher: "AES-GCM-256 (vault key)", payloadChars: payload.length },
  });

  // 5. Store; only `meta` is plaintext.
  return addCredential({ accountId, meta: metaFromCredential(signed), payload });
}
