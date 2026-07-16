/**
 * Static JSON-LD contexts bundled with @vgw/vc-kit.
 *
 * All of these back `credkitDocumentLoader` (src/credkit.ts) — the strict,
 * offline loader passed to every credkit issue/present/verify call — so no
 * operation ever hits the network. Unknown context URLs are a hard error.
 */
import citizenshipV1 from './citizenship-v1.json';
import citizenshipV3 from './citizenship-v3.json';
import dataIntegrityV2 from './data-integrity-v2.json';
import multikeyV1 from './multikey-v1.json';
import openBadgesV3 from './openbadges-v3.json';
import retailCouponV1 from './retail-coupon-v1.json';
import utopiaResidentV1 from './utopia-resident-v1.json';
import vdlAamvaV1 from './vdl-aamva-v1.json';
import vdlV1 from './vdl-v1.json';
import vgwV1 from './vgw-v1.json';

/** W3C VC Data Model 2.0 context URL (ships inside securityLoader). */
export const CREDENTIALS_V2_CONTEXT_URL = 'https://www.w3.org/ns/credentials/v2';

/** ISO 18013 vDL vocabulary context URL. */
export const VDL_V1_CONTEXT_URL = 'https://w3id.org/vdl/v1';

/** AAMVA vDL extension context URL. */
export const VDL_AAMVA_V1_CONTEXT_URL = 'https://w3id.org/vdl/aamva/v1';

/**
 * VeryGoodWallet custom vocabulary context URL. Since N4 it defines no terms
 * — the ZK tier's `birthDateCommitment`/`zkAgeProof` vocabulary is retired
 * (age predicates prove against the hidden `date1900` twin instead; nothing
 * is disclosed to hang a term on). The URL stays in the DL's `@context` and
 * in `BUNDLED_CONTEXTS` as the anchored home for future VGW vocabulary.
 */
export const VGW_CONTEXT_URL = 'https://verygoodwallet.com/contexts/vgw/v1';

/**
 * W3C citizenship v3 vocabulary context URL. Its terms are TYPE-SCOPED: the
 * ordinary person vocabulary (`givenName`, `familyName`, `birthDate`, …)
 * only resolves on a node typed `Person` (or one of the document's other
 * subject types) — it defines no top-level property terms at all, and no
 * `stateFips`/`postalCode` anywhere (`PostalAddress.postalCode` exists but
 * is untyped and scoped to a type VGW subjects do not carry). That is why
 * the Utopia Resident credential types its subject `['Person',
 * 'UtopiaResident']` and defines its own predicate fields (MIGRATION §5).
 */
export const CITIZENSHIP_V3_CONTEXT_URL = 'https://w3id.org/citizenship/v3';

/**
 * Utopia Resident Registration vocabulary context URL (N5). Defines the
 * credential/subject types plus `districtName` and the two predicate fields
 * `stateFips`/`postalCode`, both coerced to canonical `xsd:unsignedInt`
 * literals — the datatype credkit's `uint64` twin encoder accepts.
 */
export const UTOPIA_RESIDENT_V1_CONTEXT_URL =
  'https://verygoodwallet.com/contexts/utopia-resident/v1';

/** W3C Data Integrity v2 context URL. */
export const DATA_INTEGRITY_V2_CONTEXT_URL =
  'https://w3id.org/security/data-integrity/v2';

/** W3C Multikey context URL (used by verification method documents). */
export const MULTIKEY_V1_CONTEXT_URL = 'https://w3id.org/security/multikey/v1';

/** URL → context document map of every static context bundled by this kit. */
export const BUNDLED_CONTEXTS: ReadonlyMap<string, object> = new Map<
  string,
  object
>([
  ['https://w3id.org/citizenship/v1', citizenshipV1],
  [CITIZENSHIP_V3_CONTEXT_URL, citizenshipV3],
  [DATA_INTEGRITY_V2_CONTEXT_URL, dataIntegrityV2],
  [MULTIKEY_V1_CONTEXT_URL, multikeyV1],
  ['https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json', openBadgesV3],
  ['https://contexts.vcplayground.org/examples/retail-coupon/v1.json', retailCouponV1],
  [UTOPIA_RESIDENT_V1_CONTEXT_URL, utopiaResidentV1],
  [VDL_AAMVA_V1_CONTEXT_URL, vdlAamvaV1],
  [VDL_V1_CONTEXT_URL, vdlV1],
  [VGW_CONTEXT_URL, vgwV1],
]);

export { vgwV1 as VGW_CONTEXT_DOCUMENT };
