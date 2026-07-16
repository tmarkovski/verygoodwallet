/**
 * OID4VCI (OpenID for Verifiable Credential Issuance, draft-15 style) message
 * types and constants for the pre-authorized code flow.
 *
 * These types are the pinned wire contract between the DMV issuer Worker and
 * the wallet: both sides import them from here so drift is a type error, not
 * a runtime surprise.
 */

/** The OAuth grant type URN for the OID4VCI pre-authorized code flow. */
export const PRE_AUTHORIZED_CODE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:pre-authorized_code";

/**
 * The single credential configuration this demo issues. The wallet requests
 * it by this exact id at the credential endpoint.
 */
export const CREDENTIAL_CONFIGURATION_ID = "UtopiaDriversLicense";

export interface PreAuthorizedCodeGrant {
  "pre-authorized_code": string;
}

/**
 * A credential offer, delivered by reference (`credential_offer_uri`) so the
 * wallet link and QR payload stay short.
 */
export interface CredentialOffer {
  credential_issuer: string;
  credential_configuration_ids: string[];
  grants: {
    [PRE_AUTHORIZED_CODE_GRANT_TYPE]: PreAuthorizedCodeGrant;
  };
}

export interface LocalizedDisplay {
  name: string;
  locale?: string;
}

/** One entry of `credential_configurations_supported` in issuer metadata. */
export interface CredentialConfiguration {
  format: "ldp_vc";
  credential_definition: {
    "@context": string[];
    type: string[];
  };
  cryptographic_binding_methods_supported: string[];
  proof_types_supported: {
    jwt: { proof_signing_alg_values_supported: string[] };
  };
  display?: LocalizedDisplay[];
}

/** Served at `/.well-known/openid-credential-issuer` on the issuer origin. */
export interface IssuerMetadata {
  credential_issuer: string;
  credential_endpoint: string;
  token_endpoint: string;
  display?: LocalizedDisplay[];
  credential_configurations_supported: Record<string, CredentialConfiguration>;
  /**
   * VGW extension: the DID this issuer signs credentials under. Verifiers
   * fetch it over the issuer's TLS origin to pin `expectedIssuer` without
   * out-of-band configuration — the same trust model a did:web DID document
   * would formalize (planned follow-up; this field is its stand-in).
   */
  vgw_issuer_did?: string;
}

/**
 * Token endpoint success response. `c_nonce` is what the wallet must echo in
 * its proof-of-possession JWT — it binds the proof to this token exchange.
 */
export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  c_nonce: string;
  c_nonce_expires_in: number;
}

/**
 * Credential endpoint request body (sent with `Authorization: Bearer`).
 *
 * The `proof` slot stays the standard OID4VCI `proof_type: "jwt"` PoP —
 * request freshness (MIGRATION §3.3, option c). Holder BINDING rides
 * separately in `vgw_holder_commitment`, a documented VGW extension: the
 * base64url-encoded credkit `commitmentWithProof` bytes committing to the
 * wallet's link secret. The issuer blind-signs that commitment into the
 * credential without ever seeing the secret; the PoP JWT additionally signs
 * the commitment's SHA-256 digest (`vgw_commitment_digest`) so the liveness
 * proof attests a party actually holding THIS commitment — possession, not
 * fresh knowledge of the link secret (the commitment is a public value).
 */
export interface CredentialRequest {
  credential_configuration_id: string;
  proof: {
    proof_type: "jwt";
    jwt: string;
  };
  /**
   * base64url of the credkit `commitmentWithProof` bytes (the holder's
   * link-secret commitment). Required by the VGW DMV since N2 — issuance is
   * always holder-bound.
   */
  vgw_holder_commitment?: string;
}

/**
 * Credential endpoint success response. Since N2 (credkit blind issuance)
 * the response carries ONLY the credentials: no commitment opening travels —
 * the committed link secret is the holder's, the issuer never saw it, and
 * the wallet validates the credential with the holder-side receipt check
 * (`verifyIssuedCredkitCredential`) instead of opening a commitment.
 */
export interface CredentialResponse {
  credentials: { credential: Record<string, unknown> }[];
}

/** OAuth-style error body returned by the token and credential endpoints. */
export interface Oid4vciErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Build the wallet deep link for an offer: the wallet's `/offer` route reads
 * the `credential_offer_uri` search param and fetches the offer from it.
 */
export function walletOfferLink(
  walletOrigin: string,
  credentialOfferUri: string,
): string {
  return `${walletOrigin}/offer?credential_offer_uri=${encodeURIComponent(credentialOfferUri)}`;
}
