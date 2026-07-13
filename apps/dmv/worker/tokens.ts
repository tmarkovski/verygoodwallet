/**
 * Payload shapes for the two stateless token kinds this issuer mints.
 *
 * Everything the credential endpoint needs — the citizen record and the
 * `c_nonce` — is embedded in the HMAC-signed payload, never stored server
 * side. The `use` discriminator prevents swapping one token kind for the
 * other (both are signed with the same TOKEN_SECRET). Single-use is NOT
 * enforced — a code or token replays until its TTL runs out (documented demo
 * tradeoff; the short TTLs bound the exposure).
 */

/** Pre-authorized code lifetime — long enough to scan a QR across devices. */
export const PRE_AUTHORIZED_CODE_TTL_SECONDS = 600;

/** Access token (and therefore c_nonce) lifetime. */
export const ACCESS_TOKEN_TTL_SECONDS = 300;

/** The citizen record carried through the flow inside the signed tokens. */
export interface SubjectClaims {
  givenName: string;
  familyName: string;
  birthDate: string;
  documentNumber: string;
}

/** Payload of a pre-authorized code (`readSignedToken` adds/checks `exp`). */
export interface OfferCodePayload extends SubjectClaims {
  use: "offer";
}

/**
 * Payload of an access token. `c_nonce` is minted at the token endpoint and
 * embedded here so the credential endpoint can verify the key proof's nonce
 * statelessly.
 */
export interface AccessTokenPayload extends SubjectClaims {
  use: "access";
  c_nonce: string;
}
