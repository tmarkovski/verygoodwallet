/**
 * Shared JSON-LD document loader and DID resolution for @vgw/vc-kit.
 *
 * Built on @digitalbazaar/security-document-loader with:
 * - all bundled static contexts registered (fully offline operation),
 * - a did:key driver that understands BLS12-381 G2 Multikeys (`zUC7…`),
 * - an extension point ({@link registerContext}) for callers to add their own
 *   static contexts.
 */
import { securityLoader } from '@digitalbazaar/security-document-loader';
import * as didKey from '@digitalbazaar/did-method-key';
import * as Bls12381Multikey from '@digitalbazaar/bls12-381-multikey';
import * as Ed25519Multikey from '@digitalbazaar/ed25519-multikey';
import { CachedResolver } from '@digitalbazaar/did-io';
import { contexts as credentialsContexts } from '@digitalbazaar/credentials-context';
import { BUNDLED_CONTEXTS, CREDENTIALS_V2_CONTEXT_URL } from './contexts/index.js';

const loader = securityLoader();

// Register every context bundled with this kit.
for (const [url, document] of BUNDLED_CONTEXTS) {
  loader.addStatic(url, document);
}

// securityLoader ships the VC 2.0 context today (via @digitalbazaar/
// credentials-context); re-add defensively in case a future version drops it.
if (!loader.documents.has(CREDENTIALS_V2_CONTEXT_URL)) {
  for (const [url, document] of credentialsContexts) {
    loader.addStatic(url, document);
  }
}

// did:key driver for the two key types this kit resolves: BLS12-381 G2
// Multikeys (header zUC7 — issuer/holder BBS keys) and Ed25519 Multikeys
// (header z6Mk — presenter keys signing presentations). The driver has NO
// default handlers; every header must be registered explicitly.
const didKeyDriver = didKey.driver();
didKeyDriver.use({
  multibaseMultikeyHeader: 'zUC7',
  fromMultibase: Bls12381Multikey.from,
});
didKeyDriver.use({
  multibaseMultikeyHeader: 'z6Mk',
  fromMultibase: Ed25519Multikey.from,
});

const resolver = new CachedResolver();
resolver.use(didKeyDriver);
loader.setDidResolver(resolver);

/**
 * Registers a static JSON-LD context (or any static JSON-LD document) with
 * the shared document loader. Registrations take effect immediately for all
 * subsequent sign/derive/verify calls.
 */
export function registerContext(url: string, document: object): void {
  loader.addStatic(url, document);
}

/**
 * The shared documentLoader function, usable directly with jsonld /
 * jsonld-signatures APIs. Resolves bundled static contexts and did:key DIDs
 * (Ed25519 `z6Mk…` and BLS12-381 G2 `zUC7…`) without network access.
 */
export const documentLoader = loader.build();

/**
 * Resolves a DID (or DID URL, e.g. a verification method id with a fragment)
 * to its DID document / key document. Currently supports did:key.
 */
export async function resolveDid(did: string): Promise<object> {
  return await didKeyDriver.get({ did });
}
