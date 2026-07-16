/**
 * `/api/offers` input validation.
 *
 * The validated record rides inside the signed pre-authorized code (there is
 * no server-side session), so everything the credential endpoint will later
 * sign into a VC must be checked here — once, at the trust boundary where the
 * DMV clerk (the UI) asserts the citizen record.
 *
 * Since N5 the body carries a credential-kind discriminator —
 * `credential_configuration_id`, defaulting to the driver's license for
 * pre-N5 callers — and the resident shape validates its district against
 * the shared Utopia geography (the district's FIPS-like code must exist and
 * the postal code must sit inside that district's block).
 */

import {
  CREDENTIAL_CONFIGURATION_ID,
  RESIDENT_CREDENTIAL_CONFIGURATION_ID,
} from "@vgw/protocols";
import { districtByFips } from "@vgw/vc-kit";
import type { SubjectClaims } from "./tokens.js";

export const NAME_MAX_LENGTH = 80;

/** 120 years in days — nobody older holds a Utopia license. */
const MAX_AGE_DAYS = Math.ceil(120 * 365.25);
const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Days since the Unix epoch for a `'YYYY-MM-DD'` date, computed in UTC.
 * Throws on malformed strings and impossible calendar dates (the UTC
 * round-trip catches e.g. `'2023-02-30'`). Local replacement for the
 * Poseidon-era `daysSinceEpoch` that left `@vgw/keys` at N4 — the offer
 * validation semantics are unchanged (MIGRATION Appendix B).
 */
function birthDateToEpochDays(isoDate: string): number {
  const match = ISO_DATE.exec(isoDate);
  if (!match) {
    throw new Error(`expected 'YYYY-MM-DD', got ${JSON.stringify(isoDate)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`invalid calendar date ${JSON.stringify(isoDate)}`);
  }
  return ms / MS_PER_DAY;
}

/** Same unambiguous alphabet the wallet's demo issuer uses (no I/L/O/0/1). */
const DOCUMENT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DOCUMENT_NUMBER_PATTERN = /^UDL-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

/** Signals a 400 `invalid_request`; anything else thrown here is a server bug. */
export class OfferValidationError extends Error {}

/**
 * The validated offer record: the citizen claims PLUS the configuration id
 * the offer is for — the discriminated union the signed tokens carry
 * (tokens.ts). For the license shape, `birthDate` is validated as a real
 * past date with age ≤ 120 and `documentNumber` is auto-generated when the
 * UI omits it.
 */
export type OfferInput = SubjectClaims;

/** Unambiguous document number, e.g. `UDL-K4Q7-XW2M`. */
export function randomDocumentNumber(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const byte of bytes) {
    out += DOCUMENT_ALPHABET.charAt(byte % DOCUMENT_ALPHABET.length);
  }
  return `UDL-${out.slice(0, 4)}-${out.slice(4)}`;
}

function requireName(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OfferValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new OfferValidationError(
      `${field} must be at most ${NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Validate an offer request body. Throws {@link OfferValidationError} on bad input. */
export function parseOfferInput(body: unknown): OfferInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new OfferValidationError("request body must be a JSON object");
  }
  const record = body as Record<string, unknown>;

  // The credential-kind discriminator; absent means the driver's license
  // (the only kind that existed before N5 — API compatibility).
  const configurationId = record["credential_configuration_id"] ?? CREDENTIAL_CONFIGURATION_ID;
  if (configurationId === RESIDENT_CREDENTIAL_CONFIGURATION_ID) {
    return parseResidentOffer(record);
  }
  if (configurationId !== CREDENTIAL_CONFIGURATION_ID) {
    throw new OfferValidationError(
      `credential_configuration_id must be ${CREDENTIAL_CONFIGURATION_ID} or ${RESIDENT_CREDENTIAL_CONFIGURATION_ID}`,
    );
  }

  const givenName = requireName(record["givenName"], "givenName");
  const familyName = requireName(record["familyName"], "familyName");

  const birthDate = record["birthDate"];
  if (typeof birthDate !== "string") {
    throw new OfferValidationError("birthDate is required");
  }
  // birthDateToEpochDays rejects malformed strings and impossible calendar dates.
  let birthDays: number;
  try {
    birthDays = birthDateToEpochDays(birthDate);
  } catch {
    throw new OfferValidationError("birthDate must be a real 'YYYY-MM-DD' date");
  }
  const todayDays = Math.floor(Date.now() / MS_PER_DAY);
  if (birthDays >= todayDays) {
    throw new OfferValidationError("birthDate must be in the past");
  }
  if (todayDays - birthDays > MAX_AGE_DAYS) {
    throw new OfferValidationError("birthDate implies an age over 120");
  }

  const documentNumber = record["documentNumber"];
  if (documentNumber === undefined || documentNumber === null || documentNumber === "") {
    return {
      configurationId: CREDENTIAL_CONFIGURATION_ID,
      givenName,
      familyName,
      birthDate,
      documentNumber: randomDocumentNumber(),
    };
  }
  if (typeof documentNumber !== "string" || !DOCUMENT_NUMBER_PATTERN.test(documentNumber)) {
    throw new OfferValidationError(
      "documentNumber must match UDL-XXXX-XXXX (A-Z/2-9, excluding I, L, O, 0, 1)",
    );
  }
  return {
    configurationId: CREDENTIAL_CONFIGURATION_ID,
    givenName,
    familyName,
    birthDate,
    documentNumber,
  };
}

/**
 * The resident-registration offer shape (N5): names as for the license,
 * plus a district selected from the shared Utopia geography — the UI sends
 * the district's FIPS-like code and a postal code, the worker validates the
 * code against the geography list and the postal code against that
 * district's block. Both must be plain JSON integers (they become canonical
 * `xsd:unsignedInt` literals at issuance).
 */
function parseResidentOffer(record: Record<string, unknown>): OfferInput {
  const givenName = requireName(record["givenName"], "givenName");
  const familyName = requireName(record["familyName"], "familyName");

  const districtFips = record["districtFips"];
  if (typeof districtFips !== "number" || !Number.isInteger(districtFips)) {
    throw new OfferValidationError("districtFips must be an integer district code");
  }
  const district = districtByFips(districtFips);
  if (district === undefined) {
    throw new OfferValidationError(
      `districtFips ${districtFips} names no Utopia district`,
    );
  }

  const postalCode = record["postalCode"];
  if (typeof postalCode !== "number" || !Number.isInteger(postalCode)) {
    throw new OfferValidationError("postalCode must be an integer");
  }
  if (postalCode < district.postal.lo || postalCode > district.postal.hi) {
    throw new OfferValidationError(
      `postalCode must be inside ${district.name}'s block ${district.postal.lo}–${district.postal.hi}`,
    );
  }

  return {
    configurationId: RESIDENT_CREDENTIAL_CONFIGURATION_ID,
    givenName,
    familyName,
    districtFips,
    postalCode,
  };
}
