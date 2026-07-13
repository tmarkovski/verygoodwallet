/**
 * @vgw/vc-kit — W3C VC 2.0 + Data Integrity bbs-2023 (BLS12-381 BBS
 * selective disclosure) on top of the @digitalbazaar stack.
 *
 * - `generateBbsKeyPair(seed)` — deterministic BBS keys with did:key ids
 * - `signCredential(...)` — issuer base proof (holder-only material)
 * - `deriveCredential(...)` — holder selective-disclosure derived proof
 * - `verifyCredential(...)` — relying-party verification of derived proofs
 * - `documentLoader` / `registerContext` / `resolveDid` — JSON-LD plumbing
 * - `buildUtopiaDriversLicense(...)` — demo credential template
 */
export { generateBbsKeyPair } from './keys.js';
export { signCredential, deriveCredential, verifyCredential } from './bbs.js';
export { documentLoader, registerContext, resolveDid } from './loader.js';
export {
  buildUtopiaDriversLicense,
  type UtopiaDriversLicenseInput,
} from './credentials/utopia-dl.js';
export {
  CREDENTIALS_V2_CONTEXT_URL,
  VDL_V1_CONTEXT_URL,
  VDL_AAMVA_V1_CONTEXT_URL,
  VGW_CONTEXT_URL,
  MULTIKEY_V1_CONTEXT_URL,
  DATA_INTEGRITY_V2_CONTEXT_URL,
  BUNDLED_CONTEXTS,
} from './contexts/index.js';
export type {
  VerifiableCredential,
  BbsKeyPair,
  BbsSigner,
  VerifyCredentialResult,
  JsonLdContextEntry,
} from './types.js';
