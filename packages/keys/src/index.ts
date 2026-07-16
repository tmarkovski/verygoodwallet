/**
 * @vgw/keys — key derivation and vault crypto for VeryGoodWallet.
 *
 * Runtime-agnostic (browsers and Node 22+): WebCrypto only, no Node built-ins.
 */

export { fromBase64Url, fromHex, toBase64Url, toHex, utf8 } from "./encoding.js";
export { hkdfDerive } from "./hkdf.js";
export {
  ISSUANCE_POP_INFO_PREFIX,
  LINK_SECRET_INFO,
  PRESENTER_INFO_PREFIX,
  PRF_EVAL_INPUT,
  VAULT_INFO,
  deriveIssuancePopSeed,
  deriveLinkSecret,
  derivePresenterSeed,
  deriveVaultKey,
  describeHierarchy,
  issuancePopInfo,
  presenterInfo,
  previewSecret,
  type DerivationNode,
  type DescribeHierarchyOptions,
} from "./hierarchy.js";
export { decryptJson, encryptJson } from "./vault.js";
export {
  BLS12_381_SCALAR_FIELD_ORDER,
  scalarFromBase64Url,
  scalarToBase64Url,
} from "./scalar.js";
export {
  BN254_SCALAR_FIELD,
  createCommitment,
  daysSinceEpoch,
  verifyCommitment,
  type CommitmentResult,
} from "./commitment.js";
