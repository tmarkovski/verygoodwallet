/**
 * Quick-fill citizen records for the demo counter. Jamie Voss is the shared
 * demo persona across the VGW apps; the under-18 record exists so the later
 * verifier demos (age predicates) have someone who must fail an 18+ check.
 */

export interface Persona {
  note: string;
  givenName: string;
  familyName: string;
  /** ISO YYYY-MM-DD. */
  birthDate: string;
}

export const PERSONAS: Persona[] = [
  { note: "adult", givenName: "Jamie", familyName: "Voss", birthDate: "1996-03-14" },
  { note: "under 18", givenName: "Noa", familyName: "Lindqvist", birthDate: "2009-11-02" },
  { note: "senior", givenName: "Marisol", familyName: "Deng", birthDate: "1958-06-21" },
];
