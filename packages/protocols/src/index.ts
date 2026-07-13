/**
 * @vgw/protocols — OID4VCI + OID4VP wire types, DCQL evaluation, did:key +
 * proof JWT utilities, the DC API adapter, and the stateless signed-token
 * codec shared by the wallet and the issuer/verifier Workers.
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
export {
  REDIRECT_URI_CLIENT_ID_PREFIX,
  assertDcqlQuery,
  presentationRequestFromParams,
  presentationRequestToParams,
  walletPresentLink,
  type DcqlClaimQuery,
  type DcqlCredentialQuery,
  type DcqlQuery,
  type DirectPostResult,
  type OauthErrorResponse,
  type PresentationRequest,
  type VpTokenMap,
} from "./oid4vp.js";
export {
  claimPathToPointer,
  matchDcqlCredentialQuery,
  matchDcqlQuery,
  type DcqlClaimMatch,
  type DcqlCredentialMatch,
  type DcqlQueryCandidates,
} from "./dcql.js";
export {
  OPENID4VP_DC_API_PROTOCOL,
  isDcApiSupported,
  requestDcApiCredential,
  toDcApiRequest,
  type DcApiOutcome,
  type DcApiRequest,
} from "./dcApi.js";
