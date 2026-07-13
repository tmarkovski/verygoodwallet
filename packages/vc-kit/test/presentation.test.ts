import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildUtopiaDriversLicense,
  deriveCredential,
  generateBbsKeyPair,
  generateEd25519KeyPair,
  resolveDid,
  signCredential,
  signPresentation,
  verifyPresentation,
  type BbsKeyPair,
  type Ed25519KeyPair,
  type VerifiableCredential,
  type VerifiablePresentation,
} from '../src/index.js';

const ISSUER_SEED = new Uint8Array(32).fill(1);
const PRESENTER_SEED = new Uint8Array(32).fill(2);
const OTHER_SEED = new Uint8Array(32).fill(3);

const CHALLENGE = 'nonce-abc-123';
const DOMAIN = 'redirect_uri:https://shop.example/oid4vp/response';

describe('presentations (eddsa-rdfc-2022)', () => {
  let issuer: BbsKeyPair;
  let presenter: Ed25519KeyPair;
  let derived: VerifiableCredential;
  let vp: VerifiablePresentation;

  beforeAll(async () => {
    issuer = await generateBbsKeyPair(ISSUER_SEED);
    presenter = await generateEd25519KeyPair(PRESENTER_SEED);
    const credential = buildUtopiaDriversLicense({
      givenName: 'JAMIE',
      familyName: 'VOSS',
      birthDate: '1988-04-19',
      documentNumber: 'F111222333',
      issuer: { id: issuer.controller, name: 'Utopia DMV' },
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2032-01-01T00:00:00Z',
    });
    const signed = await signCredential({ credential, keyPair: issuer });
    derived = await deriveCredential({
      verifiableCredential: signed,
      selectivePointers: ['/credentialSubject/driversLicense/age_over_18'],
    });
    vp = await signPresentation({
      credentials: [derived],
      keyPair: presenter,
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
  });

  describe('generateEd25519KeyPair', () => {
    it('is deterministic and produces z6Mk did:key identifiers', async () => {
      const again = await generateEd25519KeyPair(PRESENTER_SEED);
      expect(again.controller).toBe(presenter.controller);
      expect(presenter.controller).toMatch(/^did:key:z6Mk/);
      expect(presenter.id).toBe(
        `${presenter.controller}#${presenter.publicKeyMultibase}`
      );
    });

    it('rejects seeds that are not 32 bytes', async () => {
      await expect(generateEd25519KeyPair(new Uint8Array(16))).rejects.toThrow(
        /32 bytes/
      );
    });
  });

  describe('resolveDid (z6Mk)', () => {
    it('resolves an Ed25519 did:key to a document authorizing authentication', async () => {
      const doc = (await resolveDid(presenter.controller)) as {
        didDocument?: Record<string, unknown>;
      } & Record<string, unknown>;
      const didDocument = (doc['didDocument'] ?? doc) as Record<string, unknown>;
      expect(didDocument['id']).toBe(presenter.controller);
      const authentication = didDocument['authentication'];
      expect(Array.isArray(authentication)).toBe(true);
    });
  });

  describe('signPresentation', () => {
    it('wraps credentials with holder + authentication proof (challenge/domain)', () => {
      expect(vp.holder).toBe(presenter.controller);
      expect(vp.type).toContain('VerifiablePresentation');
      const proof = vp.proof as Record<string, unknown>;
      expect(proof['proofPurpose']).toBe('authentication');
      expect(proof['challenge']).toBe(CHALLENGE);
      expect(proof['domain']).toBe(DOMAIN);
      expect(proof['cryptosuite']).toBe('eddsa-rdfc-2022');
      expect(String(proof['verificationMethod'])).toContain(presenter.controller);
    });

    it('refuses to sign an empty presentation', async () => {
      await expect(
        signPresentation({
          credentials: [],
          keyPair: presenter,
          challenge: CHALLENGE,
        })
      ).rejects.toThrow(/at least one credential/);
    });
  });

  describe('verifyPresentation', () => {
    it('verifies the wrapper and the embedded derived credential', async () => {
      const result = await verifyPresentation({
        presentation: vp,
        challenge: CHALLENGE,
        domain: DOMAIN,
        expectedIssuer: issuer.controller,
      });
      expect(result.error).toBeUndefined();
      expect(result.verified).toBe(true);
      expect(result.holder).toBe(presenter.controller);
      expect(result.credentials).toHaveLength(1);
      expect(result.credentials[0]?.verified).toBe(true);
    });

    it('rejects a wrong challenge (replay against another session)', async () => {
      const result = await verifyPresentation({
        presentation: vp,
        challenge: 'some-other-nonce',
        domain: DOMAIN,
        expectedIssuer: issuer.controller,
      });
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/challenge/i);
    });

    it('rejects a wrong domain (replay against another verifier)', async () => {
      const result = await verifyPresentation({
        presentation: vp,
        challenge: CHALLENGE,
        domain: 'redirect_uri:https://evil.example/response',
        expectedIssuer: issuer.controller,
      });
      expect(result.verified).toBe(false);
      expect(result.error).toMatch(/domain/i);
    });

    it('rejects a presentation whose holder does not control the proof key', async () => {
      const impostor = { ...vp, holder: (await generateEd25519KeyPair(OTHER_SEED)).controller };
      const result = await verifyPresentation({
        presentation: impostor,
        challenge: CHALLENGE,
        domain: DOMAIN,
        expectedIssuer: issuer.controller,
      });
      expect(result.verified).toBe(false);
      // Rewriting `holder` breaks either the wrapper signature (holder is
      // signed content) or the holder-binding check — both must fail closed.
    });

    it('rejects embedded credentials from an unexpected issuer', async () => {
      const result = await verifyPresentation({
        presentation: vp,
        challenge: CHALLENGE,
        domain: DOMAIN,
        expectedIssuer: 'did:key:zUC7unexpected',
      });
      expect(result.verified).toBe(false);
      expect(result.credentials[0]?.verified).toBe(false);
      expect(result.error).toMatch(/issuer/i);
    });

    it('rejects a presentation with no embedded credentials', async () => {
      const empty = await (async () => {
        // Sign a wrapper manually around zero credentials by bypassing the
        // public API's guard: simulate a hostile wallet sending a bare VP.
        const { verifiableCredential: _vc, proof: _proof, ...rest } = vp;
        return rest as VerifiablePresentation;
      })();
      const result = await verifyPresentation({
        presentation: empty,
        challenge: CHALLENGE,
        domain: DOMAIN,
      });
      expect(result.verified).toBe(false);
    });

    it('rejects a tampered disclosed claim inside the presentation', async () => {
      const tampered = structuredClone(vp) as VerifiablePresentation;
      const credentials = tampered.verifiableCredential as VerifiableCredential[];
      const subject = credentials[0]?.credentialSubject as Record<string, unknown>;
      const license = subject['driversLicense'] as Record<string, unknown>;
      license['age_over_18'] = true; // flip whatever it was
      license['given_name'] = 'MALLORY';
      const result = await verifyPresentation({
        presentation: tampered,
        challenge: CHALLENGE,
        domain: DOMAIN,
        expectedIssuer: issuer.controller,
      });
      expect(result.verified).toBe(false);
    });
  });
});
