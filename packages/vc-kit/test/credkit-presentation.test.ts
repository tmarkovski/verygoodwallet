/**
 * credkit presentation facade — the N3 regression surface (MIGRATION §4, §8,
 * Appendix B, Appendix D): full issue → present → verify round-trips with
 * VGW's offline loader over the predicate route (hidden birth_date twin),
 * the disclosure route, and full disclosure; the policy facade's fail-closed
 * edges (wrong/foreign issuer, verification-method control, validity
 * windows, challenge/domain, claim restatement BOTH ways); the underage
 * prover throw; and the seeded params mint + codec + pinning helpers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CREDKIT_CRYPTOSUITE,
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  createCredkitPresentation,
  createHolderBinding,
  credkitNumericDeclarations,
  credkitProofMode,
  generateCredkitBbsKeyPair,
  getEncoder,
  issueCredkitCredential,
  mintSeededRangeParams,
  rangeParamsFromBase64Url,
  rangeParamsHashBase64Url,
  rangeParamsToBase64Url,
  summarizeCredkitPresentation,
  verifyCredkitPresentation,
  verifyRangeParams,
  type ExpectedRangeClaim,
  type HolderBinding,
  type RangeParams,
  type VerifiableCredential,
  type VerifiablePresentation,
} from '../src/index.js';

const ISSUER_SEED = new Uint8Array(32).fill(3);
const OTHER_ISSUER_SEED = new Uint8Array(32).fill(4);
const LINK_SECRET = new Uint8Array(32).fill(11);

const CHALLENGE = 'session-nonce-1';
const DOMAIN = 'redirect_uri:https://shop.example/oid4vp/response';

const BIRTH_DATE_POINTER = '/credentialSubject/driversLicense/birth_date';
const FLAG_POINTER = '/credentialSubject/driversLicense/age_over_18';

/** 18+ as of 2026-07-16 — every date at or before this passes lessOrEqual. */
const CUTOFF_ISO = '2008-07-16';

const keyPair = generateCredkitBbsKeyPair(ISSUER_SEED);
const otherKeyPair = generateCredkitBbsKeyPair(OTHER_ISSUER_SEED);

let params: RangeParams;
let cutoffBound: bigint;
/** Jamie (1996-03-14, passes 18+), holder-bound to LINK_SECRET. */
let adultVc: VerifiableCredential;
let adultBinding: HolderBinding;
/** Noa (2009-11-02, fails 18+). */
let minorVc: VerifiableCredential;
let minorBinding: HolderBinding;

function unsignedDl(input?: {
  birthDate?: string;
  issuerId?: string;
  validFrom?: string;
  validUntil?: string;
}): VerifiableCredential {
  return buildUtopiaDriversLicense({
    givenName: 'Jamie',
    familyName: 'Voss',
    birthDate: input?.birthDate ?? '1996-03-14',
    documentNumber: 'UDL-TEST-0001',
    issuer: { id: input?.issuerId ?? keyPair.controller, name: 'Utopia DMV' },
    validFrom: input?.validFrom ?? '2026-01-01T00:00:00Z',
    validUntil: input?.validUntil ?? '2032-01-01T00:00:00Z',
  });
}

function rangeClaim(overrides?: Partial<Omit<ExpectedRangeClaim, 'statement'>>) {
  return {
    pointer: BIRTH_DATE_POINTER,
    kind: 'lessOrEqual' as const,
    bound: cutoffBound,
    digits: 4,
    params,
    ...overrides,
  };
}

const expectedClaims = (): ExpectedRangeClaim[] => [{ statement: 0, ...rangeClaim() }];

async function presentPredicate(options?: {
  selectivePointers?: string[];
  challenge?: string;
  domain?: string;
}): Promise<VerifiablePresentation> {
  return createCredkitPresentation({
    credentials: [
      {
        verifiableCredential: adultVc,
        selectivePointers: options?.selectivePointers ?? [],
        rangeClaims: [rangeClaim()],
        holderBinding: adultBinding,
      },
    ],
    challenge: options?.challenge ?? CHALLENGE,
    domain: options?.domain ?? DOMAIN,
  });
}

beforeAll(async () => {
  params = mintSeededRangeParams({ seed: 'test-params-seed', dst: 'VGW-TEST-RANGE-V1', base: 16 });
  cutoffBound = getEncoder('date1900').encode(CUTOFF_ISO);

  adultBinding = createHolderBinding({ linkSecret: LINK_SECRET });
  minorBinding = createHolderBinding({ linkSecret: LINK_SECRET });
  [adultVc, minorVc] = await Promise.all([
    issueCredkitCredential({
      credential: unsignedDl(),
      keyPair,
      numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
      holderCommitment: adultBinding.commitmentWithProof,
    }),
    issueCredkitCredential({
      credential: unsignedDl({ birthDate: '2009-11-02' }),
      keyPair,
      numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
      holderCommitment: minorBinding.commitmentWithProof,
    }),
  ]);
}, 60_000);

describe('predicate route (range claim over the hidden birth_date twin)', () => {
  it('round-trips: nothing disclosed beyond mandatory, the proven bound restated by the verifier', async () => {
    const vp = await presentPredicate();

    // The VP carries no holder identifier of any kind (MIGRATION §6).
    expect((vp as Record<string, unknown>)['holder']).toBeUndefined();

    expect(summarizeCredkitPresentation(vp)).toEqual({
      rangeClaims: 1,
      membershipClaims: 0,
      equalities: 0,
    });

    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedRangeClaims: expectedClaims(),
    });
    expect(result.error).toBeUndefined();
    expect(result.verified).toBe(true);

    // Hidden means hidden: the revealed document carries no birth_date, no
    // flags, no name — only the issuer's mandatory disclosures.
    const subject = result.documents?.[0]?.credentialSubject as Record<string, unknown>;
    const license = (subject?.['driversLicense'] ?? {}) as Record<string, unknown>;
    expect(license['birth_date']).toBeUndefined();
    expect(license['age_over_18']).toBeUndefined();
    expect(license['given_name']).toBeUndefined();
    expect(result.documents?.[0]?.validFrom).toBe('2026-01-01T00:00:00Z');
  });

  it('the underage holder cannot produce the proof: the prover THROWS, fail-closed', async () => {
    await expect(
      createCredkitPresentation({
        credentials: [
          {
            verifiableCredential: minorVc,
            rangeClaims: [rangeClaim()],
            holderBinding: minorBinding,
          },
        ],
        challenge: CHALLENGE,
        domain: DOMAIN,
      }),
    ).rejects.toThrow(/does not fit in base\^digits digits/);
  });

  it('restatement mismatch fails BOTH ways', async () => {
    const vp = await presentPredicate();
    // The proof carries a range claim the verifier did not demand.
    const undemanded = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    expect(undemanded.verified).toBe(false);
    expect(undemanded.error).toMatch(/carries 1 range claims, verifier expected 0/);

    // The verifier demands a claim the proof does not carry.
    const disclosure = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: adultVc,
          selectivePointers: [FLAG_POINTER],
          holderBinding: adultBinding,
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    const missing = await verifyCredkitPresentation({
      verifiablePresentation: disclosure,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedRangeClaims: expectedClaims(),
    });
    expect(missing.verified).toBe(false);
    expect(missing.error).toMatch(/carries 0 range claims, verifier expected 1/);
  });

  it('a different bound, kind, or alphabet than restated fails', async () => {
    const vp = await presentPredicate();
    const withClaim = async (claim: ExpectedRangeClaim) =>
      verifyCredkitPresentation({
        verifiablePresentation: vp,
        expectedIssuerDids: [keyPair.controller],
        challenge: CHALLENGE,
        domain: DOMAIN,
        expectedRangeClaims: [claim],
      });

    const wrongBound = await withClaim({ statement: 0, ...rangeClaim({ bound: cutoffBound - 1n }) });
    expect(wrongBound.verified).toBe(false);
    expect(wrongBound.error).toMatch(/does not match the expected predicate/);

    const wrongKind = await withClaim({
      statement: 0,
      ...rangeClaim({ kind: 'greaterOrEqual' }),
    });
    expect(wrongKind.verified).toBe(false);

    const foreignParams = mintSeededRangeParams({
      seed: 'some-other-seed',
      dst: 'VGW-TEST-RANGE-V1',
      base: 16,
    });
    const wrongParams = await withClaim({ statement: 0, ...rangeClaim({ params: foreignParams }) });
    expect(wrongParams.verified).toBe(false);
    expect(wrongParams.error).toMatch(/different alphabet/);
  });
});

describe('disclosure route (selective pointers, no claims)', () => {
  it('disclosure route: the flag is revealed, everything else stays hidden', async () => {
    const vp = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: adultVc,
          selectivePointers: [FLAG_POINTER],
          holderBinding: adultBinding,
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    expect(summarizeCredkitPresentation(vp)).toEqual({
      rangeClaims: 0,
      membershipClaims: 0,
      equalities: 0,
    });

    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    expect(result.error).toBeUndefined();
    expect(result.verified).toBe(true);
    const subject = result.documents?.[0]?.credentialSubject as Record<string, unknown>;
    const license = subject['driversLicense'] as Record<string, unknown>;
    expect(license['age_over_18']).toBe(true);
    expect(license['birth_date']).toBeUndefined();
    expect(license['given_name']).toBeUndefined();
  });

  it('full disclosure (tier 0): one subtree pointer reveals the whole subject', async () => {
    const vp = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: adultVc,
          selectivePointers: ['/credentialSubject'],
          holderBinding: adultBinding,
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    expect(result.verified).toBe(true);
    const subject = result.documents?.[0]?.credentialSubject as Record<string, unknown>;
    const license = subject['driversLicense'] as Record<string, unknown>;
    expect(license['birth_date']).toBe('1996-03-14');
    expect(license['given_name']).toBe('Jamie');
  });

  it('presenting a holder-bound credential without its binding fails', async () => {
    await expect(
      createCredkitPresentation({
        credentials: [{ verifiableCredential: adultVc, selectivePointers: [FLAG_POINTER] }],
        challenge: CHALLENGE,
        domain: DOMAIN,
      }),
    ).rejects.toThrow(/holder/i);
  });
});

describe('verifyCredkitPresentation policy edges (all fail closed)', () => {
  it('a proof checked under a DIFFERENT configured issuer key fails at the crypto', async () => {
    const vp = await presentPredicate();
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [otherKeyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedRangeClaims: expectedClaims(),
    });
    expect(result.verified).toBe(false);
    expect(result.documents).toBeUndefined();
  });

  it('a malformed configured issuer DID fails closed before any crypto', async () => {
    const vp = await presentPredicate();
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      // An Ed25519 did:key — wrong multicodec for a BBS trust anchor.
      expectedIssuerDids: ['did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedRangeClaims: expectedClaims(),
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/did not decode to a BLS12-381 G2 key/);
  });

  it('a cryptographically valid proof whose issuer is not the expected DID fails the policy', async () => {
    // Signed by keyPair, but the document CLAIMS another issuer: the crypto
    // passes under keyPair's key; the facade's issuer equality must not.
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const vc = await issueCredkitCredential({
      credential: unsignedDl({ issuerId: otherKeyPair.controller }),
      keyPair,
      numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
      holderCommitment: binding.commitmentWithProof,
    });
    const vp = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: vc,
          selectivePointers: [FLAG_POINTER],
          holderBinding: { linkSecret: LINK_SECRET, secretProverBlind: binding.secretProverBlind },
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/Issuer mismatch/);
    expect(result.error).toContain(otherKeyPair.controller);
  });

  it('a verification method outside the expected issuer DID fails ("not controlled by")', async () => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const vc = await issueCredkitCredential({
      credential: unsignedDl(),
      // Signed by keyPair's secret, but the proof NAMES a foreign key id.
      keyPair: { ...keyPair, id: `${otherKeyPair.controller}#${otherKeyPair.publicKeyMultibase}` },
      numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
      holderCommitment: binding.commitmentWithProof,
    });
    const vp = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: vc,
          selectivePointers: [FLAG_POINTER],
          holderBinding: { linkSecret: LINK_SECRET, secretProverBlind: binding.secretProverBlind },
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/not controlled by expected issuer/);
  });

  it('validFrom in the future and validUntil in the past both fail', async () => {
    const make = async (validity: { validFrom?: string; validUntil?: string }) => {
      const binding = createHolderBinding({ linkSecret: LINK_SECRET });
      const vc = await issueCredkitCredential({
        credential: unsignedDl(validity),
        keyPair,
        numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
        holderCommitment: binding.commitmentWithProof,
      });
      const vp = await createCredkitPresentation({
        credentials: [
          {
            verifiableCredential: vc,
            selectivePointers: [FLAG_POINTER],
            holderBinding: {
              linkSecret: LINK_SECRET,
              secretProverBlind: binding.secretProverBlind,
            },
          },
        ],
        challenge: CHALLENGE,
        domain: DOMAIN,
      });
      return verifyCredkitPresentation({
        verifiablePresentation: vp,
        expectedIssuerDids: [keyPair.controller],
        challenge: CHALLENGE,
        domain: DOMAIN,
      });
    };

    const notYet = await make({ validFrom: '2100-01-01T00:00:00Z', validUntil: '2106-01-01T00:00:00Z' });
    expect(notYet.verified).toBe(false);
    expect(notYet.error).toMatch(/not yet valid/);

    const expired = await make({ validFrom: '2010-01-01T00:00:00Z', validUntil: '2016-01-01T00:00:00Z' });
    expect(expired.verified).toBe(false);
    expect(expired.error).toMatch(/expired/);
  });

  it('challenge and domain mismatches fail', async () => {
    const vp = await presentPredicate();
    const wrongChallenge = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: 'some-other-nonce',
      domain: DOMAIN,
      expectedRangeClaims: expectedClaims(),
    });
    expect(wrongChallenge.verified).toBe(false);
    expect(wrongChallenge.error).toMatch(/challenge/);

    const wrongDomain = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: 'redirect_uri:https://evil.example/oid4vp/response',
      expectedRangeClaims: expectedClaims(),
    });
    expect(wrongDomain.verified).toBe(false);
    expect(wrongDomain.error).toMatch(/domain/);
  });

  it('a tampered disclosed claim and an unknown context both fail closed', async () => {
    const vp = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: adultVc,
          selectivePointers: [FLAG_POINTER],
          holderBinding: adultBinding,
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });

    const verify = (mutated: VerifiablePresentation) =>
      verifyCredkitPresentation({
        verifiablePresentation: mutated,
        expectedIssuerDids: [keyPair.controller],
        challenge: CHALLENGE,
        domain: DOMAIN,
      });

    const tampered = structuredClone(vp) as VerifiablePresentation;
    const creds = tampered['verifiableCredential'] as Record<string, unknown>[];
    const subject = creds[0]?.['credentialSubject'] as Record<string, unknown>;
    (subject['driversLicense'] as Record<string, unknown>)['age_over_18'] = false;
    expect((await verify(tampered)).verified).toBe(false);

    const unknownContext = structuredClone(vp) as VerifiablePresentation;
    const cred = (unknownContext['verifiableCredential'] as Record<string, unknown>[])[0]!;
    cred['@context'] = [
      ...(cred['@context'] as string[]),
      'https://evil.example/contexts/unknown/v1',
    ];
    expect((await verify(unknownContext)).verified).toBe(false);
  });

  it('summarizeCredkitPresentation throws on a malformed envelope', async () => {
    const vp = await presentPredicate();
    expect(() =>
      summarizeCredkitPresentation({ ...vp, proof: undefined } as unknown as VerifiablePresentation),
    ).toThrow(/no proof object/);
    const proof = { ...(vp['proof'] as Record<string, unknown>), proofValue: 'u_not_an_envelope' };
    expect(() => summarizeCredkitPresentation({ ...vp, proof })).toThrow();
  });
});

describe('credential introspection', () => {
  it('reads the declared twins and the holder-bound mode from the base proof', () => {
    expect(credkitNumericDeclarations(adultVc)).toEqual([
      { pointer: BIRTH_DATE_POINTER, encoder: 'date1900' },
    ]);
    expect(credkitProofMode(adultVc)).toBe('holderBound');
    expect(() => credkitNumericDeclarations({ ...adultVc, proof: undefined })).toThrow(
      /no credkit base proof/,
    );
  });
});

describe('seeded range params', () => {
  it('mints deterministically: same seed+dst identical, different dst different', () => {
    const again = mintSeededRangeParams({
      seed: 'test-params-seed',
      dst: 'VGW-TEST-RANGE-V1',
      base: 16,
    });
    expect(rangeParamsToBase64Url(again)).toBe(rangeParamsToBase64Url(params));

    const otherDst = mintSeededRangeParams({
      seed: 'test-params-seed',
      dst: 'VGW-TEST-RANGE-V2',
      base: 16,
    });
    expect(rangeParamsToBase64Url(otherDst)).not.toBe(rangeParamsToBase64Url(params));
  });

  it('round-trips through base64url with a stable hash, and the alphabet verifies', async () => {
    const encoded = rangeParamsToBase64Url(params);
    const decoded = rangeParamsFromBase64Url(encoded);
    expect(rangeParamsToBase64Url(decoded)).toBe(encoded);
    expect(decoded.base).toBe(16);

    const hash = await rangeParamsHashBase64Url(params);
    expect(await rangeParamsHashBase64Url(decoded)).toBe(hash);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The 2-pairings-per-digit check — deliberately the ONE test that runs it.
    expect(verifyRangeParams(decoded)).toBe(true);
  }, 30_000);

  it('rejects tampered octets (decode throws or the pairing check fails)', () => {
    const encoded = rangeParamsToBase64Url(params);
    // Flip a character inside the first signature's bytes.
    const at = 150;
    const flipped = `${encoded.slice(0, at)}${encoded[at] === 'A' ? 'B' : 'A'}${encoded.slice(at + 1)}`;
    let decoded: RangeParams | undefined;
    try {
      decoded = rangeParamsFromBase64Url(flipped);
    } catch {
      return; // point validation rejected it — fail-closed either way
    }
    expect(verifyRangeParams(decoded)).toBe(false);
  }, 30_000);

  it('pins the suite the alphabets belong to', () => {
    expect(CREDKIT_CRYPTOSUITE).toBe('credkit-bbs-sha-2026');
  });
});
