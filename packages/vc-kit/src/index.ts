/**
 * @vgw/vc-kit — W3C VC 2.0 Data Integrity operations on the credkit stack
 * (`credkit-bbs-sha-2026`, the one pinned era): live issuance since N2, live
 * presentation + server-side verification since N3, sole stack since N4
 * (the bbs-2023/eddsa-rdfc-2022 @digitalbazaar wrappers are gone).
 *
 * This package is the ONLY path through which VGW apps touch `@credkit/*`
 * (house pattern: apps import vc-kit facades, never credkit directly).
 *
 * - `generateCredkitBbsKeyPair(seed)` — deterministic issuer keys, did:key ids
 * - `bbsDidKeyFromPublicKey` / `bbsPublicKeyFromDidKey` — the validated codec
 *   between configured issuer DIDs and credkit's raw G2 trust anchor
 * - `createHolderBinding(...)` — holder link-secret commitment (blind issuance)
 * - `issueCredkitCredential(...)` — issuer blind-signed base proof
 * - `verifyIssuedCredkitCredential(...)` — holder receipt check
 * - `createCredkitPresentation(...)` — holder VP: selective disclosure +
 *   range claims over hidden twins, no holder identifier
 * - `verifyCredkitPresentation(...)` — the relying-party policy facade:
 *   configured issuer DIDs → raw G2 keys → verifyGraph → issuer /
 *   verification-method / validity policy, one fail-closed result
 * - `summarizeCredkitPresentation(...)` — envelope claim counts (route peek)
 * - `credkitNumericDeclarations(...)` / `credkitProofMode(...)` — a
 *   credential's declared twins + binding mode, from its base proof
 * - `mintSeededRangeParams(...)` + params codec/hash helpers — the published
 *   `/.well-known/credkit-params` alphabet (deterministic seeded mint)
 * - `credkitDocumentLoader` — the strict offline loader for every credkit call
 * - `buildUtopiaDriversLicense(...)` — demo credential template
 */
export {
  bbsDidKeyFromPublicKey,
  bbsPublicKeyFromDidKey,
  credkitCiphersuite,
  generateCredkitBbsKeyPair,
  type CredkitBbsKeyPair,
} from './keys.js';
export { DEFAULT_MANDATORY_POINTERS } from './mandatory.js';
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
export {
  createCredkitPresentation,
  credkitNumericDeclarations,
  credkitProofMode,
  getEncoder,
  summarizeCredkitPresentation,
  verifyCredkitPresentation,
  type CreateCredkitPresentationOptions,
  type CredkitPresentationCredential,
  type CredkitPresentationSummary,
  type ExpectedMembershipClaim,
  type ExpectedRangeClaim,
  type GraphEquality,
  type MembershipClaimRequest,
  type NumericEncoder,
  type ProofMode,
  type RangeClaimRequest,
  type VerifyCredkitPresentationOptions,
  type VerifyCredkitPresentationResult,
} from './credkitPresentation.js';
export {
  mintSeededRangeParams,
  rangeParamsFromBase64Url,
  rangeParamsHashBase64Url,
  rangeParamsToBase64Url,
  verifyRangeParams,
  type MintSeededRangeParamsOptions,
  type RangeParams,
} from './credkitParams.js';
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
  JsonLdContextEntry,
} from './types.js';
