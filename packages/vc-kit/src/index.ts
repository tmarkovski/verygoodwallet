/**
 * @vgw/vc-kit — W3C VC 2.0 Data Integrity operations. Two proof stacks
 * coexist during the credkit migration (MIGRATION §12):
 *
 * credkit (`credkit-bbs-sha-2026`, live issuance since N2):
 * - `generateCredkitBbsKeyPair(seed)` — deterministic issuer keys, did:key ids
 * - `createHolderBinding(...)` — holder link-secret commitment (blind issuance)
 * - `issueCredkitCredential(...)` — issuer blind-signed base proof
 * - `verifyIssuedCredkitCredential(...)` — holder receipt check
 * - `credkitDocumentLoader` — the strict offline loader for every credkit call
 *
 * bbs-2023 + eddsa-rdfc-2022 (@digitalbazaar stack — presentation path until
 * N3, retired at N4):
 * - `generateBbsKeyPair(seed)` — deterministic BBS keys with did:key ids
 * - `signCredential(...)` — issuer base proof (holder-only material)
 * - `deriveCredential(...)` — holder selective-disclosure derived proof
 * - `verifyCredential(...)` — relying-party verification of derived proofs
 * - `generateEd25519KeyPair(seed)` — deterministic presenter keys
 * - `signPresentation(...)` / `verifyPresentation(...)` — VP wrapper proofs
 *
 * Shared plumbing:
 * - `documentLoader` / `registerContext` / `resolveDid` — JSON-LD plumbing
 * - `buildUtopiaDriversLicense(...)` — demo credential template
 */
export {
  bbsDidKeyFromPublicKey,
  bbsPublicKeyFromDidKey,
  credkitCiphersuite,
  generateBbsKeyPair,
  generateCredkitBbsKeyPair,
  type CredkitBbsKeyPair,
} from './keys.js';
export { DEFAULT_MANDATORY_POINTERS } from './mandatory.js';
export { signCredential, deriveCredential, verifyCredential } from './bbs.js';
export {
  CREDKIT_CRYPTOSUITE,
  createHolderBinding,
  credkitDocumentLoader,
  issueCredkitCredential,
  verifyIssuedCredkitCredential,
  type CreateHolderBindingOptions,
  type HolderBinding,
  type IssueCredkitCredentialOptions,
  type NumericDeclarationEntry,
  type VerifyIssuedCredkitCredentialOptions,
} from './credkit.js';
export { generateEd25519KeyPair } from './ed25519.js';
export { signPresentation, verifyPresentation } from './presentation.js';
export { documentLoader, registerContext, resolveDid } from './loader.js';
export {
  UTOPIA_DL_NUMERIC_DECLARATIONS,
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
  VerifiablePresentation,
  BbsKeyPair,
  BbsSigner,
  Ed25519KeyPair,
  Ed25519Signer,
  PresentedCredentialResult,
  VerifyCredentialResult,
  VerifyPresentationResult,
  JsonLdContextEntry,
} from './types.js';
