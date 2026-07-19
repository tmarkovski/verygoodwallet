/**
 * Utopia Resident Registration — the N5a regression surface (MIGRATION §5,
 * §9 showcase B, Appendix D.5): the builder's shape and its canonical
 * `xsd:unsignedInt` lexical-form discipline pinned through the REAL credkit
 * pipeline (blind issue → receipt check; wrong context typing and
 * non-canonical lexical forms fail closed AT ISSUANCE), showcase B at the
 * facade level (set membership over the hidden `stateFips` twin — happy
 * path, wrong-set restatement, non-member prover throw), the two-sided
 * `postalCode` range (ZIP-in-block: two range claims over one pointer), and
 * the seeded set-params mint + codec + pinning helpers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CITIZENSHIP_V3_CONTEXT_URL,
  CREDENTIALS_V2_CONTEXT_URL,
  UTOPIA_DISTRICTS,
  UTOPIA_RESIDENT_NUMERIC_DECLARATIONS,
  UTOPIA_RESIDENT_V1_CONTEXT_URL,
  VGW_CONTEXT_URL,
  buildUtopiaResidentRegistration,
  createCredkitPresentation,
  createHolderBinding,
  credkitNumericDeclarations,
  credkitProofMode,
  districtByFips,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
  mintSeededSetParams,
  setParamsFromBase64Url,
  setParamsHashBase64Url,
  setParamsToBase64Url,
  summarizeCredkitPresentation,
  verifyCredkitPresentation,
  verifyIssuedCredkitCredential,
  verifySetParams,
  type ExpectedRangeClaim,
  type HolderBinding,
  type RangeParams,
  type SetMembershipParams,
  type VerifiableCredential,
} from '../src/index.js';
import { mintSeededRangeParams } from '../src/credkitParams.js';
import utopiaResidentV1 from '../src/contexts/utopia-resident-v1.json';

const ISSUER_SEED = new Uint8Array(32).fill(3);
const LINK_SECRET = new Uint8Array(32).fill(11);

const CHALLENGE = 'session-nonce-n5';
const DOMAIN = 'redirect_uri:https://rentals.example/oid4vp/response';

const STATE_FIPS_POINTER = '/credentialSubject/stateFips';
const POSTAL_CODE_POINTER = '/credentialSubject/postalCode';

/** Jamie's district: Port Azure (coastal, fips 11, postal block 40100–40199). */
const PORT_AZURE = districtByFips(11)!;
/** An inland district for the non-member vector: Highfield (fips 21). */
const HIGHFIELD = districtByFips(21)!;

/** The coastal-set fiction (rentals VERIFIER POLICY at N5b, D.5.4). */
const COASTAL_FIPS = UTOPIA_DISTRICTS.filter((d) => d.coastal).map((d) => BigInt(d.fips));

const keyPair = generateCredkitBbsKeyPair(ISSUER_SEED);

let coastalSet: SetMembershipParams;
let rangeParams: RangeParams;
/** Jamie in Port Azure (coastal), holder-bound to LINK_SECRET. */
let coastalVc: VerifiableCredential;
let coastalBinding: HolderBinding;
/** Jamie's cousin in Highfield (inland) — the non-member of the coastal set. */
let inlandVc: VerifiableCredential;
let inlandBinding: HolderBinding;

function unsignedResident(input?: {
  stateFips?: number;
  postalCode?: number;
  districtName?: string;
}): VerifiableCredential {
  return buildUtopiaResidentRegistration({
    givenName: 'Jamie',
    familyName: 'Voss',
    districtName: input?.districtName ?? PORT_AZURE.name,
    stateFips: input?.stateFips ?? PORT_AZURE.fips,
    postalCode: input?.postalCode ?? 40125,
    issuer: { id: keyPair.controller, name: 'Utopia DMV' },
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2028-01-01T00:00:00Z',
  });
}

beforeAll(async () => {
  coastalSet = mintSeededSetParams({
    seed: 'test-params-seed',
    dst: 'VGW-TEST-SET-coastal-V1',
    members: COASTAL_FIPS,
  });
  rangeParams = mintSeededRangeParams({
    seed: 'test-params-seed',
    dst: 'VGW-TEST-RANGE-V1',
    base: 16,
  });

  coastalBinding = createHolderBinding({ linkSecret: LINK_SECRET });
  inlandBinding = createHolderBinding({ linkSecret: LINK_SECRET });
  [coastalVc, inlandVc] = await Promise.all([
    issueCredkitCredential({
      credential: unsignedResident(),
      keyPair,
      numericDeclarations: UTOPIA_RESIDENT_NUMERIC_DECLARATIONS,
      holderCommitment: coastalBinding.commitmentWithProof,
    }),
    issueCredkitCredential({
      credential: unsignedResident({
        districtName: HIGHFIELD.name,
        stateFips: HIGHFIELD.fips,
        postalCode: 41150,
      }),
      keyPair,
      numericDeclarations: UTOPIA_RESIDENT_NUMERIC_DECLARATIONS,
      holderCommitment: inlandBinding.commitmentWithProof,
    }),
  ]);
}, 60_000);

describe('buildUtopiaResidentRegistration', () => {
  const credential = unsignedResident();

  it('produces a VC 2.0 credential over v2 + citizenship v3 + resident v1 + vgw', () => {
    expect(credential['@context']).toEqual([
      CREDENTIALS_V2_CONTEXT_URL,
      CITIZENSHIP_V3_CONTEXT_URL,
      UTOPIA_RESIDENT_V1_CONTEXT_URL,
      VGW_CONTEXT_URL,
    ]);
    expect(credential.type).toEqual([
      'VerifiableCredential',
      'UtopiaResidentRegistrationCredential',
    ]);
    expect(credential.validFrom).toBe('2026-01-01T00:00:00Z');
    expect(credential.validUntil).toBe('2028-01-01T00:00:00Z');
  });

  it('types the subject Person + UtopiaResident and omits the subject id (unlinkability)', () => {
    // 'Person' is what activates citizenship v3's TYPE-SCOPED vocabulary —
    // givenName/familyName resolve only on a node carrying that type.
    const subject = credential.credentialSubject as Record<string, unknown>;
    expect(subject['type']).toEqual(['Person', 'UtopiaResident']);
    expect(subject['id']).toBeUndefined();
    expect(subject['givenName']).toBe('Jamie');
    expect(subject['familyName']).toBe('Voss');
    expect(subject['districtName']).toBe('Port Azure');
  });

  it('serializes the twins as canonical decimal STRINGS (the lexical-form decision)', () => {
    // The context coerces both to xsd:unsignedInt; a JSON string's RDF
    // lexical form is byte-identical to the JSON value, so the encoder sees
    // exactly what the builder wrote. A JSON number would ride the
    // serializer's number formatting instead.
    const subject = credential.credentialSubject as Record<string, unknown>;
    expect(subject['stateFips']).toBe('11');
    expect(subject['postalCode']).toBe('40125');
  });

  it.each([
    ['negative', -1],
    ['fractional', 40.5],
    ['above xsd:unsignedInt', 4_294_967_296],
    ['unsafe / scientific-notation territory', 1e21],
    ['NaN', Number.NaN],
  ])('rejects a %s twin value instead of emitting a non-canonical literal', (_label, bad) => {
    expect(() => unsignedResident({ postalCode: bad })).toThrow(
      /postalCode must be an integer in \[0, 4294967295\]/
    );
  });
});

describe('utopia geography', () => {
  it('is internally consistent: unique fips, disjoint 5-digit postal blocks, both coasts inhabited', () => {
    const fips = UTOPIA_DISTRICTS.map((d) => d.fips);
    expect(new Set(fips).size).toBe(UTOPIA_DISTRICTS.length);
    for (const district of UTOPIA_DISTRICTS) {
      expect(district.postal.lo).toBeLessThanOrEqual(district.postal.hi);
      expect(String(district.postal.lo)).toMatch(/^[1-9]\d{4}$/);
      expect(String(district.postal.hi)).toMatch(/^[1-9]\d{4}$/);
    }
    const blocks = [...UTOPIA_DISTRICTS].sort((a, b) => a.postal.lo - b.postal.lo);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i]!.postal.lo).toBeGreaterThan(blocks[i - 1]!.postal.hi);
    }
    expect(UTOPIA_DISTRICTS.some((d) => d.coastal)).toBe(true);
    expect(UTOPIA_DISTRICTS.some((d) => !d.coastal)).toBe(true);
    expect(districtByFips(11)?.name).toBe('Port Azure');
    expect(districtByFips(99)).toBeUndefined();
  });
});

describe('blind issuance through the real credkit pipeline (the canonical-lexical pin)', () => {
  it('issues holder-bound with both uint64 twins declared and passes the receipt check', async () => {
    const proof = coastalVc.proof as Record<string, unknown>;
    expect(proof['cryptosuite']).toBe('credkit-bbs-sha-2026');

    // The twins are base-proof metadata, not document mutations: the
    // document still carries the canonical strings it was built with.
    const subject = coastalVc.credentialSubject as Record<string, unknown>;
    expect(subject['stateFips']).toBe('11');
    expect(subject['postalCode']).toBe('40125');

    expect(credkitNumericDeclarations(coastalVc)).toEqual([
      { pointer: STATE_FIPS_POINTER, encoder: 'uint64' },
      { pointer: POSTAL_CODE_POINTER, encoder: 'uint64' },
    ]);
    expect(credkitProofMode(coastalVc)).toBe('holderBound');

    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: coastalVc,
        holderBinding: {
          linkSecret: LINK_SECRET,
          secretProverBlind: coastalBinding.secretProverBlind,
        },
      })
    ).resolves.toBe(true);
  });

  it('fails closed at issuance when the context typing is wrong (untyped stateFips)', async () => {
    // THE regression this suite pins: strip the @type coercion from
    // stateFips — the signed quad becomes an xsd:string literal, which the
    // uint64 encoder refuses. Issuance must throw, not sign a twin over a
    // datatype the encoder rejects (MIGRATION §5; the DL's xsd:dateTime
    // vector is the same shape).
    const untyped = structuredClone(utopiaResidentV1['@context']) as Record<string, unknown>;
    const resident = untyped['UtopiaResident'] as Record<string, unknown>;
    const scoped = resident['@context'] as Record<string, unknown>;
    scoped['stateFips'] = 'https://verygoodwallet.com/vocab/utopia-resident#stateFips';

    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const credential = unsignedResident();
    credential['@context'] = (credential['@context'] as string[]).map((url) =>
      url === UTOPIA_RESIDENT_V1_CONTEXT_URL ? untyped : url
    );
    await expect(
      issueCredkitCredential({
        credential,
        keyPair,
        numericDeclarations: UTOPIA_RESIDENT_NUMERIC_DECLARATIONS,
        holderCommitment: binding.commitmentWithProof,
      })
    ).rejects.toThrow(/does not accept/);
  });

  it('fails closed at issuance on a non-canonical lexical form (leading zero)', async () => {
    // "05" is a second signed spelling of 5 — the encoder rejects rather
    // than repairs (RDF canonicalization never touches literal lexical
    // forms). The builder cannot produce this; a hand-built document must
    // still fail at the same seam.
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const credential = unsignedResident();
    (credential.credentialSubject as Record<string, unknown>)['stateFips'] = '011';
    await expect(
      issueCredkitCredential({
        credential,
        keyPair,
        numericDeclarations: UTOPIA_RESIDENT_NUMERIC_DECLARATIONS,
        holderCommitment: binding.commitmentWithProof,
      })
    ).rejects.toThrow(/not a canonical unsigned integer/);
  });
});

describe('showcase B at the facade level: stateFips set membership', () => {
  it('proves membership in the coastal set with NOTHING disclosed beyond mandatory', async () => {
    const vp = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: coastalVc,
          selectivePointers: [],
          membershipClaims: [{ pointer: STATE_FIPS_POINTER, params: coastalSet }],
          holderBinding: coastalBinding,
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });

    expect((vp as Record<string, unknown>)['holder']).toBeUndefined();
    expect(summarizeCredkitPresentation(vp)).toEqual({
      rangeClaims: 0,
      membershipClaims: 1,
      nonRevocationClaims: 0,
      equalities: 0,
    });

    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedMembershipClaims: [
        { statement: 0, pointer: STATE_FIPS_POINTER, params: coastalSet },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.verified).toBe(true);

    // Hidden means hidden: no district, no fips, no postal code, no name —
    // the verifier learns ONLY "the hidden code is one of the coastal set".
    const subject = result.documents?.[0]?.credentialSubject as
      | Record<string, unknown>
      | undefined;
    expect(subject?.['stateFips']).toBeUndefined();
    expect(subject?.['postalCode']).toBeUndefined();
    expect(subject?.['districtName']).toBeUndefined();
    expect(subject?.['givenName']).toBeUndefined();
  });

  it('fails when the verifier restates a DIFFERENT set than the one proven against', async () => {
    const vp = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: coastalVc,
          membershipClaims: [{ pointer: STATE_FIPS_POINTER, params: coastalSet }],
          holderBinding: coastalBinding,
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    // Same members, different alphabet (different DST) — the paramsHash
    // restatement must fail; a verifier only ever accepts ITS OWN set.
    const otherAlphabet = mintSeededSetParams({
      seed: 'test-params-seed',
      dst: 'VGW-TEST-SET-coastal-V2',
      members: COASTAL_FIPS,
    });
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedMembershipClaims: [
        { statement: 0, pointer: STATE_FIPS_POINTER, params: otherAlphabet },
      ],
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/used a different set than this verifier's/);
  });

  it('an inland resident cannot produce the proof: the prover THROWS, fail-closed', async () => {
    // Highfield's fips (21) has no BB signature in the coastal alphabet —
    // the §9 fail-closed beat, membership edition: no bad proof is emitted,
    // nothing is posted.
    await expect(
      createCredkitPresentation({
        credentials: [
          {
            verifiableCredential: inlandVc,
            membershipClaims: [{ pointer: STATE_FIPS_POINTER, params: coastalSet }],
            holderBinding: inlandBinding,
          },
        ],
        challenge: CHALLENGE,
        domain: DOMAIN,
      })
    ).rejects.toThrow(/not a member of the set/);
  });
});

describe('two-sided postalCode range (ZIP-in-block, two claims over one pointer)', () => {
  const block = PORT_AZURE.postal;
  const claims = (params: RangeParams) =>
    [
      { pointer: POSTAL_CODE_POINTER, kind: 'greaterOrEqual', bound: BigInt(block.lo), digits: 4, params },
      { pointer: POSTAL_CODE_POINTER, kind: 'lessOrEqual', bound: BigInt(block.hi), digits: 4, params },
    ] as const;

  it('proves lo ≤ postalCode ≤ hi with the code itself hidden', async () => {
    const vp = await createCredkitPresentation({
      credentials: [
        {
          verifiableCredential: coastalVc,
          rangeClaims: claims(rangeParams),
          holderBinding: coastalBinding,
        },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    expect(summarizeCredkitPresentation(vp)).toEqual({
      rangeClaims: 2,
      membershipClaims: 0,
      nonRevocationClaims: 0,
      equalities: 0,
    });

    const expectedRangeClaims: ExpectedRangeClaim[] = claims(rangeParams).map((claim) => ({
      statement: 0,
      ...claim,
    }));
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedRangeClaims,
    });
    expect(result.error).toBeUndefined();
    expect(result.verified).toBe(true);
    const subject = result.documents?.[0]?.credentialSubject as
      | Record<string, unknown>
      | undefined;
    expect(subject?.['postalCode']).toBeUndefined();
  });

  it('a postal code outside the block cannot be proven (prover throws)', async () => {
    // The inland credential's 41150 is above Port Azure's block: the
    // lessOrEqual side underflows and the prover throws.
    await expect(
      createCredkitPresentation({
        credentials: [
          {
            verifiableCredential: inlandVc,
            rangeClaims: claims(rangeParams),
            holderBinding: inlandBinding,
          },
        ],
        challenge: CHALLENGE,
        domain: DOMAIN,
      })
    ).rejects.toThrow(/does not fit in base\^digits digits/);
  });
});

describe('seeded set params', () => {
  it('mints deterministically: same seed+dst+members identical; dst and member ORDER both matter', () => {
    const again = mintSeededSetParams({
      seed: 'test-params-seed',
      dst: 'VGW-TEST-SET-coastal-V1',
      members: COASTAL_FIPS,
    });
    expect(setParamsToBase64Url(again)).toBe(setParamsToBase64Url(coastalSet));

    const otherDst = mintSeededSetParams({
      seed: 'test-params-seed',
      dst: 'VGW-TEST-SET-other-V1',
      members: COASTAL_FIPS,
    });
    expect(setParamsToBase64Url(otherDst)).not.toBe(setParamsToBase64Url(coastalSet));

    // Publication order is part of the alphabet's identity — the transcript
    // binds it (MIGRATION D.5.5).
    const reordered = mintSeededSetParams({
      seed: 'test-params-seed',
      dst: 'VGW-TEST-SET-coastal-V1',
      members: [...COASTAL_FIPS].reverse(),
    });
    expect(setParamsToBase64Url(reordered)).not.toBe(setParamsToBase64Url(coastalSet));
  });

  it('round-trips through base64url with a stable hash, and the set verifies', async () => {
    const encoded = setParamsToBase64Url(coastalSet);
    const decoded = setParamsFromBase64Url(encoded);
    expect(setParamsToBase64Url(decoded)).toBe(encoded);
    expect(decoded.members).toEqual(COASTAL_FIPS);

    const hash = await setParamsHashBase64Url(coastalSet);
    expect(await setParamsHashBase64Url(decoded)).toBe(hash);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The 2-pairings-per-member check — deliberately the ONE test that runs it.
    expect(verifySetParams(decoded)).toBe(true);
  }, 30_000);

  it('rejects tampered octets (decode throws or the pairing check fails)', () => {
    const encoded = setParamsToBase64Url(coastalSet);
    // Flip a character inside the first signature's bytes (past the count,
    // the public key, and the first member scalar).
    const at = 200;
    const flipped = `${encoded.slice(0, at)}${encoded[at] === 'A' ? 'B' : 'A'}${encoded.slice(at + 1)}`;
    let decoded: SetMembershipParams | undefined;
    try {
      decoded = setParamsFromBase64Url(flipped);
    } catch {
      return; // point validation rejected it — fail-closed either way
    }
    expect(verifySetParams(decoded)).toBe(false);
  }, 30_000);
});
