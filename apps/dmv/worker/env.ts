/**
 * Worker environment: secret resolution with dev fallbacks, and the
 * per-isolate memoized issuer key.
 *
 * Both secrets have hardcoded fallbacks so `vite dev` needs zero setup. They
 * are public in the repo, so anything minted or signed with them carries no
 * trust — production deployments must set the real Worker secrets
 * (see DEPLOY.md). A console.warn fires once per isolate when a fallback is
 * in use, so a misconfigured deploy is at least visible in the logs.
 */

import { fromHex } from "@vgw/keys";
import {
  createSeededRevocationAccumulator,
  deriveRevocationRegistryAuthority,
  generateCredkitBbsKeyPair,
  type CredkitBbsKeyPair,
  type CredkitRevocationRegistryAuthority,
} from "@vgw/vc-kit";

/**
 * Minimal Durable Object binding types, hand-rolled like every other binding
 * type in this repo (see apps/shop/worker/env.ts for why not
 * @cloudflare/workers-types). Only the surface actually used is declared.
 */
export type DurableObjectIdLike = object;

export interface DurableObjectStubLike {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

/** The `REGISTRY` binding: THE revocation registry (one instance). */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

/** Worker bindings (wrangler secrets/vars); all optional thanks to dev fallbacks. */
export interface DmvBindings {
  /** 64-char hex seed for the issuer BBS keypair — `wrangler secret put ISSUER_SEED`. */
  ISSUER_SEED?: string;
  /** HMAC-SHA-256 secret for signed codes/tokens — `wrangler secret put TOKEN_SECRET`. */
  TOKEN_SECRET?: string;
  /** Wallet origin for `wallet_link` in offers; overrides the localhost/production default. */
  WALLET_ORIGIN?: string;
  /** The revocation registry Durable Object namespace. */
  REGISTRY: DurableObjectNamespaceLike;
}

/** Dev-only issuer seed ("badd1ce5" ×8) — deliberately legible as a non-secret. */
export const DEV_ISSUER_SEED =
  "badd1ce5badd1ce5badd1ce5badd1ce5badd1ce5badd1ce5badd1ce5badd1ce5";

/** Dev-only HMAC secret; its name says everything about its trust level. */
export const DEV_TOKEN_SECRET = "vgw-dmv-dev-token-secret-not-for-production";

const ISSUER_SEED_PATTERN = /^[0-9a-f]{64}$/i;

let warnedIssuerSeed = false;
let warnedTokenSecret = false;

/**
 * The configured issuer seed, or the dev fallback. A *malformed* configured
 * seed throws instead of falling back — silently issuing under the dev key
 * because of a typo in a production secret would be worse than failing.
 */
export function resolveIssuerSeed(env: DmvBindings): string {
  const configured = env.ISSUER_SEED;
  if (configured !== undefined && configured !== "") {
    if (!ISSUER_SEED_PATTERN.test(configured)) {
      throw new Error(
        "ISSUER_SEED must be 64 hex characters (generate with: openssl rand -hex 32)",
      );
    }
    return configured.toLowerCase();
  }
  if (!warnedIssuerSeed) {
    warnedIssuerSeed = true;
    console.warn(
      "vgw-dmv: ISSUER_SEED is not set — issuing under the public dev seed. Set the Worker secret before trusting anything this issuer signs.",
    );
  }
  return DEV_ISSUER_SEED;
}

export function resolveTokenSecret(env: DmvBindings): string {
  const configured = env.TOKEN_SECRET;
  if (configured !== undefined && configured !== "") {
    return configured;
  }
  if (!warnedTokenSecret) {
    warnedTokenSecret = true;
    console.warn(
      "vgw-dmv: TOKEN_SECRET is not set — signing codes/tokens with the public dev secret. Set the Worker secret in production.",
    );
  }
  return DEV_TOKEN_SECRET;
}

/**
 * BLS12-381 keypair derivation is not cheap, and the key is a pure function
 * of the seed — derive it once per isolate. Keyed by seed (not a singleton)
 * so tests can exercise different envs against the same module instance.
 *
 * Since N2 this is the credkit key pair (synchronous `keyGen`). The issuer
 * DID is UNCHANGED for a fixed ISSUER_SEED: credkit and the retired
 * @digitalbazaar generator both implement the IETF BBS KeyGen and derive the
 * same key from the same seed (pinned cross-library test in vc-kit), so
 * verifiers keep discovering the same `vgw_issuer_did`.
 */
const keyPairBySeed = new Map<string, CredkitBbsKeyPair>();

export function getIssuerKeyPair(env: DmvBindings): CredkitBbsKeyPair {
  const seed = resolveIssuerSeed(env);
  let keyPair = keyPairBySeed.get(seed);
  if (keyPair === undefined) {
    keyPair = generateCredkitBbsKeyPair(fromHex(seed));
    keyPairBySeed.set(seed, keyPair);
  }
  return keyPair;
}

/**
 * Domain-separation tags for the two revocation derivations off ISSUER_SEED.
 * Distinct from each other and from every verifier params DST; changing
 * either rotates the registry and orphans every issued witness.
 */
const REGISTRY_KEY_DST = "VGW-DMV-CREDKIT-REVOCATION-KEY-V1";
const REGISTRY_ACCUMULATOR_DST = "VGW-DMV-CREDKIT-REVOCATION-ACCUMULATOR-V1";

/**
 * The registry authority (trapdoor alpha + public params), derived from the
 * SAME issuer seed as the BBS key under its own DST — the registry needs
 * zero key storage and every isolate agrees, exactly like the BBS key pair.
 * Alpha stays in Worker memory; it never travels to the Durable Object.
 */
const registryAuthorityBySeed = new Map<string, CredkitRevocationRegistryAuthority>();

export function getRegistryAuthority(env: DmvBindings): CredkitRevocationRegistryAuthority {
  const seed = resolveIssuerSeed(env);
  let authority = registryAuthorityBySeed.get(seed);
  if (authority === undefined) {
    authority = deriveRevocationRegistryAuthority({ seed, dst: REGISTRY_KEY_DST });
    registryAuthorityBySeed.set(seed, authority);
  }
  return authority;
}

/**
 * The registry's seeded initial accumulator V0 — deterministic so a wiped
 * dev Durable Object re-initializes to the identical value. The DO stores it
 * on first registration; this is what the Worker hands it (and what
 * `GET /api/registry` serves before anything is issued).
 */
const seededAccumulatorBySeed = new Map<string, string>();

export function getSeededAccumulator(env: DmvBindings): string {
  const seed = resolveIssuerSeed(env);
  let accumulator = seededAccumulatorBySeed.get(seed);
  if (accumulator === undefined) {
    accumulator = createSeededRevocationAccumulator({ seed, dst: REGISTRY_ACCUMULATOR_DST });
    seededAccumulatorBySeed.set(seed, accumulator);
  }
  return accumulator;
}
