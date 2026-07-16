/**
 * The Utopia geography fiction (MIGRATION §5, Appendix D.5.4) — the ONE
 * shared source of district names, FIPS-like codes, and postal blocks, so
 * the DMV's offer form and (at N5b) the rentals residency policy can never
 * drift apart. Deliberately data-only: no crypto, no imports — which
 * coastal districts form a verifier's membership SET is verifier policy (a
 * subset of these codes), never credential data.
 *
 * The fiction: the State of Utopia is carved into six districts. Codes in
 * the 1x block hug the coast, the 2x block is inland, and each district
 * owns one contiguous 5-digit postal block (no leading zeros anywhere —
 * both fields ride the credential as canonical `xsd:unsignedInt` literals,
 * where "05" would be a second spelling of 5).
 */

/** One district of the State of Utopia. */
export interface UtopiaDistrict {
  /** Display name, e.g. "Port Azure". */
  readonly name: string;
  /** FIPS-like district code — the credential's `stateFips` value. */
  readonly fips: number;
  /** The district's contiguous postal block, both bounds inclusive. */
  readonly postal: { readonly lo: number; readonly hi: number };
  /** Whether the district touches the Utopian coast. */
  readonly coastal: boolean;
}

/** Every district, in FIPS order. */
export const UTOPIA_DISTRICTS: readonly UtopiaDistrict[] = [
  { name: 'Port Azure', fips: 11, postal: { lo: 40100, hi: 40199 }, coastal: true },
  { name: 'Meridian Shores', fips: 12, postal: { lo: 40200, hi: 40299 }, coastal: true },
  { name: 'Coral Landing', fips: 13, postal: { lo: 40300, hi: 40399 }, coastal: true },
  { name: 'Highfield', fips: 21, postal: { lo: 41100, hi: 41199 }, coastal: false },
  { name: 'Amber Vale', fips: 22, postal: { lo: 41200, hi: 41299 }, coastal: false },
  { name: 'Stonereach', fips: 23, postal: { lo: 41300, hi: 41399 }, coastal: false },
];

/** Look a district up by its FIPS-like code; undefined when no such district. */
export function districtByFips(fips: number): UtopiaDistrict | undefined {
  return UTOPIA_DISTRICTS.find((district) => district.fips === fips);
}
