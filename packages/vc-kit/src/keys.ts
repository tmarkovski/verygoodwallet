/**
 * BBS BLS12-381 key generation — `generateCredkitBbsKeyPair` + the did:key
 * codec pair: the @credkit/bbs `keyGen` path (ciphersuite pinned to the
 * sha-2026 era) whose raw `{ secretKey, publicKey }` feeds credkit
 * `issueCredential`, and whose did:key encoding is byte-compatible with the
 * retired @digitalbazaar multikey `zUC7…` identity, so the published
 * `vgw_issuer_did` contract survived the N2 issuance swap (both stacks
 * implement the IETF BBS KeyGen — the pinned vector in
 * test/credkit-keys.test.ts is the cross-library memory of that equality).
 */
import { getCiphersuite, g2FromBytes, keyGen, SUITE_BY_FIXTURE_DIR } from '@credkit/bbs';
import { base58 } from '@scure/base';

/**
 * The pinned credkit ciphersuite era (MIGRATION.md §11): sha-2026, forever.
 * The link-secret scalar mapping is suite-dependent, so cross-credential
 * equality can never span eras — nothing in VGW may pass a different suite.
 */
export function credkitCiphersuite() {
  return getCiphersuite(SUITE_BY_FIXTURE_DIR['bls12-381-sha-256']);
}

/** bls12_381-g2-pub multicodec code (0xeb) as an unsigned varint. */
const MULTICODEC_BLS12381_G2_PUB = new Uint8Array([0xeb, 0x01]);

const DID_KEY_PREFIX = 'did:key:';
const BLS12381_G2_PUBLIC_KEY_LENGTH = 96;

/** A credkit-native issuer key pair, plus its did:key identity. */
export interface CredkitBbsKeyPair {
  /** BBS secret scalar. Held in memory only; never serialized. */
  secretKey: bigint;
  /** Compressed BLS12-381 G2 public key, 96 bytes. */
  publicKey: Uint8Array;
  /** `did:key:zUC7…` — the same encoding the bbs-2023 multikey identity used. */
  controller: string;
  /** `<did>#<multibase>` — the proof `verificationMethod` id. */
  id: string;
  publicKeyMultibase: string;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Deterministically generate a credkit BBS key pair (IETF KeyGen, sha-2026
 * era) from ≥32 bytes of key material. Same seed, same key — and, verified
 * at N1 by a cross-library vector against the since-retired @digitalbazaar
 * generator, the SAME key that stack derived from the same seed (both
 * implement the IETF BBS KeyGen), which is why the N2 issuance swap kept the
 * DMV's published issuer DID stable for a fixed ISSUER_SEED (MIGRATION.md
 * §7). The pinned did:key vector in test/credkit-keys.test.ts carries that
 * guarantee forward now that the legacy generator is gone.
 */
export function generateCredkitBbsKeyPair(seed: Uint8Array): CredkitBbsKeyPair {
  const { secretKey, publicKey } = keyGen(credkitCiphersuite(), seed);
  const controller = bbsDidKeyFromPublicKey(publicKey);
  const publicKeyMultibase = controller.slice(DID_KEY_PREFIX.length);
  return {
    secretKey,
    publicKey,
    controller,
    id: `${controller}#${publicKeyMultibase}`,
    publicKeyMultibase,
  };
}

/**
 * Encode a compressed BLS12-381 G2 public key as `did:key:zUC7…`
 * (multicodec bls12_381-g2-pub 0xeb01 + base58btc multibase) — the exact
 * encoding the @digitalbazaar multikey stack produces, preserving the
 * published `vgw_issuer_did` contract. Validates the point before encoding;
 * throws on anything that is not a valid non-identity G2 element.
 */
export function bbsDidKeyFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== BLS12381_G2_PUBLIC_KEY_LENGTH) {
    throw new Error(
      `bbsDidKeyFromPublicKey: expected a ${BLS12381_G2_PUBLIC_KEY_LENGTH}-byte compressed G2 key, got ${publicKey.length}`,
    );
  }
  g2FromBytes(publicKey, 'bbsDidKeyFromPublicKey publicKey');
  const multibase = `z${base58.encode(concatBytes(MULTICODEC_BLS12381_G2_PUB, publicKey))}`;
  return DID_KEY_PREFIX + multibase;
}

/**
 * Decode a `did:key:zUC7…` into the raw 96-byte compressed G2 public key
 * credkit's `verifyProof`/`verifyGraph` take as the trust anchor (a trailing
 * `#fragment` — the verification-method form — is tolerated). This is the
 * validation gate between configured issuer DIDs (pins, discovery) and the
 * cryptographic layer: it throws a descriptive error on a non-did:key, a
 * non-base58btc multibase, a wrong multicodec, a wrong key length, and a
 * byte string that is not a valid non-identity G2 point. Never feed it a DID
 * taken from a presentation — issuer keys come from verifier policy
 * (MIGRATION.md §4).
 */
export function bbsPublicKeyFromDidKey(did: string): Uint8Array {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error(
      `bbsPublicKeyFromDidKey: expected a did:key, got ${JSON.stringify(did)}`,
    );
  }
  const multibase = did.slice(DID_KEY_PREFIX.length).split('#')[0] ?? '';
  if (!multibase.startsWith('z')) {
    throw new Error(
      "bbsPublicKeyFromDidKey: expected multibase base58btc ('z' prefix)",
    );
  }
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(multibase.slice(1));
  } catch (cause) {
    throw new Error('bbsPublicKeyFromDidKey: invalid base58btc encoding', {
      cause,
    });
  }
  if (
    decoded[0] !== MULTICODEC_BLS12381_G2_PUB[0] ||
    decoded[1] !== MULTICODEC_BLS12381_G2_PUB[1]
  ) {
    throw new Error(
      'bbsPublicKeyFromDidKey: not a bls12_381-g2-pub multicodec (0xeb01) key',
    );
  }
  const publicKey = decoded.subarray(2);
  if (publicKey.length !== BLS12381_G2_PUBLIC_KEY_LENGTH) {
    throw new Error(
      `bbsPublicKeyFromDidKey: expected a ${BLS12381_G2_PUBLIC_KEY_LENGTH}-byte public key, got ${publicKey.length}`,
    );
  }
  g2FromBytes(publicKey, 'bbsPublicKeyFromDidKey publicKey');
  return publicKey;
}
