/**
 * Payload shapes for the two stateless token kinds this issuer mints.
 *
 * Everything the credential endpoint needs — the citizen record, WHICH
 * credential configuration was offered, and the `c_nonce` — is embedded in
 * the HMAC-signed payload, never stored server side. The `use` discriminator
 * prevents swapping one token kind for the other (both are signed with the
 * same TOKEN_SECRET), and `configurationId` binds the token to the offered
 * credential so the credential endpoint only ever issues what was offered
 * (N5 hardening: with two configurations, an unbound token could redeem a
 * resident offer for a license or vice versa). Single-use is NOT enforced —
 * a code or token replays until its TTL runs out (documented demo tradeoff;
 * the short TTLs bound the exposure).
 */

import type {
  CREDENTIAL_CONFIGURATION_ID,
  RESIDENT_CREDENTIAL_CONFIGURATION_ID,
} from "@vgw/protocols";

/** Pre-authorized code lifetime — long enough to scan a QR across devices. */
export const PRE_AUTHORIZED_CODE_TTL_SECONDS = 600;

/** Access token (and therefore c_nonce) lifetime. */
export const ACCESS_TOKEN_TTL_SECONDS = 300;

/** The driver's-license citizen record (the pre-N5 shape plus its binding). */
export interface DriversLicenseClaims {
  configurationId: typeof CREDENTIAL_CONFIGURATION_ID;
  givenName: string;
  familyName: string;
  birthDate: string;
  documentNumber: string;
}

/**
 * The resident-registration record (N5). Only the district's FIPS-like code
 * travels — the credential endpoint re-derives the display name (and
 * re-checks the code) against the shared Utopia geography at issuance.
 */
export interface ResidentRegistrationClaims {
  configurationId: typeof RESIDENT_CREDENTIAL_CONFIGURATION_ID;
  givenName: string;
  familyName: string;
  districtFips: number;
  postalCode: number;
}

/** The citizen record carried through the flow inside the signed tokens. */
export type SubjectClaims = DriversLicenseClaims | ResidentRegistrationClaims;

/** Payload of a pre-authorized code (`readSignedToken` adds/checks `exp`). */
export type OfferCodePayload = { use: "offer" } & SubjectClaims;

/**
 * Payload of an access token. `c_nonce` is minted at the token endpoint and
 * embedded here so the credential endpoint can verify the key proof's nonce
 * statelessly.
 */
export type AccessTokenPayload = { use: "access"; c_nonce: string } & SubjectClaims;
