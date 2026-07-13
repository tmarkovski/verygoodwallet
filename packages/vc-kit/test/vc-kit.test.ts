import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildUtopiaDriversLicense,
  deriveCredential,
  documentLoader,
  generateBbsKeyPair,
  registerContext,
  resolveDid,
  signCredential,
  verifyCredential,
  CREDENTIALS_V2_CONTEXT_URL,
  VGW_CONTEXT_URL,
  type BbsKeyPair,
  type VerifiableCredential,
} from '../src/index.js';

const SEED = new Uint8Array(32).fill(7);
const OTHER_SEED = new Uint8Array(32).fill(8);

type Subject = { driversLicense: Record<string, unknown> } & Record<string, unknown>;

function subjectOf(credential: VerifiableCredential): Subject {
  const subject = credential.credentialSubject;
  expect(subject).toBeTypeOf('object');
  expect(Array.isArray(subject)).toBe(false);
  return subject as Subject;
}

describe('@vgw/vc-kit', () => {
  let keyPair: BbsKeyPair;
  let credential: VerifiableCredential;
  let signed: VerifiableCredential;

  beforeAll(async () => {
    keyPair = await generateBbsKeyPair(SEED);
    credential = buildUtopiaDriversLicense({
      givenName: 'JOHN',
      familyName: 'SMITH',
      birthDate: '1988-04-19',
      documentNumber: 'F987654321',
      birthDateCommitment: 'zCommitment1234567890',
      issuer: {
        id: keyPair.controller,
        name: 'Utopia Department of Motor Vehicles',
      },
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2032-01-01T00:00:00Z',
    });
    signed = await signCredential({ credential, keyPair });
  });

  describe('generateBbsKeyPair', () => {
    it('is deterministic: same seed yields the same public key and did:key ids', async () => {
      const again = await generateBbsKeyPair(SEED);
      expect(again.publicKeyMultibase).toBe(keyPair.publicKeyMultibase);
      expect(again.id).toBe(keyPair.id);
      expect(again.controller).toBe(keyPair.controller);
    });

    it('yields different keys for different seeds', async () => {
      const other = await generateBbsKeyPair(OTHER_SEED);
      expect(other.publicKeyMultibase).not.toBe(keyPair.publicKeyMultibase);
    });

    it('produces did:key identifiers with the BLS12-381 G2 multikey header', () => {
      expect(keyPair.publicKeyMultibase.startsWith('zUC7')).toBe(true);
      expect(keyPair.controller).toBe(`did:key:${keyPair.publicKeyMultibase}`);
      expect(keyPair.id).toBe(
        `${keyPair.controller}#${keyPair.publicKeyMultibase}`
      );
    });
  });

  describe('documentLoader', () => {
    it('resolves the VC 2.0 context statically (ships in securityLoader)', async () => {
      const result = await documentLoader(CREDENTIALS_V2_CONTEXT_URL);
      expect(result.document).toBeTruthy();
    });

    it('resolves the custom VGW context', async () => {
      const result = await documentLoader(VGW_CONTEXT_URL);
      const doc = result.document as { '@context': Record<string, unknown> };
      expect(doc['@context']['birthDateCommitment']).toBe(
        'https://verygoodwallet.com/vocab#birthDateCommitment'
      );
    });

    it('supports registering additional contexts', async () => {
      const url = 'https://example.org/contexts/test/v1';
      const doc = { '@context': { term: 'https://example.org/vocab#term' } };
      registerContext(url, doc);
      const result = await documentLoader(url);
      expect(result.document).toEqual(doc);
    });
  });

  describe('resolveDid', () => {
    it('resolves a BBS did:key to a DID document authorizing assertions', async () => {
      const didDocument = (await resolveDid(keyPair.controller)) as {
        id: string;
        assertionMethod: unknown[];
      };
      expect(didDocument.id).toBe(keyPair.controller);
      expect(JSON.stringify(didDocument.assertionMethod)).toContain(
        keyPair.publicKeyMultibase
      );
    });
  });

  describe('signCredential (base proof)', () => {
    it('signs the Utopia DL with a bbs-2023 base proof', () => {
      const proof = signed.proof as Record<string, unknown>;
      expect(proof).toBeTruthy();
      expect(proof['type']).toBe('DataIntegrityProof');
      expect(proof['cryptosuite']).toBe('bbs-2023');
      expect(proof['proofPurpose']).toBe('assertionMethod');
      expect(proof['verificationMethod']).toBe(keyPair.id);
      expect(typeof proof['proofValue']).toBe('string');
      // original credential must not be mutated
      expect(credential.proof).toBeUndefined();
    });

    it('base proofs are holder-only: verifyCredential rejects them by design', async () => {
      const result = await verifyCredential({ credential: signed });
      expect(result.verified).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('deriveCredential + verifyCredential (derived proof)', () => {
    it('omits undisclosed claims and retains mandatory + selected ones', async () => {
      const derived = await deriveCredential({
        verifiableCredential: signed,
        selectivePointers: ['/credentialSubject/driversLicense/birth_date'],
      });

      // mandatory (default pointers: /issuer, /validFrom, /validUntil)
      expect((derived.issuer as { id: string }).id).toBe(keyPair.controller);
      expect(derived.validFrom).toBe('2026-01-01T00:00:00Z');
      expect(derived.validUntil).toBe('2032-01-01T00:00:00Z');

      // selected
      const license = subjectOf(derived).driversLicense;
      expect(license['birth_date']).toBe('1988-04-19');

      // undisclosed claims are absent
      expect(license['given_name']).toBeUndefined();
      expect(license['family_name']).toBeUndefined();
      expect(license['document_number']).toBeUndefined();
      expect(license['birthDateCommitment']).toBeUndefined();

      // derived proof verifies for a relying party
      const result = await verifyCredential({ credential: derived });
      expect(result.error).toBeUndefined();
      expect(result.verified).toBe(true);
    });

    it('fails verification when a disclosed value is tampered with', async () => {
      const derived = await deriveCredential({
        verifiableCredential: signed,
        selectivePointers: ['/credentialSubject/driversLicense/birth_date'],
      });
      const tampered = structuredClone(derived);
      (subjectOf(tampered).driversLicense as Record<string, unknown>)[
        'birth_date'
      ] = '2010-04-19';

      const result = await verifyCredential({ credential: tampered });
      expect(result.verified).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('supports a second derivation with different pointers (incl. the VGW commitment claim)', async () => {
      const derived = await deriveCredential({
        verifiableCredential: signed,
        selectivePointers: [
          '/credentialSubject/driversLicense/document_number',
          '/credentialSubject/driversLicense/family_name',
          '/credentialSubject/driversLicense/birthDateCommitment',
        ],
      });

      const license = subjectOf(derived).driversLicense;
      expect(license['document_number']).toBe('F987654321');
      expect(license['family_name']).toBe('SMITH');
      expect(license['birthDateCommitment']).toBe('zCommitment1234567890');
      expect(license['birth_date']).toBeUndefined();
      expect(license['given_name']).toBeUndefined();

      const result = await verifyCredential({
        credential: derived,
        expectedIssuer: keyPair.controller,
      });
      expect(result.error).toBeUndefined();
      expect(result.verified).toBe(true);
    });

    it('rejects a valid credential from an unexpected issuer', async () => {
      const derived = await deriveCredential({
        verifiableCredential: signed,
        selectivePointers: ['/credentialSubject/driversLicense/birth_date'],
      });
      const other = await generateBbsKeyPair(OTHER_SEED);

      const result = await verifyCredential({
        credential: derived,
        expectedIssuer: other.controller,
      });
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/issuer/i);
    });

    it('rejects an issuer-spoofed credential even without expectedIssuer', async () => {
      // The credential CLAIMS the trusted issuer, but is signed by an
      // attacker's own key. Issuer binding must be on by default.
      const attacker = await generateBbsKeyPair(OTHER_SEED);
      const forged = buildUtopiaDriversLicense({
        givenName: 'JOHN',
        familyName: 'SMITH',
        birthDate: '1988-04-19',
        documentNumber: 'F987654321',
        issuer: { id: keyPair.controller, name: 'Utopia DMV' },
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2032-01-01T00:00:00Z',
      });
      const signedForged = await signCredential({
        credential: forged,
        keyPair: attacker,
      });
      const derived = await deriveCredential({
        verifiableCredential: signedForged,
        selectivePointers: ['/credentialSubject/driversLicense/birth_date'],
      });

      const result = await verifyCredential({ credential: derived });
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/not controlled by/i);
    });

    it('fails closed when the credential discloses no issuer to bind the proof to', async () => {
      const { issuer: _issuer, ...noIssuer } = credential;
      const signedNoIssuer = await signCredential({
        credential: noIssuer as VerifiableCredential,
        keyPair,
      });
      const derived = await deriveCredential({
        verifiableCredential: signedNoIssuer,
        selectivePointers: ['/credentialSubject/driversLicense/birth_date'],
      });

      const result = await verifyCredential({ credential: derived });
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/no issuer/i);
    });

    it('rejects expired and not-yet-valid credentials distinctly from crypto failure', async () => {
      const derived = await deriveCredential({
        verifiableCredential: signed,
        selectivePointers: ['/credentialSubject/driversLicense/birth_date'],
      });

      const expired = await verifyCredential({
        credential: derived,
        expectedIssuer: keyPair.controller,
        now: '2033-01-01T00:00:00Z',
      });
      expect(expired.verified).toBe(false);
      expect(expired.error).toMatch(/expired/i);

      const early = await verifyCredential({
        credential: derived,
        expectedIssuer: keyPair.controller,
        now: '2025-01-01T00:00:00Z',
      });
      expect(early.verified).toBe(false);
      expect(early.error).toMatch(/not yet valid/i);

      const within = await verifyCredential({
        credential: derived,
        expectedIssuer: keyPair.controller,
        now: '2027-06-15T12:00:00Z',
      });
      expect(within.error).toBeUndefined();
      expect(within.verified).toBe(true);
    });
  });

  describe('buildUtopiaDriversLicense', () => {
    it('produces a VC 2.0 credential (validFrom/validUntil, v2 context first)', () => {
      const contexts = credential['@context'] as string[];
      expect(contexts[0]).toBe(CREDENTIALS_V2_CONTEXT_URL);
      expect(contexts).toContain('https://w3id.org/vdl/v1');
      expect(contexts).toContain('https://w3id.org/vdl/aamva/v1');
      expect(contexts).toContain(VGW_CONTEXT_URL);
      expect(credential.type).toEqual([
        'VerifiableCredential',
        'Iso18013DriversLicenseCredential',
      ]);
      expect(credential.validFrom).toBe('2026-01-01T00:00:00Z');
      expect(credential.validUntil).toBe('2032-01-01T00:00:00Z');
      expect(credential['issuanceDate']).toBeUndefined();
      expect(credential['expirationDate']).toBeUndefined();
    });

    it('omits the subject id by default and defaults validity when not given', () => {
      const built = buildUtopiaDriversLicense({
        givenName: 'A',
        familyName: 'B',
        birthDate: '1990-01-01',
        documentNumber: 'X1',
        issuer: { id: 'did:key:zExample' },
      });
      const subject = subjectOf(built);
      expect(subject['id']).toBeUndefined();
      expect(subject['type']).toBe('LicensedDriver');
      expect(built.issuer).toBe('did:key:zExample');
      expect(typeof built.validFrom).toBe('string');
      expect(new Date(built.validUntil as string).getUTCFullYear()).toBe(
        new Date(built.validFrom as string).getUTCFullYear() + 6
      );
      expect(subject.driversLicense['birthDateCommitment']).toBeUndefined();
    });

    it('defaults validity to midnight UTC so it is not a per-credential fingerprint', () => {
      // validFrom/validUntil are mandatory-disclosed in every derived proof;
      // millisecond-precision defaults would correlate presentations of the
      // same credential across verifiers.
      const input = {
        givenName: 'A',
        familyName: 'B',
        birthDate: '1990-01-01',
        documentNumber: 'X1',
        issuer: { id: 'did:key:zExample' },
      };
      const first = buildUtopiaDriversLicense(input);
      const second = buildUtopiaDriversLicense(input);

      expect(first.validFrom).toMatch(/T00:00:00(\.000)?Z$/);
      expect(first.validUntil).toMatch(/T00:00:00(\.000)?Z$/);
      // identical for credentials issued the same UTC day
      expect(second.validFrom).toBe(first.validFrom);
      expect(second.validUntil).toBe(first.validUntil);
    });
  });
});
