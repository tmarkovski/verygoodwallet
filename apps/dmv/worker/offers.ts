/**
 * `/api/offers` input validation.
 *
 * The validated record rides inside the signed pre-authorized code (there is
 * no server-side session), so everything the credential endpoint will later
 * sign into a VC must be checked here — once, at the trust boundary where the
 * DMV clerk (the UI) asserts the citizen record.
 */

import { daysSinceEpoch } from "@vgw/keys";

export const NAME_MAX_LENGTH = 80;

/** 120 years in days — nobody older holds a Utopia license. */
const MAX_AGE_DAYS = Math.ceil(120 * 365.25);
const MS_PER_DAY = 86_400_000;

/** Same unambiguous alphabet the wallet's demo issuer uses (no I/L/O/0/1). */
const DOCUMENT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DOCUMENT_NUMBER_PATTERN = /^UDL-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

/** Signals a 400 `invalid_request`; anything else thrown here is a server bug. */
export class OfferValidationError extends Error {}

export interface OfferInput {
  givenName: string;
  familyName: string;
  /** ISO `YYYY-MM-DD`, validated as a real past date with age ≤ 120. */
  birthDate: string;
  /** Always present after parsing — auto-generated when the UI omits it. */
  documentNumber: string;
}

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

  const givenName = requireName(record["givenName"], "givenName");
  const familyName = requireName(record["familyName"], "familyName");

  const birthDate = record["birthDate"];
  if (typeof birthDate !== "string") {
    throw new OfferValidationError("birthDate is required");
  }
  // daysSinceEpoch rejects malformed strings and impossible calendar dates.
  let birthDays: number;
  try {
    birthDays = daysSinceEpoch(birthDate);
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
    return { givenName, familyName, birthDate, documentNumber: randomDocumentNumber() };
  }
  if (typeof documentNumber !== "string" || !DOCUMENT_NUMBER_PATTERN.test(documentNumber)) {
    throw new OfferValidationError(
      "documentNumber must match UDL-XXXX-XXXX (A-Z/2-9, excluding I, L, O, 0, 1)",
    );
  }
  return { givenName, familyName, birthDate, documentNumber };
}
