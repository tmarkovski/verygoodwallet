/**
 * credkit revocation facade — the registry life cycle at the facade level,
 * exactly as the apps will run it: seed-derived registry authority, seeded
 * initial accumulator, revocable issuance (hidden frScalar twin), the
 * non-revocation claim in a presentation round-trip, surviving ANOTHER
 * holder's revocation via the published update record, discovering one's OWN
 * revocation at refresh (terminal), and the fail-closed verifier edges
 * (stale registry state, missing demanded claim).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  REVOCATION_CLAIM_POINTER,
  REVOCATION_NUMERIC_DECLARATION,
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  createCredkitPresentation,
  createHolderBinding,
  createSeededRevocationAccumulator,
  credentialRevocationStatus,
  deriveRevocationRegistryAuthority,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
  issueRevocationWitness,
  mintRevocationId,
  parseRevocationRegistryState,
  refreshRevocationWitness,
  revokeRevocationIds,
  summarizeCredkitPresentation,
  verifyCredkitPresentation,
  verifyRevocationWitness,
  type CredkitExpectedNonRevocationClaim,
  type HolderBinding,
  type RevocationRegistryState,
  type VerifiableCredential,
  type VerifiablePresentation,
} from '../src/index.js';

const ISSUER_SEED = new Uint8Array(32).fill(3);
const LINK_SECRET = new Uint8Array(32).fill(11);
const CHALLENGE = 'session-nonce-rev-1';
const DOMAIN = 'redirect_uri:https://shop.example/oid4vp/response';
const REGISTRY_URL = 'https://dmv.example/api/registry';

const keyPair = generateCredkitBbsKeyPair(ISSUER_SEED);

const authority = deriveRevocationRegistryAuthority({
  seed: 'test-issuer-secret-seed',
  dst: 'VGW-TEST-REVOCATION-KEY-V1',
});
const accumulatorV0 = createSeededRevocationAccumulator({
  seed: 'test-issuer-secret-seed',
  dst: 'VGW-TEST-REVOCATION-ACC-V1',
});

/** Alice presents; Bob only exists to be revoked in front of her. */
const alice = mintRevocationId();
const bob = mintRevocationId();

let aliceVc: VerifiableCredential;
let aliceBinding: HolderBinding;
let aliceWitness: string;

/** Registry state as the DMV would publish it at epoch 0. */
const stateAtEpoch0: RevocationRegistryState = {
  params: authority.paramsBase64Url,
  accumulator: accumulatorV0,
  epoch: 0,
  updates: [],
};

function nonRevocationClaim(state: RevocationRegistryState) {
  return {
    pointer: REVOCATION_CLAIM_POINTER,
    params: state.params,
    accumulator: state.accumulator,
    epoch: state.epoch,
  };
}

const expectedClaims = (
  state: RevocationRegistryState,
): CredkitExpectedNonRevocationClaim[] => [{ statement: 0, ...nonRevocationClaim(state) }];

async function presentWithClaim(
  state: RevocationRegistryState,
  witness: string,
): Promise<VerifiablePresentation> {
  return createCredkitPresentation({
    credentials: [
      {
        verifiableCredential: aliceVc,
        selectivePointers: [],
        nonRevocationClaims: [{ ...nonRevocationClaim(state), witness }],
        holderBinding: aliceBinding,
      },
    ],
    challenge: CHALLENGE,
    domain: DOMAIN,
  });
}

beforeAll(async () => {
  aliceBinding = createHolderBinding({ linkSecret: LINK_SECRET });
  aliceVc = await issueCredkitCredential({
    credential: buildUtopiaDriversLicense({
      givenName: 'Alice',
      familyName: 'Voss',
      birthDate: '1996-03-14',
      documentNumber: 'UDL-TEST-0002',
      issuer: { id: keyPair.controller, name: 'Utopia DMV' },
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2032-01-01T00:00:00Z',
      revocation: { registry: REGISTRY_URL, revocationId: alice.lexical },
    }),
    keyPair,
    numericDeclarations: [...UTOPIA_DL_NUMERIC_DECLARATIONS, REVOCATION_NUMERIC_DECLARATION],
    holderCommitment: aliceBinding.commitmentWithProof,
  });
  aliceWitness = issueRevocationWitness({
    authority,
    accumulator: accumulatorV0,
    revocationId: alice.lexical,
  });
}, 60_000);

describe('registry authority + witness issuance', () => {
  it('derives deterministically from the seed and validates the issued witness', () => {
    const again = deriveRevocationRegistryAuthority({
      seed: 'test-issuer-secret-seed',
      dst: 'VGW-TEST-REVOCATION-KEY-V1',
    });
    expect(again.paramsBase64Url).toBe(authority.paramsBase64Url);
    expect(again.secretKey).toBe(authority.secretKey);

    expect(
      verifyRevocationWitness({
        params: authority.paramsBase64Url,
        accumulator: accumulatorV0,
        revocationId: alice.lexical,
        witness: aliceWitness,
      }),
    ).toBe(true);
    // The witness is Alice's alone — Bob's id does not verify against it.
    expect(
      verifyRevocationWitness({
        params: authority.paramsBase64Url,
        accumulator: accumulatorV0,
        revocationId: bob.lexical,
        witness: aliceWitness,
      }),
    ).toBe(false);
  });

  it('reads the revocation coordinates back from the credential', () => {
    expect(credentialRevocationStatus(aliceVc)).toEqual({
      registry: REGISTRY_URL,
      revocationId: alice.lexical,
    });
    expect(
      credentialRevocationStatus(buildUtopiaDriversLicense({
        givenName: 'N',
        familyName: 'R',
        birthDate: '1996-03-14',
        documentNumber: 'UDL-TEST-0003',
        issuer: { id: keyPair.controller },
      })),
    ).toBeUndefined();
  });

  it('validates the published state document fail-closed', () => {
    expect(parseRevocationRegistryState(stateAtEpoch0)).toEqual(stateAtEpoch0);
    expect(() =>
      parseRevocationRegistryState({ ...stateAtEpoch0, epoch: 1 }),
    ).toThrow(/disagrees with 0 update records/);
    expect(() => parseRevocationRegistryState(null)).toThrow(/not an object/);
  });
});

describe('non-revocation claim round-trip', () => {
  it('presents and verifies at epoch 0; the id never appears on the wire', async () => {
    const vp = await presentWithClaim(stateAtEpoch0, aliceWitness);

    expect(summarizeCredkitPresentation(vp)).toEqual({
      rangeClaims: 0,
      membershipClaims: 0,
      nonRevocationClaims: 1,
      equalities: 0,
    });

    // The hidden id, its lexical, and the whole credentialStatus subtree
    // stay off the wire — the registry gate discloses nothing.
    const wire = JSON.stringify(vp);
    expect(wire).not.toContain(alice.lexical);
    expect(wire).not.toContain('credentialStatus');
    expect(wire).not.toContain('registry.example');

    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedNonRevocationClaims: expectedClaims(stateAtEpoch0),
    });
    expect(result.verified).toBe(true);
  }, 30_000);

  it('fails closed when the verifier demanded the claim and the holder omitted it', async () => {
    const bare = await createCredkitPresentation({
      credentials: [
        { verifiableCredential: aliceVc, selectivePointers: [], holderBinding: aliceBinding },
      ],
      challenge: CHALLENGE,
      domain: DOMAIN,
    });
    const result = await verifyCredkitPresentation({
      verifiablePresentation: bare,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedNonRevocationClaims: expectedClaims(stateAtEpoch0),
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/non-revocation/);
  }, 30_000);
});

describe('revocation epochs', () => {
  let stateAtEpoch1: RevocationRegistryState;
  let aliceWitnessAtEpoch1: string;

  beforeAll(() => {
    // The DMV revokes BOB. One batch, one published record.
    const applied = revokeRevocationIds({
      authority,
      accumulator: accumulatorV0,
      revocationIds: [bob.lexical],
      epoch: 1,
    });
    stateAtEpoch1 = {
      params: authority.paramsBase64Url,
      accumulator: applied.accumulator,
      epoch: applied.epoch,
      updates: [applied.update],
    };
    // The cross-checking parser accepts the DMV's own product.
    parseRevocationRegistryState(stateAtEpoch1);
  });

  it("Alice survives Bob's revocation from published data only", async () => {
    const refreshed = refreshRevocationWitness({
      revocationId: alice.lexical,
      witness: aliceWitness,
      epoch: 0,
      state: stateAtEpoch1,
    });
    if (refreshed.revoked) throw new Error('Alice must not be revoked');
    expect(refreshed.changed).toBe(true);
    expect(refreshed.epoch).toBe(1);
    aliceWitnessAtEpoch1 = refreshed.witness;

    expect(
      verifyRevocationWitness({
        params: authority.paramsBase64Url,
        accumulator: stateAtEpoch1.accumulator,
        revocationId: alice.lexical,
        witness: aliceWitnessAtEpoch1,
      }),
    ).toBe(true);

    // A no-op refresh (already current) reports changed: false.
    const again = refreshRevocationWitness({
      revocationId: alice.lexical,
      witness: aliceWitnessAtEpoch1,
      epoch: 1,
      state: stateAtEpoch1,
    });
    if (again.revoked) throw new Error('unreachable');
    expect(again.changed).toBe(false);

    const vp = await presentWithClaim(stateAtEpoch1, aliceWitnessAtEpoch1);
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedNonRevocationClaims: expectedClaims(stateAtEpoch1),
    });
    expect(result.verified).toBe(true);
  }, 30_000);

  it('rejects a proof against registry state the verifier does not hold', async () => {
    // Prover proves at epoch 1; verifier still restates epoch 0 — the
    // wire cross-check names the sync problem, and the merged challenge
    // would fail regardless.
    const vp = await presentWithClaim(stateAtEpoch1, aliceWitnessAtEpoch1);
    const result = await verifyCredkitPresentation({
      verifiablePresentation: vp,
      expectedIssuerDids: [keyPair.controller],
      challenge: CHALLENGE,
      domain: DOMAIN,
      expectedNonRevocationClaims: expectedClaims(stateAtEpoch0),
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/registry sync|epoch/);
  }, 30_000);

  it("Alice's own revocation is terminal at refresh", () => {
    const applied = revokeRevocationIds({
      authority,
      accumulator: stateAtEpoch1.accumulator,
      revocationIds: [alice.lexical],
      epoch: 2,
    });
    const stateAtEpoch2: RevocationRegistryState = {
      params: authority.paramsBase64Url,
      accumulator: applied.accumulator,
      epoch: 2,
      updates: [...stateAtEpoch1.updates, applied.update],
    };
    parseRevocationRegistryState(stateAtEpoch2);

    expect(
      refreshRevocationWitness({
        revocationId: alice.lexical,
        witness: aliceWitnessAtEpoch1,
        epoch: 1,
        state: stateAtEpoch2,
      }),
    ).toEqual({ revoked: true });
  });
});
