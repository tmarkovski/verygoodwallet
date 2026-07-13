/**
 * Plaintext credential metadata for list rendering.
 *
 * The full VC is always encrypted at rest; only this small `meta` object is
 * stored in the clear so the wallet can draw the card list without the vault
 * key. Pure module — no DOM, unit-tested in Node.
 */

import type { VerifiableCredential } from "@vgw/vc-kit";

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
