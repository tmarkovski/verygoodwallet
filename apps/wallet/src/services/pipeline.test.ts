/**
 * The wallet's whole data path in one breath, against the LIVE (credkit)
 * stack: derive keys from a master secret → blind-issue a holder-bound DL →
 * encrypt the v3 vault envelope → decrypt it → present with a re-derived
 * link secret → verify under the relying-party facade. Pins that the vault
 * codec (encryptJson/decryptJson + the scalar-encoded blind) composes with
 * the credkit crypto — the same seams `issuance.ts` and `presentation.ts`
 * cross in production.
 */
import { expect, it } from "vitest";
import {
  decryptJson,
  deriveLinkSecret,
  deriveVaultKey,
  encryptJson,
  hkdfDerive,
  scalarFromBase64Url,
  scalarToBase64Url,
} from "@vgw/keys";
import {
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  createCredkitPresentation,
  createHolderBinding,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
  verifyCredkitPresentation,
  verifyIssuedCredkitCredential,
} from "@vgw/vc-kit";
import type { CredentialPayload } from "./db";

it("demo pipeline: derive -> blind-issue -> encrypt -> decrypt -> present -> verify", async () => {
  const master = crypto.getRandomValues(new Uint8Array(32));
  const vaultKey = await deriveVaultKey(master);
  const seed = await hkdfDerive(master, "vgw/v1/demo-issuer");
  const keyPair = generateCredkitBbsKeyPair(seed);

  // Holder side: the ONE master-derived link secret, blind-committed.
  const binding = createHolderBinding({ linkSecret: await deriveLinkSecret(master) });

  const unsigned = buildUtopiaDriversLicense({
    givenName: "Jamie",
    familyName: "Voss",
    birthDate: "1996-03-14",
    documentNumber: "UDL-TEST-0001",
    issuer: { id: keyPair.controller, name: "Utopia DMV" },
  });
  const signed = await issueCredkitCredential({
    credential: unsigned,
    keyPair,
    numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
    holderCommitment: binding.commitmentWithProof,
  });
  // The holder receipt check the wallet runs before persisting anything.
  expect(
    await verifyIssuedCredkitCredential({
      verifiableCredential: signed,
      holderBinding: binding,
    }),
  ).toBe(true);

  // The v3 vault envelope: the bigint blind is scalar-encoded at the
  // persistence boundary (encryptJson is JSON-only — bigints would throw).
  const payload = await encryptJson(vaultKey, {
    version: 3,
    vc: signed,
    secretProverBlind: scalarToBase64Url(binding.secretProverBlind),
  } satisfies CredentialPayload);
  const envelope = await decryptJson<CredentialPayload>(vaultKey, payload);
  expect(envelope.version).toBe(3);

  // Present from the DECRYPTED envelope: link secret re-derived (never
  // stored), blind decoded from its base64url scalar encoding.
  const vp = await createCredkitPresentation({
    credentials: [
      {
        verifiableCredential: envelope.vc,
        selectivePointers: ["/credentialSubject/driversLicense/age_over_18"],
        holderBinding: {
          linkSecret: await deriveLinkSecret(master),
          secretProverBlind: scalarFromBase64Url(envelope.secretProverBlind),
        },
      },
    ],
    challenge: "pipeline-nonce",
    domain: "redirect_uri:https://verifier.example/oid4vp/response",
  });

  const result = await verifyCredkitPresentation({
    verifiablePresentation: vp,
    expectedIssuerDids: [keyPair.controller],
    challenge: "pipeline-nonce",
    domain: "redirect_uri:https://verifier.example/oid4vp/response",
  });
  expect(result.error).toBeUndefined();
  expect(result.verified).toBe(true);

  const subject = result.documents?.[0]?.credentialSubject as Record<
    string,
    Record<string, unknown>
  >;
  expect(subject["driversLicense"]?.["age_over_18"]).toBe(true);
  expect(subject["driversLicense"]?.["birth_date"]).toBeUndefined();
  expect(subject["driversLicense"]?.["given_name"]).toBeUndefined();
}, 120_000);
