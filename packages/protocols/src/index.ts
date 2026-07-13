/**
 * @vgw/protocols — OID4VCI wire types, did:key + proof JWT utilities, and the
 * stateless signed-token codec shared by the wallet and the issuer Worker.
 *
 * Runtime-agnostic (browsers, Cloudflare Workers, Node 22+): WebCrypto +
 * pure-JS crypto only, no Node built-ins.
 */

export {
  CREDENTIAL_CONFIGURATION_ID,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  walletOfferLink,
  type CommitmentOpeningLike,
  type CredentialConfiguration,
  type CredentialOffer,
  type CredentialRequest,
  type CredentialResponse,
  type IssuerMetadata,
  type LocalizedDisplay,
  type Oid4vciErrorResponse,
  type PreAuthorizedCodeGrant,
  type TokenResponse,
} from "./oid4vci.js";
export {
  didKeyToEd25519PublicKey,
  ed25519KeyPairFromSeed,
  type Ed25519DidKey,
} from "./didkey.js";
export {
  PROOF_JWT_TYP,
  createProofJwt,
  verifyProofJwt,
  type CreateProofJwtOptions,
  type ProofJwtHeader,
  type ProofJwtPayload,
  type VerifiedProofJwt,
  type VerifyProofJwtOptions,
} from "./popJwt.js";
export {
  mintSignedToken,
  readSignedToken,
  type MintSignedTokenOptions,
  type ReadSignedTokenOptions,
} from "./signedToken.js";
