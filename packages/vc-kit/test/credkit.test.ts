/**
 * credkit issuance facade — the N2 regression surface (MIGRATION §5, §12):
 * blind issuance of the Utopia DL under the pinned `credkit-bbs-sha-2026`
 * suite with VGW's offline loader, the holder receipt check, and the two
 * fail-closed edges the migration doc calls out by name — an unknown context
 * and the old `birth_date` `xsd:dateTime` mapping. Derive/verify tests join
 * at N3 when the wallet presents credkit credentials.
 */
import { describe, expect, it } from 'vitest';
import {
  CREDKIT_CRYPTOSUITE,
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  VDL_V1_CONTEXT_URL,
  buildUtopiaDriversLicense,
  createHolderBinding,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
  verifyIssuedCredkitCredential,
  type VerifiableCredential,
} from '../src/index.js';
import vdlV1 from '../src/contexts/vdl-v1.json';

const ISSUER_SEED = new Uint8Array(32).fill(3);
const LINK_SECRET = new Uint8Array(32).fill(11);

const keyPair = generateCredkitBbsKeyPair(ISSUER_SEED);

function unsignedDl(): VerifiableCredential {
  return buildUtopiaDriversLicense({
    givenName: 'Jamie',
    familyName: 'Voss',
    birthDate: '1996-03-14',
    documentNumber: 'UDL-TEST-0001',
    issuer: { id: keyPair.controller, name: 'Utopia DMV' },
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2032-01-01T00:00:00Z',
  });
}

describe('issueCredkitCredential', () => {
  it('issues a holder-bound DL under the pinned suite and passes the receipt check', async () => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const vc = await issueCredkitCredential({
      credential: unsignedDl(),
      keyPair,
      numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
      holderCommitment: binding.commitmentWithProof,
    });

    const proof = vc.proof as Record<string, unknown>;
    expect(proof['type']).toBe('DataIntegrityProof');
    expect(proof['cryptosuite']).toBe('credkit-bbs-sha-2026');
    expect(proof['cryptosuite']).toBe(CREDKIT_CRYPTOSUITE);
    expect(proof['verificationMethod']).toBe(keyPair.id);
    // No per-issuance timestamp: `created` is a correlation handle credkit
    // deliberately refuses to represent.
    expect(proof['created']).toBeUndefined();

    // The document is untouched beyond the proof — birth_date rides as data,
    // no commitment field exists anywhere.
    const subject = vc.credentialSubject as Record<string, unknown>;
    const license = subject['driversLicense'] as Record<string, unknown>;
    expect(license['birth_date']).toBe('1996-03-14');
    expect(license['birthDateCommitment']).toBeUndefined();

    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: vc,
        holderBinding: {
          linkSecret: LINK_SECRET,
          secretProverBlind: binding.secretProverBlind,
        },
      }),
    ).resolves.toBe(true);
  });

  it('receipt check fails closed on the wrong link secret, wrong blind, or a tampered document', async () => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const vc = await issueCredkitCredential({
      credential: unsignedDl(),
      keyPair,
      numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
      holderCommitment: binding.commitmentWithProof,
    });

    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: vc,
        holderBinding: {
          linkSecret: new Uint8Array(32).fill(12),
          secretProverBlind: binding.secretProverBlind,
        },
      }),
    ).resolves.toBe(false);

    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: vc,
        holderBinding: { linkSecret: LINK_SECRET, secretProverBlind: 42n },
      }),
    ).resolves.toBe(false);

    const subject = vc.credentialSubject as Record<string, unknown>;
    const license = subject['driversLicense'] as Record<string, unknown>;
    const tampered = {
      ...vc,
      credentialSubject: {
        ...subject,
        driversLicense: { ...license, birth_date: '1901-01-01' },
      },
    } as VerifiableCredential;
    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: tampered,
        holderBinding: {
          linkSecret: LINK_SECRET,
          secretProverBlind: binding.secretProverBlind,
        },
      }),
    ).resolves.toBe(false);

    // Missing binding on a holder-bound credential fails closed too.
    await expect(
      verifyIssuedCredkitCredential({ verifiableCredential: vc }),
    ).resolves.toBe(false);
  });

  it('fails closed on a context the offline loader does not know', async () => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const credential = unsignedDl();
    credential['@context'] = [
      ...(credential['@context'] as string[]),
      'https://evil.example/contexts/unknown/v1',
    ];
    await expect(
      issueCredkitCredential({
        credential,
        keyPair,
        numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
        holderCommitment: binding.commitmentWithProof,
      }),
    ).rejects.toThrow(/unknown|refusing|loader|remote context/i);
  });

  it('fails closed when birth_date carries the old xsd:dateTime mapping', async () => {
    // The pre-N2 vDL context typed birth_date as xsd:dateTime; the date1900
    // encoder accepts only xsd:date. Reintroduce the old mapping — the term
    // is type-scoped, so the bundled vDL context is swapped wholesale for a
    // clone with the old @type — and issuance must throw, not sign a twin
    // over a datatype the encoder refuses (MIGRATION §5, Appendix B).
    const legacyVdl = structuredClone(vdlV1['@context']) as Record<string, unknown>;
    const dlTerm = legacyVdl['Iso18013DriversLicense'] as Record<string, unknown>;
    const scoped = dlTerm['@context'] as Record<string, unknown>;
    scoped['birth_date'] = {
      '@id': 'https://w3id.org/vdl#birthDate',
      '@type': 'http://www.w3.org/2001/XMLSchema#dateTime',
    };

    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const credential = unsignedDl();
    credential['@context'] = (credential['@context'] as string[]).map((url) =>
      url === VDL_V1_CONTEXT_URL ? legacyVdl : url,
    );
    await expect(
      issueCredkitCredential({
        credential,
        keyPair,
        numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
        holderCommitment: binding.commitmentWithProof,
      }),
    ).rejects.toThrow(/does not accept/);
  });

  it('fails closed on a non-canonical birth_date lexical form', async () => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const credential = unsignedDl();
    const subject = credential.credentialSubject as Record<string, unknown>;
    const license = subject['driversLicense'] as Record<string, unknown>;
    license['birth_date'] = '03/14/1996';
    await expect(
      issueCredkitCredential({
        credential,
        keyPair,
        numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
        holderCommitment: binding.commitmentWithProof,
      }),
    ).rejects.toThrow(/not canonical CCYY-MM-DD/);
  });

  it('rejects a commitment that does not carry exactly the link secret', async () => {
    // A commitment over two messages is not a VGW holder binding.
    const credential = unsignedDl();
    await expect(
      issueCredkitCredential({
        credential,
        keyPair,
        numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
        holderCommitment: new Uint8Array(7),
      }),
    ).rejects.toThrow();
  });
});
