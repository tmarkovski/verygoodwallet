/**
 * Quick-fill citizen records for the demo counter. Jamie Voss is the shared
 * demo persona across the VGW apps; the under-18 record exists so the later
 * verifier demos (age predicates) have someone who must fail an 18+ check.
 * Each persona also carries a home district + postal code for the N5
 * Resident Registration — Jamie lives coastal (Port Azure) so the later
 * coastal-residency demos have someone who passes, Noa inland (Highfield)
 * so they have someone who must fail.
 */

export interface Persona {
  note: string;
  givenName: string;
  familyName: string;
  /** ISO YYYY-MM-DD. */
  birthDate: string;
  /** Home district's FIPS-like code (see @vgw/vc-kit/geography). */
  districtFips: number;
  /** Postal code inside that district's block. */
  postalCode: number;
}

export const PERSONAS: Persona[] = [
  {
    note: "adult",
    givenName: "Jamie",
    familyName: "Voss",
    birthDate: "1996-03-14",
    districtFips: 11, // Port Azure — coastal
    postalCode: 40125,
  },
  {
    note: "under 18",
    givenName: "Noa",
    familyName: "Lindqvist",
    birthDate: "2009-11-02",
    districtFips: 21, // Highfield — inland
    postalCode: 41142,
  },
  {
    note: "senior",
    givenName: "Marisol",
    familyName: "Deng",
    birthDate: "1958-06-21",
    districtFips: 13, // Coral Landing — coastal
    postalCode: 40317,
  },
];
