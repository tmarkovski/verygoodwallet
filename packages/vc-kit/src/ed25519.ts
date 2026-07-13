/**
 * Ed25519 Multikey generation for presentation signing.
 */
import * as Ed25519Multikey from '@digitalbazaar/ed25519-multikey';
import { MULTIKEY_V1_CONTEXT_URL } from './contexts/index.js';
import type { Ed25519KeyPair } from './types.js';

/**
 * Deterministically generates an Ed25519 Multikey pair from a 32-byte seed
 * (the seed IS the private key — the same convention as
 * `ed25519KeyPairFromSeed` in @vgw/protocols, so both produce the same
 * `did:key:z6Mk…` from the same presenter seed).
 *
 * The returned key pair carries did:key identifiers:
 * - `controller`: `did:key:<publicKeyMultibase>`
 * - `id`:         `did:key:<publicKeyMultibase>#<publicKeyMultibase>`
 */
export async function generateEd25519KeyPair(seed: Uint8Array): Promise<Ed25519KeyPair> {
  if (seed.length !== 32) {
    throw new Error(`generateEd25519KeyPair: seed must be 32 bytes, got ${seed.length}`);
  }
  const keyPair = await Ed25519Multikey.generate({ seed });

  const did = `did:key:${keyPair.publicKeyMultibase}`;
  keyPair.id = `${did}#${keyPair.publicKeyMultibase}`;
  keyPair.controller = did;
  keyPair['@context'] = MULTIKEY_V1_CONTEXT_URL;

  return keyPair as unknown as Ed25519KeyPair;
}
