/**
 * Utopia Wheels' published proof alphabets (MIGRATION §8, Appendix D.3,
 * D.5.5): ONE params document per verifier, served at
 * `/.well-known/credkit-params` and consumed verbatim by every prover. Since
 * N5b it carries TWO alphabets — the base-16 range alphabet behind the age
 * predicates and the "coastal" set-membership alphabet behind the resident
 * rate (the shop stays range-only). Same design as the shop's — the two
 * verifiers are independent parties and deliberately do not share server
 * code, and their DSTs differ so even a shared seed would yield distinct
 * alphabets.
 *
 * Minting is deterministic — both alphabets derive from the verifier's
 * secret seed under app-specific DSTs via the IETF seeded KDF — so every
 * isolate and cold start serves byte-identical params with zero storage. The
 * per-isolate cache below only avoids recomputing the Boneh–Boyen signatures
 * (and the SHA-256s) per request; it is keyed by seed so a rotated secret
 * takes effect on the next request without a deploy.
 *
 * THE COASTAL SET is verifier policy (D.5.4): the fips codes of the
 * geography's `coastal: true` districts, as set members in PUBLICATION order
 * — the transcript binds the order, so it is part of the alphabet's identity
 * (pinned by an N5a vc-kit test).
 */

import { CREDKIT_PARAMS_PATH, type CredkitParamsDocument } from "@vgw/protocols";
import {
  CREDKIT_CRYPTOSUITE,
  UTOPIA_DISTRICTS,
  mintSeededRangeParams,
  mintSeededSetParams,
  rangeParamsHashBase64Url,
  rangeParamsToBase64Url,
  setParamsHashBase64Url,
  setParamsToBase64Url,
  type RangeParams,
  type SetMembershipParams,
} from "@vgw/vc-kit";
import { resolveParamsSeed, type RentalsBindings } from "./env.js";

/** Domain-separation tag for THIS verifier's range alphabet (the shop uses its own). */
const PARAMS_DST = "VGW-RENTALS-CREDKIT-RANGE-PARAMS-V1";

/** Age proofs decompose `bound − birth_date` into base-16 digits. */
export const RANGE_PARAMS_BASE = 16;

/** The one set this verifier publishes: the coastal-district fips codes. */
export const COASTAL_SET_ID = "coastal";

/** One DST per set id (D.5.5's convention): `VGW-<APP>-CREDKIT-SET-PARAMS-<set_id>-V1`. */
const COASTAL_SET_DST = `VGW-RENTALS-CREDKIT-SET-PARAMS-${COASTAL_SET_ID}-V1`;

/**
 * The coastal set's members: fips codes of the coastal districts, in
 * publication (declaration) order — rentals VERIFIER POLICY, a subset of the
 * shared geography, never credential data.
 */
export const COASTAL_SET_MEMBERS: readonly bigint[] = UTOPIA_DISTRICTS.filter(
  (district) => district.coastal,
).map((district) => BigInt(district.fips));

/** One minted alphabet plus its wire encodings. */
export interface MintedAlphabet<P> {
  /** The live params object `verifyGraph` expectations are built from. */
  params: P;
  /** base64url of the serialized octets — the published `params` value. */
  octets: string;
  /** base64url SHA-256 of the octets — document hash AND DCQL `params_hash`. */
  hash: string;
}

/** Both minted alphabets plus the served document, computed once per seed. */
export interface RentalsVerifierParams {
  /** The range alphabet (age predicates). */
  range: MintedAlphabet<RangeParams>;
  /** The coastal set alphabet (resident-rate membership). */
  coastalSet: MintedAlphabet<SetMembershipParams>;
  /** The document served at {@link CREDKIT_PARAMS_PATH}. */
  document: CredkitParamsDocument;
  /** Back-compat convenience: the live range params (== range.params). */
  params: RangeParams;
  /** Back-compat convenience: the range hash (== range.hash). */
  hash: string;
}

const cache = new Map<string, Promise<RentalsVerifierParams>>();

async function mint(seed: string): Promise<RentalsVerifierParams> {
  const rangeParams = mintSeededRangeParams({
    seed,
    dst: PARAMS_DST,
    base: RANGE_PARAMS_BASE,
  });
  const rangeOctets = rangeParamsToBase64Url(rangeParams);
  const rangeHash = await rangeParamsHashBase64Url(rangeParams);

  const setParams = mintSeededSetParams({
    seed,
    dst: COASTAL_SET_DST,
    members: COASTAL_SET_MEMBERS,
  });
  const setOctets = setParamsToBase64Url(setParams);
  const setHash = await setParamsHashBase64Url(setParams);

  const document: CredkitParamsDocument = {
    version: 1,
    suite: CREDKIT_CRYPTOSUITE,
    range: { base: RANGE_PARAMS_BASE, params: rangeOctets, hash: rangeHash },
    sets: { [COASTAL_SET_ID]: { params: setOctets, hash: setHash } },
  };
  return {
    range: { params: rangeParams, octets: rangeOctets, hash: rangeHash },
    coastalSet: { params: setParams, octets: setOctets, hash: setHash },
    document,
    params: rangeParams,
    hash: rangeHash,
  };
}

/** This isolate's alphabets for the configured seed (lazy, cached). */
export function getVerifierParams(env: RentalsBindings): Promise<RentalsVerifierParams> {
  const seed = resolveParamsSeed(env);
  let minted = cache.get(seed);
  if (minted === undefined) {
    minted = mint(seed);
    // A failed mint must not poison the cache (it would 500 forever).
    minted.catch(() => cache.delete(seed));
    cache.set(seed, minted);
  }
  return minted;
}

export { CREDKIT_PARAMS_PATH };
