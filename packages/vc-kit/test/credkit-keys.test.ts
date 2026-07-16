import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';
import { getCiphersuite, SUITE_BY_FIXTURE_DIR } from '@credkit/bbs';
import {
  bbsDidKeyFromPublicKey,
  bbsPublicKeyFromDidKey,
  credkitCiphersuite,
  generateCredkitBbsKeyPair,
} from '../src/index.js';

const SEED = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

// Regression pin: keyGen(sha-2026 suite, 00 01 … 1f). If this moves, the
// credkit KeyGen layout changed and every provisioned issuer key moves with
// it — that is a version-bump conversation, not a test update.
//
// Provenance: this exact did:key was ALSO what the retired @digitalbazaar
// generator derived from the same seed (verified live at N1, both stacks
// implement the IETF BBS KeyGen) — which is why the N2 issuance swap kept
// the DMV's published issuer DID stable. The cross-library test died with
// the legacy generator at N4; this pinned vector is its memory.
const PINNED_DID =
  'did:key:zUC75FYvkdGdpTxRPZ72Tky9MFcimnr4rMeRWXtRJD1RYBYMNzARr1GQ1MPWB4BpEoyvYaTmo72a4YrV5XatUNR2Q8MixtWmRL97e4funyHFPJyN6oMap2VGgNRDPe338VYXhfs';
const PINNED_MULTIBASE = PINNED_DID.slice('did:key:'.length);

const MULTICODEC_BLS12381_G2_PUB = new Uint8Array([0xeb, 0x01]);

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function didFromRaw(prefix: Uint8Array, key: Uint8Array): string {
  return `did:key:z${base58.encode(concatBytes(prefix, key))}`;
}

describe('generateCredkitBbsKeyPair', () => {
  it('is deterministic and matches the pinned vector', () => {
    const kp = generateCredkitBbsKeyPair(SEED);
    expect(kp.controller).toBe(PINNED_DID);
    expect(kp.publicKeyMultibase).toBe(PINNED_MULTIBASE);
    expect(kp.id).toBe(`${PINNED_DID}#${PINNED_MULTIBASE}`);
    expect(kp.publicKey).toHaveLength(96);
    expect(typeof kp.secretKey).toBe('bigint');
    expect(kp.secretKey).toBeGreaterThan(0n);
    expect(kp.publicKeyMultibase.startsWith('zUC7')).toBe(true);

    const again = generateCredkitBbsKeyPair(SEED);
    expect(again.controller).toBe(kp.controller);
    expect(again.secretKey).toBe(kp.secretKey);
  });

  it('rejects key material shorter than 32 bytes', () => {
    expect(() => generateCredkitBbsKeyPair(new Uint8Array(16))).toThrow();
  });
});

describe('credkitCiphersuite', () => {
  it('is the pinned sha-2026-era ciphersuite (bls12-381-sha-256)', () => {
    expect(credkitCiphersuite()).toBe(
      getCiphersuite(SUITE_BY_FIXTURE_DIR['bls12-381-sha-256']),
    );
  });
});

describe('bbsDidKeyFromPublicKey / bbsPublicKeyFromDidKey', () => {
  const kp = generateCredkitBbsKeyPair(SEED);

  it('round-trips did:key ↔ raw compressed G2 key', () => {
    const raw = bbsPublicKeyFromDidKey(PINNED_DID);
    expect(raw).toEqual(kp.publicKey);
    expect(bbsDidKeyFromPublicKey(raw)).toBe(PINNED_DID);
  });

  it('accepts the verification-method (#fragment) form', () => {
    const raw = bbsPublicKeyFromDidKey(`${PINNED_DID}#${PINNED_MULTIBASE}`);
    expect(raw).toEqual(kp.publicKey);
  });

  it('rejects a non-did:key', () => {
    expect(() => bbsPublicKeyFromDidKey('did:web:dmv.example.com')).toThrow(
      /expected a did:key/,
    );
  });

  it('rejects a non-base58btc multibase', () => {
    expect(() => bbsPublicKeyFromDidKey('did:key:uAAAA')).toThrow(/base58btc/);
  });

  it('rejects invalid base58 characters', () => {
    expect(() => bbsPublicKeyFromDidKey('did:key:z0OIl')).toThrow(
      /invalid base58btc/,
    );
  });

  it('rejects a wrong multicodec (ed25519-pub)', () => {
    const ed = didFromRaw(new Uint8Array([0xed, 0x01]), new Uint8Array(32).fill(7));
    expect(() => bbsPublicKeyFromDidKey(ed)).toThrow(/bls12_381-g2-pub/);
  });

  it('rejects a wrong key length', () => {
    const short = didFromRaw(MULTICODEC_BLS12381_G2_PUB, kp.publicKey.subarray(0, 95));
    expect(() => bbsPublicKeyFromDidKey(short)).toThrow(/96-byte/);
  });

  it('rejects a malformed (off-curve) point', () => {
    const mutated = new Uint8Array(kp.publicKey);
    mutated[95] = (mutated[95] ?? 0) ^ 0x01;
    expect(() => bbsPublicKeyFromDidKey(didFromRaw(MULTICODEC_BLS12381_G2_PUB, mutated))).toThrow();
  });

  it('rejects the G2 identity point', () => {
    const identity = new Uint8Array(96);
    identity[0] = 0xc0; // compression + infinity bits
    expect(() => bbsPublicKeyFromDidKey(didFromRaw(MULTICODEC_BLS12381_G2_PUB, identity))).toThrow();
  });

  it('encode side validates too: wrong length and off-curve bytes throw', () => {
    expect(() => bbsDidKeyFromPublicKey(new Uint8Array(95))).toThrow(/96-byte/);
    const mutated = new Uint8Array(kp.publicKey);
    mutated[95] = (mutated[95] ?? 0) ^ 0x01;
    expect(() => bbsDidKeyFromPublicKey(mutated)).toThrow();
  });
});
