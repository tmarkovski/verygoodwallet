// The tier-2 age predicate: prove an age threshold from a committed birthdate
// without revealing the birthdate.
//
// Statement (public inputs: commitment, cutoff_days):
//
//   ∃ dob_days, blinding:
//     commitment == Poseidon2(dob_days, blinding)  ∧  dob_days <= cutoff_days
//
// where dob_days is the holder's birth date and cutoff_days the latest
// qualifying birth date (e.g. 18 years before today), both as days since the
// Unix epoch. The commitment is the `birthDateCommitment` claim the issuer
// signed into the credential — created with poseidon-lite's `poseidon2`
// (circomlib parameters), which the vendored poseidon library matches; see
// @vgw/keys createCommitment.
//
// dob_days is a u32, so birth dates before 1970-01-01 are not representable
// (the ABI range check rejects them). Every demo persona is post-1970; a real
// deployment would commit to an offset epoch instead.
use poseidon::poseidon::bn254;

fn main(dob_days: u32, blinding: Field, commitment: pub Field, cutoff_days: pub u32) {
    let computed = bn254::hash_2([dob_days as Field, blinding]);
    assert(computed == commitment, "commitment does not open to dob_days under blinding");
    assert(dob_days <= cutoff_days, "birth date is after the cutoff");
}
