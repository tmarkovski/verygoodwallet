/**
 * Ed25519 did:key encoding/decoding.
 *
 * did:key encodes a public key as `did:key:z<base58btc(multicodec ‖ key)>`.
 * For Ed25519 the multicodec prefix is `0xed 0x01` (ed25519-pub, varint), so
 * every Ed25519 did:key starts with `did:key:z6Mk`. The 32-byte holder seed
 * from `deriveHolderSeed` IS the Ed25519 private key — no further expansion —
 * which keeps the wallet's pairwise-DID derivation a pure function of the
 * passkey PRF output.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";

/** ed25519-pub multicodec code (0xed) as an unsigned varint. */
const MULTICODEC_ED25519_PUB = new Uint8Array([0xed, 0x01]);

const DID_KEY_PREFIX = "did:key:";
const ED25519_PUBLIC_KEY_LENGTH = 32;

export interface Ed25519DidKey {
  publicKey: Uint8Array;
  did: string;
  /**
   * `<did>#<multibase>` — the did:key verification method id, used as the
   * JWS `kid` so verifiers can resolve the public key from the header alone.
   */
  verificationMethodId: string;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Derive the Ed25519 public key and did:key identifiers from a 32-byte seed
 * (the seed is the private key). Deterministic: same seed, same DID.
 */
export function ed25519KeyPairFromSeed(seed: Uint8Array): Ed25519DidKey {
  if (seed.length !== 32) {
    throw new Error(
      `ed25519KeyPairFromSeed: seed must be 32 bytes, got ${seed.length}`,
    );
  }
  const publicKey = ed25519.getPublicKey(seed);
  const multibase = `z${base58.encode(concatBytes(MULTICODEC_ED25519_PUB, publicKey))}`;
  const did = DID_KEY_PREFIX + multibase;
  return { publicKey, did, verificationMethodId: `${did}#${multibase}` };
}

/**
 * Extract the raw 32-byte Ed25519 public key from a did:key. Throws a
 * descriptive error on anything that is not a well-formed Ed25519 did:key —
 * this is the validation gate for keys received from the network (JWS `kid`).
 */
export function didKeyToEd25519PublicKey(did: string): Uint8Array {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error(
      `didKeyToEd25519PublicKey: expected a did:key, got ${JSON.stringify(did)}`,
    );
  }
  const multibase = did.slice(DID_KEY_PREFIX.length);
  if (!multibase.startsWith("z")) {
    throw new Error(
      "didKeyToEd25519PublicKey: expected multibase base58btc ('z' prefix)",
    );
  }
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(multibase.slice(1));
  } catch (cause) {
    throw new Error("didKeyToEd25519PublicKey: invalid base58btc encoding", {
      cause,
    });
  }
  if (
    decoded[0] !== MULTICODEC_ED25519_PUB[0] ||
    decoded[1] !== MULTICODEC_ED25519_PUB[1]
  ) {
    throw new Error(
      "didKeyToEd25519PublicKey: not an ed25519-pub multicodec (0xed01) key",
    );
  }
  const publicKey = decoded.subarray(2);
  if (publicKey.length !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new Error(
      `didKeyToEd25519PublicKey: expected a 32-byte public key, got ${publicKey.length}`,
    );
  }
  return publicKey;
}
