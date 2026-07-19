/**
 * Utopia Resident Registration credential template (W3C VC Data Model 2.0)
 * — the N5 credential (MIGRATION §5, Appendix D.5.4), issued by the same
 * DMV as the driver's license.
 *
 * One credential, two hidden numeric twins: `stateFips` (the district's
 * FIPS-like code — set membership at presentation) and `postalCode` (the
 * two-sided range), both declared `uint64` via
 * {@link UTOPIA_RESIDENT_NUMERIC_DECLARATIONS}. Together with the DL it
 * powers the composite "same person, no name" flow: both credentials are
 * blind-signed over the ONE master-derived link secret, so a holder can
 * elect to prove they hold both without disclosing anything else.
 *
 * Vocabulary split (MIGRATION §5): the ordinary person terms
 * (`givenName`/`familyName`) come from the bundled citizenship v3 context —
 * but its vocabulary is TYPE-SCOPED to `Person`, so the subject is typed
 * `['Person', 'UtopiaResident']`; the resident context defines the
 * `UtopiaResident` scope with `districtName` and the two predicate fields.
 * Citizenship v3 defines neither `stateFips` nor `postalCode` with a
 * datatype credkit's `uint64` encoder accepts (its `PostalAddress.postalCode`
 * is untyped and scoped to a type this subject does not carry).
 *
 * Datatype discipline — the part that fails closed at issuance if wrong:
 * credkit's `uint64` encoder reads the SIGNED QUAD's literal, so the value
 * must reach RDF as a canonical unsigned-integer lexical form under an
 * accepted datatype. The resident context coerces `stateFips`/`postalCode`
 * to `xsd:unsignedInt`, and this builder serializes both as canonical
 * decimal JSON STRINGS (exactly like the DL's context-typed `birth_date`
 * string): a JSON string's RDF lexical form is byte-identical to the JSON
 * value, where a JSON number would ride the serializer's number formatting
 * (scientific notation, precision) — a second spelling the encoder rejects.
 */
import type { NumericDeclarationEntry } from '@credkit/cryptosuite';
import {
  CITIZENSHIP_V3_CONTEXT_URL,
  CREDENTIALS_V2_CONTEXT_URL,
  UTOPIA_RESIDENT_V1_CONTEXT_URL,
  VGW_CONTEXT_URL,
} from '../contexts/index.js';
import type { VerifiableCredential } from '../types.js';

/**
 * The credkit numeric declarations for this credential (MIGRATION §5): the
 * district code and postal code become hidden `uint64` twins — invisible
 * metadata bound into the base proof's header, not document fields — so a
 * holder can prove `stateFips ∈ {set}` (residency membership, showcase B)
 * or `lo ≤ postalCode ≤ hi` (ZIP-in-block, the two-sided range) while both
 * values stay hidden. Pass this to `issueCredkitCredential` at every
 * resident issuance; without it the credential can never carry either
 * predicate.
 */
export const UTOPIA_RESIDENT_NUMERIC_DECLARATIONS: readonly NumericDeclarationEntry[] = [
  { pointer: '/credentialSubject/stateFips', encoder: 'uint64' },
  { pointer: '/credentialSubject/postalCode', encoder: 'uint64' },
];

/** Input for {@link buildUtopiaResidentRegistration}. */
export interface UtopiaResidentRegistrationInput {
  /** Subject DID; omitted from the credential when not provided (unlinkability by default). */
  subjectId?: string;
  givenName: string;
  familyName: string;
  /** District display name, e.g. 'Port Azure' (see utopia-geography.ts). */
  districtName: string;
  /** The district's FIPS-like code; a non-negative integer ≤ 4294967295. */
  stateFips: number;
  /** 5-digit-style postal code; a non-negative integer ≤ 4294967295. */
  postalCode: number;
  issuer: { id: string; name?: string };
  /**
   * ISO 8601 date-time; defaults to the start of the current UTC day.
   * Caution: `validFrom`/`validUntil` are mandatory-disclosed in every BBS
   * derived proof, so keep supplied values date-granular (a high-precision
   * timestamp would fingerprint the credential across verifiers).
   */
  validFrom?: string;
  /** ISO 8601 date-time; defaults to validFrom + 2 years. */
  validUntil?: string;
  /**
   * Revocation coordinates: the DMV registry URL (issuer-wide, harmless)
   * and this credential's fresh revocation id lexical (`mintRevocationId`).
   * Stamps a `credentialStatus` whose node stays BLANK — an `id` IRI there
   * would be a per-credential correlation handle in the open. Remember to
   * append `REVOCATION_NUMERIC_DECLARATION` to the issuance declarations so
   * the id becomes a hidden frScalar twin.
   */
  revocation?: { registry: string; revocationId: string };
}

/** Registrations renew on a shorter cycle than the 6-year license. */
const VALIDITY_YEARS = 2;

/** xsd:unsignedInt value space — the context's pinned datatype (32-bit). */
const XSD_UNSIGNED_INT_MAX = 4_294_967_295;

/**
 * Start of the current UTC day (date-granular on purpose — this value is
 * disclosed byte-identically in every derived proof; see the input note).
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
 * The canonical `xsd:unsignedInt` lexical form of a field: plain decimal
 * digits, no sign, no leading zeros, no exponent — produced from a safe
 * integer so `String(value)` cannot fall into scientific notation. Anything
 * else would be a second signed spelling of the same value, which credkit's
 * encoder rejects rather than repairs (see the module note).
 */
function canonicalUnsignedInt(value: number, field: string): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > XSD_UNSIGNED_INT_MAX) {
    throw new Error(
      `buildUtopiaResidentRegistration: ${field} must be an integer in [0, ${XSD_UNSIGNED_INT_MAX}], got ${String(value)}`
    );
  }
  return String(value);
}

/**
 * Builds an unsigned Utopia Resident Registration credential (VC 2.0),
 * ready for `issueCredkitCredential` (pass
 * {@link UTOPIA_RESIDENT_NUMERIC_DECLARATIONS} alongside it so the two
 * uint64 twins are declared).
 */
export function buildUtopiaResidentRegistration(
  input: UtopiaResidentRegistrationInput
): VerifiableCredential {
  const validFrom = input.validFrom ?? startOfTodayUtc();
  const validUntil = input.validUntil ?? defaultValidUntil(validFrom);

  const credentialSubject: Record<string, unknown> = {
    ...(input.subjectId !== undefined ? { id: input.subjectId } : {}),
    // 'Person' activates citizenship v3's type-scoped person vocabulary;
    // 'UtopiaResident' activates the resident context's predicate fields.
    type: ['Person', 'UtopiaResident'],
    givenName: input.givenName,
    familyName: input.familyName,
    districtName: input.districtName,
    stateFips: canonicalUnsignedInt(input.stateFips, 'stateFips'),
    postalCode: canonicalUnsignedInt(input.postalCode, 'postalCode'),
  };

  return {
    '@context': [
      CREDENTIALS_V2_CONTEXT_URL,
      CITIZENSHIP_V3_CONTEXT_URL,
      UTOPIA_RESIDENT_V1_CONTEXT_URL,
      // The VGW context carries the revocation vocabulary; harmless when
      // the credential is issued without a credentialStatus.
      VGW_CONTEXT_URL,
    ],
    type: ['VerifiableCredential', 'UtopiaResidentRegistrationCredential'],
    name: 'Utopia Resident Registration',
    description: 'Certifies residency in a district of the State of Utopia.',
    issuer:
      input.issuer.name !== undefined
        ? { id: input.issuer.id, name: input.issuer.name }
        : input.issuer.id,
    validFrom,
    validUntil,
    credentialSubject,
    ...(input.revocation !== undefined
      ? {
          credentialStatus: {
            type: 'VgwRevocationRegistryEntry',
            revocationRegistry: input.revocation.registry,
            revocationId: input.revocation.revocationId,
          },
        }
      : {}),
  };
}
