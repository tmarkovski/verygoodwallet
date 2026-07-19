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
 * - `mintSeededRangeParams(...)` / `mintSeededSetParams(...)` + params
 *   codec/hash helpers — the published `/.well-known/credkit-params`
 *   alphabets (deterministic seeded mint; sets since N5)
 * - `credkitDocumentLoader` — the strict offline loader for every credkit call
 * - `buildUtopiaDriversLicense(...)` / `buildUtopiaResidentRegistration(...)`
 *   — demo credential templates (the resident carries the uint64 twins)
 * - `UTOPIA_DISTRICTS` / `districtByFips(...)` — the shared Utopia
 *   geography fiction (data-only; also exported as `@vgw/vc-kit/geography`)
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
  createSeededRevocationAccumulator,
  credentialRevocationStatus,
  deriveRevocationRegistryAuthority,
  issueRevocationWitness,
  mintRevocationId,
  parseRevocationRegistryState,
  refreshRevocationWitness,
  revokeRevocationIds,
  verifyRevocationWitness,
  REVOCATION_CLAIM_POINTER,
  REVOCATION_NUMERIC_DECLARATION,
  type CredentialRevocationStatus,
  type CredkitExpectedNonRevocationClaim,
  type CredkitNonRevocationClaim,
  type CredkitNonRevocationProveInput,
  type CredkitRevocationRegistryAuthority,
  type RefreshRevocationWitnessOptions,
  type RefreshRevocationWitnessResult,
  type RevocationRegistryState,
  type RevokeRevocationIdsOptions,
  type RevokeRevocationIdsResult,
} from './credkitRevocation.js';
export {
  mintSeededRangeParams,
  mintSeededSetParams,
  rangeParamsFromBase64Url,
  rangeParamsHashBase64Url,
  rangeParamsToBase64Url,
  setParamsFromBase64Url,
  setParamsHashBase64Url,
  setParamsToBase64Url,
  verifyRangeParams,
  verifySetParams,
  type MintSeededRangeParamsOptions,
  type MintSeededSetParamsOptions,
  type RangeParams,
  type SetMembershipParams,
} from './credkitParams.js';
export {
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  type UtopiaDriversLicenseInput,
} from './credentials/utopia-dl.js';
export {
  UTOPIA_RESIDENT_NUMERIC_DECLARATIONS,
  buildUtopiaResidentRegistration,
  type UtopiaResidentRegistrationInput,
} from './credentials/utopia-resident.js';
export {
  UTOPIA_DISTRICTS,
  districtByFips,
  type UtopiaDistrict,
} from './credentials/utopia-geography.js';
export {
  CITIZENSHIP_V3_CONTEXT_URL,
  CREDENTIALS_V2_CONTEXT_URL,
  UTOPIA_RESIDENT_V1_CONTEXT_URL,
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
