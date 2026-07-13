/**
 * Utopia Driver's License credential template (W3C VC Data Model 2.0).
 *
 * Modeled after the legacy Utopia DL demo credential (ISO 18013 vDL + AAMVA
 * vocabularies), upgraded from VC 1.1 to VC 2.0: `@context` leads with
 * `https://www.w3.org/ns/credentials/v2` and validity uses
 * `validFrom`/`validUntil` instead of `issuanceDate`/`expirationDate`.
 *
 * The VGW context adds `birthDateCommitment` — a Poseidon commitment to the
 * birth date whose opening stays in the wallet vault; disclosing only the
 * commitment enables the ZK age-predicate tier without revealing the date.
 */
import {
  CREDENTIALS_V2_CONTEXT_URL,
  VDL_V1_CONTEXT_URL,
  VDL_AAMVA_V1_CONTEXT_URL,
  VGW_CONTEXT_URL,
} from '../contexts/index.js';
import type { VerifiableCredential } from '../types.js';

/** Input for {@link buildUtopiaDriversLicense}. */
export interface UtopiaDriversLicenseInput {
  /** Subject DID; omitted from the credential when not provided (unlinkability by default). */
  subjectId?: string;
  givenName: string;
  familyName: string;
  /** ISO 8601 date, e.g. '1988-04-19'. */
  birthDate: string;
  documentNumber: string;
  /** Defaults to 'UADMV'. */
  issuingAuthority?: string;
  /** Poseidon(birthDate, blinding) commitment, multibase/hex string. */
  birthDateCommitment?: string;
  issuer: { id: string; name?: string };
  /**
   * ISO 8601 date-time; defaults to the start of the current UTC day.
   * Caution: `validFrom`/`validUntil` are mandatory-disclosed in every BBS
   * derived proof, so a high-precision timestamp (e.g. `Date.now()` at
   * millisecond precision) is a unique per-credential value that lets
   * verifiers correlate presentations. Keep supplied values date-granular.
   */
  validFrom?: string;
  /** ISO 8601 date-time; defaults to validFrom + 6 years. */
  validUntil?: string;
}

const VALIDITY_YEARS = 6;

/**
 * The mdoc-style age attestations stamped into every license (ISO 18013-5
 * `age_over_NN`, all defined by the vDL context). Computed once at issuance —
 * deliberately so: a flag that was true at issuance stays true, and one that
 * was false stays false even after the holder's birthday. That staleness is
 * the teaching point of the demo's tier ladder — precomputed flags require
 * the issuer to anticipate every cutoff AND every re-issuance, where the ZK
 * tier (M4) proves any cutoff from the committed birthdate at present time.
 */
const AGE_OVER_FLAGS = [18, 21, 25] as const;

/**
 * Start of the current UTC day. Date-granular on purpose: this value is
 * disclosed byte-identically in every derived proof (mandatory pointer), so
 * anything finer would fingerprint the credential across verifiers.
 */
function startOfTodayUtc(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * True when someone born on `birthDate` ('YYYY-MM-DD') has had their
 * `years`th birthday on or before `on`. Calendar arithmetic, not day counts:
 * the NNth birthday of a Feb 29 birth falls on Mar 1 in a non-leap year,
 * which `Date.UTC` month/day rollover produces for free.
 */
function hasReachedAge(birthDate: string, years: number, on: Date): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (match === null) {
    throw new Error(
      `buildUtopiaDriversLicense: birthDate must be 'YYYY-MM-DD', got ${JSON.stringify(birthDate)}`
    );
  }
  const [, year, month, day] = match;
  const birthday = Date.UTC(Number(year) + years, Number(month) - 1, Number(day));
  return birthday <= on.getTime();
}

function defaultValidUntil(validFrom: string): string {
  const date = new Date(validFrom);
  date.setUTCFullYear(date.getUTCFullYear() + VALIDITY_YEARS);
  return date.toISOString();
}

/**
 * Builds an unsigned Utopia Driver's License credential (VC 2.0), ready for
 * `signCredential`.
 */
export function buildUtopiaDriversLicense(
  input: UtopiaDriversLicenseInput
): VerifiableCredential {
  const validFrom = input.validFrom ?? startOfTodayUtc();
  const validUntil = input.validUntil ?? defaultValidUntil(validFrom);

  const issuedAt = new Date(validFrom);
  const driversLicense: Record<string, unknown> = {
    type: 'Iso18013DriversLicense',
    document_number: input.documentNumber,
    given_name: input.givenName,
    family_name: input.familyName,
    birth_date: input.birthDate,
    ...Object.fromEntries(
      AGE_OVER_FLAGS.map((years) => [
        `age_over_${years}`,
        hasReachedAge(input.birthDate, years, issuedAt),
      ])
    ),
    issuing_authority: input.issuingAuthority ?? 'UADMV',
    issuing_country: 'UA',
    un_distinguishing_sign: 'UTA',
    issue_date: validFrom,
    expiry_date: validUntil,
  };
  if (input.birthDateCommitment !== undefined) {
    driversLicense['birthDateCommitment'] = input.birthDateCommitment;
  }

  const credentialSubject: Record<string, unknown> = {
    ...(input.subjectId !== undefined ? { id: input.subjectId } : {}),
    type: 'LicensedDriver',
    driversLicense,
  };

  return {
    '@context': [
      CREDENTIALS_V2_CONTEXT_URL,
      VDL_V1_CONTEXT_URL,
      VDL_AAMVA_V1_CONTEXT_URL,
      VGW_CONTEXT_URL,
    ],
    type: ['VerifiableCredential', 'Iso18013DriversLicenseCredential'],
    name: "Utopia Driver's License",
    description: 'A license granting driving privileges in Utopia.',
    issuer:
      input.issuer.name !== undefined
        ? { id: input.issuer.id, name: input.issuer.name }
        : input.issuer.id,
    validFrom,
    validUntil,
    credentialSubject,
  };
}
