/**
 * BBS BLS12-381 key generation.
 */
import * as Bls12381Multikey from '@digitalbazaar/bls12-381-multikey';
import { MULTIKEY_V1_CONTEXT_URL } from './contexts/index.js';
import type { BbsKeyPair } from './types.js';

/**
 * Deterministically generates a BLS12-381 BBS key pair (BBS_BLS12381_SHA256)
 * from a seed. The same seed always yields the same key pair, which is what
 * lets a passkey PRF output re-derive the wallet's keys on any device.
 *
 * The returned key pair carries did:key identifiers:
 * - `controller`: `did:key:<publicKeyMultibase>`
 * - `id`:         `did:key:<publicKeyMultibase>#<publicKeyMultibase>`
 *
 * @param seed - Key material, at least 32 bytes of entropy.
 */
export async function generateBbsKeyPair(seed: Uint8Array): Promise<BbsKeyPair> {
  const keyPair = await Bls12381Multikey.generateBbsKeyPair({
    algorithm: Bls12381Multikey.ALGORITHMS.BBS_BLS12381_SHA256,
    seed,
  });

  const did = `did:key:${keyPair.publicKeyMultibase}`;
  keyPair.id = `${did}#${keyPair.publicKeyMultibase}`;
  keyPair.controller = did;
  keyPair['@context'] = MULTIKEY_V1_CONTEXT_URL;

  return keyPair as unknown as BbsKeyPair;
}
