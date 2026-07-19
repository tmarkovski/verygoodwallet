/**
 * Plaintext credential metadata for list rendering.
 *
 * The full VC is always encrypted at rest; only this small `meta` object is
 * stored in the clear so the wallet can draw the card list without the vault
 * key. Pure module — no DOM, unit-tested in Node.
 */

import { credentialRevocationStatus, type VerifiableCredential } from "@vgw/vc-kit";

export interface CredentialMeta {
  /** Display name, e.g. "Utopia Driver's License". */
  name: string;
  issuerName: string;
  /** Primary credential type (first non-`VerifiableCredential` type). */
  kind: string;
  /** Seed for deterministic card coloring (see services/color.ts). */
  colorSeed: string;
}

const KIND_LABELS: Record<string, string> = {
  Iso18013DriversLicenseCredential: "Driver's license",
  UtopiaResidentRegistrationCredential: "Resident registration",
};

/** The primary (non-generic) credential type. */
export function credentialKind(vc: VerifiableCredential): string {
  const types = Array.isArray(vc.type) ? vc.type : [vc.type];
  return types.find((t) => t !== "VerifiableCredential") ?? "VerifiableCredential";
}

/** Human label for a credential kind, e.g. "Driver's license". */
export function kindLabel(kind: string): string {
  const known = KIND_LABELS[kind];
  if (known !== undefined) return known;
  const spaced = kind
    .replace(/Credential$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.length > 0 ? spaced : "Credential";
}

/** The issuer's display name (name if present, else DID, else a fallback). */
export function issuerDisplayName(vc: VerifiableCredential): string {
  const issuer = vc.issuer;
  if (typeof issuer === "string") return issuer;
  if (issuer !== undefined) {
    if (typeof issuer.name === "string" && issuer.name.length > 0) {
      return issuer.name;
    }
    return issuer.id;
  }
  return "Unknown issuer";
}

/** The issuer's DID, if any (for `verifyCredential({ expectedIssuer })`). */
export function issuerDid(vc: VerifiableCredential): string | undefined {
  const issuer = vc.issuer;
  if (typeof issuer === "string") return issuer;
  return issuer?.id;
}

/** One short labelled value on a card face, e.g. `No. UDL-3F7K-9Q2M`. */
export interface CardFaceField {
  label: string;
  value: string;
}

/**
 * What a card face shows beyond the plaintext meta: the holder line and up
 * to two document fields. Derived from the DECRYPTED credential — this is
 * display data for an unlocked wallet, never stored in the clear, so a
 * locked wallet still renders only the generic plate.
 */
export interface CardFace {
  holder?: string;
  fields: CardFaceField[];
  /**
   * Whether the credential is enrolled in its issuer's revocation registry
   * — shown as security microprint on the card face.
   */
  revocable: boolean;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** "Avery" + "Fontaine" → "AVERY FONTAINE" (either half optional). */
function holderLine(given: unknown, family: unknown): string | undefined {
  const name = [asString(given), asString(family)].filter(Boolean).join(" ");
  return name.length > 0 ? name.toUpperCase() : undefined;
}

/** ISO date(-time) → "MM/YYYY", the terse card-face expiry format. */
function monthYear(value: unknown): string | undefined {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})/.exec(value) : null;
  return match !== null ? `${match[2]}/${match[1]}` : undefined;
}

/** Kind-specific face data for a decrypted credential (null = plate only). */
export function cardFace(vc: VerifiableCredential): CardFace | null {
  const subject = vc.credentialSubject;
  if (subject === undefined || Array.isArray(subject)) return null;
  const bag = subject as Record<string, unknown>;
  const revocable = credentialRevocationStatus(vc) !== undefined;

  // Utopia DL: the claims live under the driversLicense node (snake_case).
  const dl = bag["driversLicense"];
  if (typeof dl === "object" && dl !== null && !Array.isArray(dl)) {
    const claims = dl as Record<string, unknown>;
    const fields: CardFaceField[] = [];
    const documentNumber = asString(claims["document_number"]);
    if (documentNumber !== undefined) fields.push({ label: "No.", value: documentNumber });
    const expires = monthYear(claims["expiry_date"]);
    if (expires !== undefined) fields.push({ label: "Expires", value: expires });
    const holder = holderLine(claims["given_name"], claims["family_name"]);
    return holder !== undefined || fields.length > 0
      ? { holder, fields, revocable }
      : null;
  }

  // Utopia Resident Registration: flat subject typed ['Person','UtopiaResident'].
  const types = bag["type"];
  if ((Array.isArray(types) ? types : [types]).includes("UtopiaResident")) {
    const fields: CardFaceField[] = [];
    const district = asString(bag["districtName"]);
    if (district !== undefined) fields.push({ label: "District", value: district });
    const postal = asString(bag["postalCode"]);
    if (postal !== undefined) fields.push({ label: "Postal", value: postal });
    const holder = holderLine(bag["givenName"], bag["familyName"]);
    return holder !== undefined || fields.length > 0
      ? { holder, fields, revocable }
      : null;
  }

  return null;
}

/** Derive the plaintext list metadata from a (signed) credential. */
export function metaFromCredential(vc: VerifiableCredential): CredentialMeta {
  const kind = credentialKind(vc);
  const name = typeof vc.name === "string" && vc.name.length > 0 ? vc.name : kindLabel(kind);
  return {
    name,
    issuerName: issuerDisplayName(vc),
    kind,
    colorSeed: kind,
  };
}
