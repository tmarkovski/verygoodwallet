/**
 * Worker environment: secret resolution with dev fallbacks, trusted-issuer
 * DID discovery, and the minimal Durable Object types this Worker uses.
 *
 * Mirrors the shop Worker's env module — the two verifiers are independent
 * parties in the demo's story, so they deliberately do not share server
 * code, only the pinned wire contracts in @vgw/protocols.
 *
 * The Durable Object interfaces are hand-rolled (like every other binding
 * type in this repo) instead of pulling in @cloudflare/workers-types, whose
 * global lib redefinitions conflict with the DOM lib the UI half of this
 * app compiles against. Only the surface actually used is declared.
 */

/** Opaque Durable Object id (never inspected, only passed back to get()). */
export type DurableObjectIdLike = object;

/** The fetch-facing stub for one Durable Object instance. */
export interface DurableObjectStubLike {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

/** The `SESSIONS` binding: one Durable Object per verification session. */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

/** Worker bindings (wrangler secrets/vars + the Durable Object namespace). */
export interface RentalsBindings {
  /** HMAC-SHA-256 secret for signed state tokens — `wrangler secret put TOKEN_SECRET`. */
  TOKEN_SECRET?: string;
  /** Wallet origin for `wallet_link` in verification sessions. */
  WALLET_ORIGIN?: string;
  /** Issuer origin whose metadata names the trusted issuer DID. */
  DMV_ORIGIN?: string;
  /** Pin the trusted issuer DID directly (skips metadata discovery). */
  TRUSTED_ISSUER_DID?: string;
  SESSIONS: DurableObjectNamespaceLike;
}

/** Dev-only HMAC secret; its name says everything about its trust level. */
export const DEV_TOKEN_SECRET = "vgw-rentals-dev-token-secret-not-for-production";

/** Dev fallback: the DMV Worker's `vite dev` origin (see apps/dmv/vite.config.ts). */
export const DEV_DMV_ORIGIN = "http://localhost:5174";

let warnedTokenSecret = false;
let warnedDmvOrigin = false;

export function resolveTokenSecret(env: RentalsBindings): string {
  const configured = env.TOKEN_SECRET;
  if (configured !== undefined && configured !== "") {
    return configured;
  }
  if (!warnedTokenSecret) {
    warnedTokenSecret = true;
    console.warn(
      "vgw-rentals: TOKEN_SECRET is not set — signing state tokens with the public dev secret. Set the Worker secret in production.",
    );
  }
  return DEV_TOKEN_SECRET;
}

/**
 * The issuer origin to discover the trusted issuer DID from. A malformed
 * configured value throws instead of falling back — silently trusting the
 * dev DMV because of a typo in a production var would be worse than failing.
 */
export function resolveDmvOrigin(env: RentalsBindings): string {
  const configured = env.DMV_ORIGIN;
  if (configured !== undefined && configured !== "") {
    try {
      return new URL(configured).origin;
    } catch {
      throw new Error(
        `DMV_ORIGIN must be an absolute origin (e.g. https://dmv.example), got: ${configured}`,
      );
    }
  }
  if (!warnedDmvOrigin) {
    warnedDmvOrigin = true;
    console.warn(
      `vgw-rentals: DMV_ORIGIN is not set — discovering the trusted issuer from the dev DMV at ${DEV_DMV_ORIGIN}. Set the Worker var in production.`,
    );
  }
  return DEV_DMV_ORIGIN;
}

/**
 * Per-isolate cache of discovered issuer DIDs, keyed by issuer origin. The
 * DID is stable for the life of the issuer's signing key, so caching until
 * isolate recycle is safe — and it keeps verification from adding a
 * cross-Worker fetch per presentation.
 */
const issuerDidByOrigin = new Map<string, Promise<string>>();

/**
 * The issuer DID every presented credential must be signed by.
 *
 * `TRUSTED_ISSUER_DID` pins it directly; otherwise it is discovered from the
 * DMV's issuer metadata (`vgw_issuer_did`), fetched over the DMV's TLS
 * origin — the same trust model as a did:web resolution, which this is the
 * stand-in for. Fails closed: no DID, no verification.
 *
 * Production deploys PIN the DID (the Deploy Rentals workflow discovers it
 * at deploy time): worker-to-worker fetches between *.workers.dev hosts on
 * the same account don't route to the target Worker, so runtime discovery
 * only works in dev (localhost) and, post-M6, across custom domains.
 */
export function trustedIssuerDid(
  env: RentalsBindings,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const pinned = env.TRUSTED_ISSUER_DID;
  if (pinned !== undefined && pinned !== "") {
    return Promise.resolve(pinned);
  }
  const origin = resolveDmvOrigin(env);
  let discovery = issuerDidByOrigin.get(origin);
  if (discovery === undefined) {
    discovery = discoverIssuerDid(origin, fetchImpl);
    // A failed discovery must not be cached — the DMV may simply not be up
    // yet (dev) or momentarily unreachable.
    discovery.catch(() => issuerDidByOrigin.delete(origin));
    issuerDidByOrigin.set(origin, discovery);
  }
  return discovery;
}

async function discoverIssuerDid(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const url = `${origin}/.well-known/openid-credential-issuer`;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new Error(
      `Could not reach the issuer metadata at ${url} to discover the trusted issuer DID`,
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Issuer metadata request to ${url} failed with HTTP ${response.status}`,
    );
  }
  let metadata: unknown;
  try {
    metadata = await response.json();
  } catch (cause) {
    throw new Error(`Issuer metadata at ${url} is not valid JSON`, { cause });
  }
  const did =
    typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)["vgw_issuer_did"]
      : undefined;
  if (typeof did !== "string" || !did.startsWith("did:")) {
    throw new Error(
      `Issuer metadata at ${url} carries no vgw_issuer_did — cannot establish a trusted issuer`,
    );
  }
  return did;
}

/** Test hook: clear the discovery cache between cases. */
export function clearIssuerDidCache(): void {
  issuerDidByOrigin.clear();
}
