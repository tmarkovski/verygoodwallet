/**
 * @vgw/keys — key derivation and vault crypto for VeryGoodWallet.
 *
 * Runtime-agnostic (browsers and Node 22+): WebCrypto only, no Node built-ins.
 */

export { fromBase64Url, fromHex, toBase64Url, toHex, utf8 } from "./encoding.js";
export { hkdfDerive } from "./hkdf.js";
export {
  HOLDER_INFO_PREFIX,
  LINK_SECRET_INFO,
  PRESENTER_INFO_PREFIX,
  PRF_EVAL_INPUT,
  VAULT_INFO,
  deriveHolderSeed,
  deriveLinkSecret,
  derivePresenterSeed,
  deriveVaultKey,
  describeHierarchy,
  holderInfo,
  presenterInfo,
  previewSecret,
  type DerivationNode,
  type DescribeHierarchyOptions,
} from "./hierarchy.js";
export { decryptJson, encryptJson } from "./vault.js";
export {
  BN254_SCALAR_FIELD,
  createCommitment,
  daysSinceEpoch,
  verifyCommitment,
  type CommitmentResult,
} from "./commitment.js";
