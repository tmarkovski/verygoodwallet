/**
 * Utopia Wheels' published proof alphabet (MIGRATION §8, Appendix D.3): ONE
 * range-params document per verifier, served at `/.well-known/credkit-params`
 * and consumed verbatim by every prover. Same design as the shop's — the two
 * verifiers are independent parties and deliberately do not share server
 * code, and their DSTs differ so even a shared seed would yield distinct
 * alphabets.
 *
 * Minting is deterministic — the alphabet derives from the verifier's secret
 * seed under this app's DST via the IETF seeded KDF — so every isolate and
 * cold start serves byte-identical params with zero storage. The per-isolate
 * cache below only avoids recomputing the 16 Boneh–Boyen signatures (and the
 * SHA-256) per request; it is keyed by seed so a rotated secret takes effect
 * on the next request without a deploy.
 */

import { CREDKIT_PARAMS_PATH, type CredkitParamsDocument } from "@vgw/protocols";
import {
  CREDKIT_CRYPTOSUITE,
  mintSeededRangeParams,
  rangeParamsHashBase64Url,
  rangeParamsToBase64Url,
  type RangeParams,
} from "@vgw/vc-kit";
import { resolveParamsSeed, type RentalsBindings } from "./env.js";

/** Domain-separation tag for THIS verifier's alphabet (the shop uses its own). */
const PARAMS_DST = "VGW-RENTALS-CREDKIT-RANGE-PARAMS-V1";

/** Age proofs decompose `bound − birth_date` into base-16 digits. */
export const RANGE_PARAMS_BASE = 16;

/** The minted alphabet plus everything derived from it, computed once per seed. */
export interface RentalsRangeParams {
  /** The live params object `verifyGraph` expectations are built from. */
  params: RangeParams;
  /** base64url `rangeParamsToOctets` — the published `range.params` value. */
  octets: string;
  /** base64url SHA-256 of the octets — document `hash` AND DCQL `params_hash`. */
  hash: string;
  /** The document served at {@link CREDKIT_PARAMS_PATH}. */
  document: CredkitParamsDocument;
}

const cache = new Map<string, Promise<RentalsRangeParams>>();

async function mint(seed: string): Promise<RentalsRangeParams> {
  const params = mintSeededRangeParams({ seed, dst: PARAMS_DST, base: RANGE_PARAMS_BASE });
  const octets = rangeParamsToBase64Url(params);
  const hash = await rangeParamsHashBase64Url(params);
  const document: CredkitParamsDocument = {
    version: 1,
    suite: CREDKIT_CRYPTOSUITE,
    range: { base: RANGE_PARAMS_BASE, params: octets, hash },
  };
  return { params, octets, hash, document };
}

/** This isolate's alphabet for the configured seed (lazy, cached). */
export function getRangeParams(env: RentalsBindings): Promise<RentalsRangeParams> {
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
