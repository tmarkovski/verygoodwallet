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
 * Start of the current UTC day. Date-granular on purpose: this value is
 * disclosed byte-identically in every derived proof (mandatory pointer), so
 * anything finer would fingerprint the credential across verifiers.
 */
function startOfTodayUtc(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
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

  const driversLicense: Record<string, unknown> = {
    type: 'Iso18013DriversLicense',
    document_number: input.documentNumber,
    given_name: input.givenName,
    family_name: input.familyName,
    birth_date: input.birthDate,
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
