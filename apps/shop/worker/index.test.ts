/**
 * Verifier Worker tests — full-fidelity: real credkit credentials (blind-
 * issued, holder-bound), real presentations (selective disclosure + range
 * proofs over the hidden birth_date twin), and the real VerificationSessions
 * class running against Map-backed storage. Only the Durable Object
 * *namespace* is stubbed (plain-Node vitest has no workerd).
 *
 * The "wallet side" of each flow is spoken inline: fetch the published
 * params from the Worker's own endpoint, answer the per-request DCQL query,
 * and direct_post the vp_token — so what these tests accept is exactly what
 * the wallet produces.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REVOCATION_CLAIM_POINTER,
  REVOCATION_NUMERIC_DECLARATION,
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  createCredkitPresentation,
  createHolderBinding,
  createSeededRevocationAccumulator,
  deriveRevocationRegistryAuthority,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
  issueRevocationWitness,
  mintRevocationId,
  rangeParamsFromBase64Url,
  rangeParamsHashBase64Url,
  refreshRevocationWitness,
  revokeRevocationIds,
  type CredkitBbsKeyPair,
  type CredkitNonRevocationProveInput,
  type HolderBinding,
  type RangeClaimRequest,
  type RangeParams,
  type RevocationRegistryState,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import {
  CREDKIT_PARAMS_PATH,
  assertCredkitParamsDocument,
  mintSignedToken,
  type OauthErrorResponse,
  type PresentationRequest,
} from "@vgw/protocols";
import { createApp, type VerificationSessionBody } from "./index.js";
import {
  clearIssuerDidCache,
  trustedIssuerDid,
  type DurableObjectNamespaceLike,
  type ShopBindings,
} from "./env.js";
import { AGE_QUERY_ID, BIRTH_DATE_POINTER } from "./policy.js";
import { VerificationSessions, type SessionStatus } from "./sessions.js";

const app = createApp();

const ISSUER_SEED = new Uint8Array(32).fill(11);
const ROGUE_ISSUER_SEED = new Uint8Array(32).fill(12);
/** The wallet's one-for-life link secret (fixed for determinism). */
const LINK_SECRET = new Uint8Array(32).fill(13);

/** app.request resolves bare paths against this origin. */
const SHOP_ORIGIN = "http://localhost";

const ADULT_BIRTH_DATE = "1988-04-19";
const MINOR_BIRTH_DATE = "2009-11-02";

interface IssuedFixture {
  vc: VerifiableCredential;
  binding: Pick<HolderBinding, "linkSecret" | "secretProverBlind">;
  /** The credential's registry coordinates + the holder's witness sidecar. */
  revocationId: string;
  witness: string;
  witnessEpoch: number;
}

let issuer: CredkitBbsKeyPair;
let rogueIssuer: CredkitBbsKeyPair;
let adult: IssuedFixture;
let minor: IssuedFixture;
let rogueAdult: IssuedFixture;
/** Dedicated fixture the revocation suite revokes (nobody else presents it). */
let doomedAdult: IssuedFixture;

const FLAG = "/credentialSubject/driversLicense/age_over_18";
const DOB = "/credentialSubject/driversLicense/birth_date";

// ---------------------------------------------------------------------------
// The test registry: a real accumulator run in-process. The Worker fetches
// its state over global fetch, so a stub serves the CURRENT `registryState`
// at the pinned REVOCATION_REGISTRY_URL — revocations mutate it exactly the
// way the DMV's Durable Object would.
// ---------------------------------------------------------------------------

const REGISTRY_URL = "http://registry.test/api/registry";

const registryAuthority = deriveRevocationRegistryAuthority({
  seed: "shop-test-registry",
  dst: "VGW-SHOP-TEST-REVOCATION-KEY-V1",
});

let registryState: RevocationRegistryState = {
  params: registryAuthority.paramsBase64Url,
  accumulator: createSeededRevocationAccumulator({
    seed: "shop-test-registry",
    dst: "VGW-SHOP-TEST-REVOCATION-ACC-V1",
  }),
  epoch: 0,
  updates: [],
};

/** Revoke ids in the test registry, like the DMV's registry would. */
function revokeInRegistry(revocationIds: string[]): void {
  const applied = revokeRevocationIds({
    authority: registryAuthority,
    accumulator: registryState.accumulator,
    revocationIds,
    epoch: registryState.epoch + 1,
  });
  registryState = {
    ...registryState,
    accumulator: applied.accumulator,
    epoch: applied.epoch,
    updates: [...registryState.updates, applied.update],
  };
}

/**
 * The wallet's witness upkeep, in-process: refresh against the current
 * registry state (throws if the fixture itself was revoked) and build the
 * prove input.
 */
function freshClaimFor(fixture: IssuedFixture): CredkitNonRevocationProveInput {
  const refreshed = refreshRevocationWitness({
    revocationId: fixture.revocationId,
    witness: fixture.witness,
    epoch: fixture.witnessEpoch,
    state: registryState,
  });
  if (refreshed.revoked) {
    throw new Error("test fixture was revoked — present a stale claim explicitly instead");
  }
  fixture.witness = refreshed.witness;
  fixture.witnessEpoch = refreshed.epoch;
  return {
    pointer: REVOCATION_CLAIM_POINTER,
    params: registryState.params,
    accumulator: registryState.accumulator,
    epoch: registryState.epoch,
    witness: fixture.witness,
  };
}

const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === REGISTRY_URL) return Promise.resolve(Response.json(registryState));
    if (url.startsWith("http://registry.test/")) {
      // Any other registry.test path plays "registry down" — hermetic, no DNS.
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

beforeAll(async () => {
  issuer = generateCredkitBbsKeyPair(ISSUER_SEED);
  rogueIssuer = generateCredkitBbsKeyPair(ROGUE_ISSUER_SEED);

  const issue = async (
    keyPair: CredkitBbsKeyPair,
    birthDate: string,
  ): Promise<IssuedFixture> => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    // Revocable like every DMV credential now: a fresh hidden id enrolled in
    // the test registry (additions-static — the accumulator doesn't move),
    // and the witness the wallet would hold as sidecar state.
    const revocation = mintRevocationId();
    const vc = await issueCredkitCredential({
      credential: buildUtopiaDriversLicense({
        givenName: "TEST",
        familyName: "PERSON",
        birthDate,
        documentNumber: "T000111222",
        issuer: { id: keyPair.controller, name: "Utopia DMV" },
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2032-01-01T00:00:00Z",
        revocation: { registry: REGISTRY_URL, revocationId: revocation.lexical },
      }),
      keyPair,
      numericDeclarations: [...UTOPIA_DL_NUMERIC_DECLARATIONS, REVOCATION_NUMERIC_DECLARATION],
      holderCommitment: binding.commitmentWithProof,
    });
    return {
      vc,
      binding: { linkSecret: LINK_SECRET, secretProverBlind: binding.secretProverBlind },
      revocationId: revocation.lexical,
      witness: issueRevocationWitness({
        authority: registryAuthority,
        accumulator: registryState.accumulator,
        revocationId: revocation.lexical,
      }),
      witnessEpoch: registryState.epoch,
    };
  };

  [adult, minor, rogueAdult, doomedAdult] = await Promise.all([
    issue(issuer, ADULT_BIRTH_DATE),
    issue(issuer, MINOR_BIRTH_DATE),
    issue(rogueIssuer, ADULT_BIRTH_DATE),
    issue(issuer, ADULT_BIRTH_DATE),
  ]);
}, 120_000);

/** In-memory namespace running the REAL VerificationSessions class. */
function memoryNamespace(): DurableObjectNamespaceLike {
  const instances = new Map<string, VerificationSessions>();
  return {
    idFromName: (name: string) => ({ name }),
    get: (id) => {
      const name = (id as { name: string }).name;
      let instance = instances.get(name);
      if (instance === undefined) {
        const data = new Map<string, unknown>();
        instance = new VerificationSessions({
          storage: {
            get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
            put: (key: string, value: unknown) => {
              data.set(key, value);
              return Promise.resolve();
            },
            setAlarm: () => Promise.resolve(),
            deleteAll: () => {
              data.clear();
              return Promise.resolve();
            },
          },
        });
        instances.set(name, instance);
      }
      const bound = instance;
      return {
        fetch: (input: string | Request, init?: RequestInit) =>
          bound.fetch(new Request(input, init)),
      };
    },
  };
}

function makeEnv(overrides?: Partial<ShopBindings>): ShopBindings {
  return {
    TOKEN_SECRET: "test-secret",
    TRUSTED_ISSUER_DID: issuer.controller,
    WALLET_ORIGIN: "http://localhost:5173",
    REVOCATION_REGISTRY_URL: REGISTRY_URL,
    SESSIONS: memoryNamespace(),
    ...overrides,
  };
}

async function createSession(env: ShopBindings): Promise<VerificationSessionBody> {
  const res = await app.request("/api/verification", { method: "POST" }, env);
  expect(res.status).toBe(200);
  return (await res.json()) as VerificationSessionBody;
}

/** The wallet's params pinning, in-process: fetch, validate, decode. */
async function fetchParams(env: ShopBindings): Promise<{ params: RangeParams; hash: string }> {
  const res = await app.request(CREDKIT_PARAMS_PATH, {}, env);
  expect(res.status).toBe(200);
  const document = assertCredkitParamsDocument(await res.json());
  expect(document.range).toBeDefined();
  return {
    params: rangeParamsFromBase64Url(document.range!.params),
    hash: document.range!.hash,
  };
}

/** Range claims answering the session's query, exactly as the wallet builds them. */
function queryRangeClaims(
  request: PresentationRequest,
  params: RangeParams,
  mutate?: (claim: { bound: bigint }) => void,
): RangeClaimRequest[] {
  const predicates = request.dcql_query.credentials[0]?.vgw_predicates;
  expect(predicates?.range).toBeDefined();
  return predicates!.range!.map((entry) => {
    const claim = { bound: BigInt(entry.bound) };
    mutate?.(claim);
    return {
      pointer: BIRTH_DATE_POINTER,
      kind: entry.kind,
      bound: claim.bound,
      digits: entry.digits,
      params,
    };
  });
}

async function presentAndPost(options: {
  env: ShopBindings;
  request: PresentationRequest;
  fixture: IssuedFixture;
  /** Selective disclosure pointers (the disclosure routes). */
  pointers?: string[];
  /** Range claims (the predicate route). */
  rangeClaims?: RangeClaimRequest[];
  /**
   * Default: the fixture's refreshed non-revocation claim (every session
   * demands one now). `"omit"` presents without one; an explicit claim
   * presents THAT (e.g. a stale pre-revocation state).
   */
  nonRevocation?: "omit" | CredkitNonRevocationProveInput;
  challenge?: string;
  domain?: string;
  state?: string;
  mutate?: (vp: VerifiablePresentation) => VerifiablePresentation;
}): Promise<Response> {
  const nonRevocationClaims =
    options.nonRevocation === "omit"
      ? undefined
      : [options.nonRevocation ?? freshClaimFor(options.fixture)];
  const vp = await createCredkitPresentation({
    credentials: [
      {
        verifiableCredential: options.fixture.vc,
        selectivePointers: options.pointers ?? [],
        ...(options.rangeClaims !== undefined ? { rangeClaims: options.rangeClaims } : {}),
        ...(nonRevocationClaims !== undefined ? { nonRevocationClaims } : {}),
        holderBinding: options.fixture.binding,
      },
    ],
    challenge: options.challenge ?? options.request.nonce,
    domain: options.domain ?? options.request.client_id,
  });
  const finalVp = options.mutate?.(vp) ?? vp;
  const body = new URLSearchParams({
    vp_token: JSON.stringify({ [AGE_QUERY_ID]: [finalVp] }),
    state: options.state ?? options.request.state,
  });
  return app.request(
    "/oid4vp/response",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    options.env,
  );
}

async function sessionStatus(env: ShopBindings, sessionId: string): Promise<SessionStatus> {
  const res = await app.request(`/api/verification/${sessionId}`, {}, env);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionStatus;
}

describe("GET /.well-known/credkit-params", () => {
  it("serves a valid document whose hash matches the published octets", async () => {
    const env = makeEnv();
    const res = await app.request(CREDKIT_PARAMS_PATH, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age");

    const document = assertCredkitParamsDocument(await res.json());
    expect(document.suite).toBe("credkit-bbs-sha-2026");
    expect(document.range?.base).toBe(16);

    // The document's hash IS the hash of its own params bytes — the same
    // value the DCQL params_hash pins and credkit restates on the wire.
    const params = rangeParamsFromBase64Url(document.range!.params);
    expect(await rangeParamsHashBase64Url(params)).toBe(document.range!.hash);
  });

  it("serves byte-identical params across app instances with the same seed", async () => {
    const first = await (await app.request(CREDKIT_PARAMS_PATH, {}, makeEnv())).json();
    const again = createApp();
    const second = await (await again.request(CREDKIT_PARAMS_PATH, {}, makeEnv())).json();
    expect(second).toEqual(first);
  });

  it("answers cross-origin (the wallet fetches it from the browser)", async () => {
    const res = await app.request(
      CREDKIT_PARAMS_PATH,
      { headers: { origin: "http://localhost:5173" } },
      makeEnv(),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

describe("POST /api/verification", () => {
  it("creates a session with a well-formed OID4VP request and wallet link", async () => {
    const env = makeEnv();
    const body = await createSession(env);

    expect(body.session_id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body.status_url).toBe(`${SHOP_ORIGIN}/api/verification/${body.session_id}`);

    const request = body.request;
    expect(request.response_type).toBe("vp_token");
    expect(request.response_mode).toBe("direct_post");
    expect(request.response_uri).toBe(`${SHOP_ORIGIN}/oid4vp/response`);
    expect(request.client_id).toBe(`redirect_uri:${SHOP_ORIGIN}/oid4vp/response`);
    expect(request.nonce).not.toBe("");
    expect(request.dcql_query.credentials[0]?.id).toBe(AGE_QUERY_ID);
    expect(request.client_metadata?.client_name).toBe("The Nightcap");

    // The wallet link passes the request BY REFERENCE — a by-value link is
    // a ~1,600-char QR no phone camera can lock onto.
    expect(body.request_uri).toBe(`${SHOP_ORIGIN}/oid4vp/request/${body.session_id}`);
    expect(body.wallet_link).toBe(
      `http://localhost:5173/present?request_uri=${encodeURIComponent(body.request_uri)}`,
    );
    expect(body.wallet_link!.length).toBeLessThan(200);
  });

  it("offers the range predicate over the hidden twin: params_uri, today's bound, pinned hash", async () => {
    const env = makeEnv();
    const { request } = await createSession(env);
    const predicates = request.dcql_query.credentials[0]?.vgw_predicates;
    expect(predicates).toBeDefined();
    expect(predicates?.params_uri).toBe(`${SHOP_ORIGIN}${CREDKIT_PARAMS_PATH}`);
    expect(predicates?.claim_set).toEqual([]);
    expect(predicates?.membership).toBeUndefined();

    // Every route of this session also demands a non-revocation proof.
    expect(request.dcql_query.credentials[0]?.vgw_non_revocation).toBe(true);

    const range = predicates?.range?.[0];
    expect(range?.kind).toBe("lessOrEqual");
    expect(range?.digits).toBe(4);
    // The bound is "18 years before now" in date1900 days — sanity-check the
    // window (must sit between the 1900 epoch and today's day number).
    const days = Number(range?.bound);
    const today = Math.floor((Date.now() - Date.UTC(1900, 0, 1)) / 86_400_000);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThan(today);

    const { hash } = await fetchParams(env);
    expect(range?.params_hash).toBe(hash);
  });

  it("mints unique session ids and nonces", async () => {
    const env = makeEnv();
    const first = await createSession(env);
    const second = await createSession(env);
    expect(second.session_id).not.toBe(first.session_id);
    expect(second.request.nonce).not.toBe(first.request.nonce);
  });
});

describe("GET /api/verification/:id", () => {
  it("reports unknown sessions as pending", async () => {
    const env = makeEnv();
    expect(await sessionStatus(env, "nonexistent")).toEqual({ status: "pending" });
  });
});

describe("GET /oid4vp/request/:id", () => {
  it("serves the session's authorization request verbatim", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await app.request(session.request_uri, {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(session.request);
  });

  it("answers 404 for an unknown session", async () => {
    const env = makeEnv();
    const res = await app.request("/oid4vp/request/nonexistent", {}, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as OauthErrorResponse;
    expect(body.error).toBe("invalid_request");
  });

  it("answers cross-origin (the wallet fetches it from the browser)", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await app.request(
      session.request_uri,
      { headers: { origin: "http://localhost:5173" } },
      env,
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});

describe("POST /oid4vp/response", () => {
  it("verifies an adult age_over_18 flag presentation end to end", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirect_uri?: string };
    expect(body.redirect_uri).toBe(`${SHOP_ORIGIN}/?session=${session.session_id}`);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    expect(status.disclosed["age_over_18"]).toBe(true);
    // The flag path must not have leaked the birthdate.
    expect(status.disclosed["birth_date"]).toBeUndefined();
    expect(status.vpToken).toBeDefined();
    expect(status.predicate).toBeUndefined();
  });

  it("denies a minor whose license attests age_over_18: false", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: minor,
      pointers: [FLAG],
    });
    expect(res.status).toBe(200);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("denied");
    expect(status.disclosed["age_over_18"]).toBe(false);
  });

  it("falls back to birth_date disclosure and computes the age itself", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [DOB],
    });
    expect(res.status).toBe(200);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    expect(status.disclosed["birth_date"]).toBe(ADULT_BIRTH_DATE);
    expect(status.reason).toMatch(/full birthdate/);
  });

  describe("predicate route (range proof over the hidden twin)", () => {
    it("verifies the WHOLE presentation on the Worker: one verdict, nothing disclosed", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const { params } = await fetchParams(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        fixture: adult,
        rangeClaims: queryRangeClaims(session.request, params),
      });
      expect(res.status).toBe(200);

      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("verified");
      if (status.status !== "verified") return;
      // ONE verdict — no zk_pending, no client hand-off.
      expect(status.verdict).toBe("allowed");
      expect(status.reason).toMatch(/verified entirely on the Worker/);

      // The shop learned two bits: age satisfied + not revoked. No
      // birthdate, no flag, no commitment, no registry entry.
      expect(status.disclosed["birth_date"]).toBeUndefined();
      expect(status.disclosed["age_over_18"]).toBeUndefined();
      expect(Object.keys(status.disclosed)).toEqual(["revocation_status"]);
      expect(status.disclosed["revocation_status"]).toMatch(/not revoked/);

      expect(status.predicate).toBeDefined();
      expect(status.predicate?.pointer).toBe(BIRTH_DATE_POINTER);
      expect(status.predicate?.kind).toBe("lessOrEqual");
      expect(status.predicate?.cutoffIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }, 30_000);

    it("rejects a self-served weaker bound than the session offered", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const { params } = await fetchParams(env);
      // A bound 30 days LATER admits 17.9-year-olds. The proof is valid for
      // that statement — but it is not the statement this session offered,
      // and the token-restated expectation fails it closed.
      const res = await presentAndPost({
        env,
        request: session.request,
        fixture: adult,
        rangeClaims: queryRangeClaims(session.request, params, (claim) => {
          claim.bound += 30n;
        }),
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/does not match the expected predicate/);
    }, 30_000);

    it("rejects a proof under a different alphabet than the published one", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      // Params from a DIFFERENT verifier seed — as if the wallet skipped the
      // params_hash pinning. credkit's wire hash comparison fails it.
      const foreignEnv = makeEnv({ TOKEN_SECRET: "some-other-secret" });
      const { params: foreignParams } = await fetchParams(foreignEnv);
      const res = await presentAndPost({
        env,
        request: session.request,
        fixture: adult,
        rangeClaims: queryRangeClaims(session.request, foreignParams),
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/different alphabet/);
    }, 30_000);

    it("rejects claim shapes the session never offered (two range claims)", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const { params } = await fetchParams(env);
      const claims = queryRangeClaims(session.request, params);
      const res = await presentAndPost({
        env,
        request: session.request,
        fixture: adult,
        rangeClaims: [...claims, ...claims],
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/not a shape this session offered/);
    }, 30_000);
  });

  it("rejects a replayed response for an already-completed session", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const first = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
    });
    expect(first.status).toBe(200);

    const replay = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
    });
    expect(replay.status).toBe(400);
    const error = (await replay.json()) as OauthErrorResponse;
    expect(error.error_description).toMatch(/already received/);

    // The recorded outcome is untouched.
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
  });

  it("rejects a presentation proven over the wrong nonce and records the failure", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
      challenge: "wrong-nonce",
    });
    expect(res.status).toBe(400);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/challenge/i);
  });

  it("rejects a presentation scoped to a different verifier (wrong domain)", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
      domain: "redirect_uri:https://evil.example/oid4vp/response",
    });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
  });

  it("rejects credentials from an issuer other than the trusted DMV", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: rogueAdult,
      pointers: [FLAG],
    });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
  });

  it("rejects a tampered disclosed claim", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: minor,
      pointers: [FLAG],
      mutate: (vp) => {
        const tampered = structuredClone(vp) as VerifiablePresentation;
        const creds = tampered.verifiableCredential as VerifiableCredential[];
        const subject = creds[0]?.credentialSubject as Record<string, unknown>;
        (subject["driversLicense"] as Record<string, unknown>)["age_over_18"] = true;
        return tampered;
      },
    });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
  });

  it("records a failure for a vp_token that is not a credkit envelope", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const body = new URLSearchParams({
      vp_token: JSON.stringify({ [AGE_QUERY_ID]: [{ type: "VerifiablePresentation" }] }),
      state: session.request.state,
    });
    const res = await app.request(
      "/oid4vp/response",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      env,
    );
    expect(res.status).toBe(400);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/not a credkit presentation envelope/);
  });

  it("rejects an unknown or expired state without recording anything", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
      state: "bogus.token",
    });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("pending");
  });

  it("rejects a valid-signature state token that predates the predicate offer memory", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    // Old-format token: right secret, right use, but no `predicates` — the
    // verifier has no signed memory to restate expectations from.
    const legacyState = await mintSignedToken({
      secret: "test-secret",
      payload: { use: "vp-session", sessionId: session.session_id, nonce: session.request.nonce },
      ttlSeconds: 600,
    });
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
      state: legacyState,
    });
    expect(res.status).toBe(400);
    const error = (await res.json()) as OauthErrorResponse;
    expect(error.error_description).toMatch(/invalid or expired/);
    expect((await sessionStatus(env, session.session_id)).status).toBe("pending");
  });

  it("rejects malformed bodies with descriptive OAuth errors", async () => {
    const env = makeEnv();
    const post = (body: Record<string, string>) =>
      app.request(
        "/oid4vp/response",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body).toString(),
        },
        env,
      );

    const session = await createSession(env);
    expect((await post({ vp_token: "{}" })).status).toBe(400); // missing state
    expect((await post({ state: session.request.state })).status).toBe(400); // missing vp_token
    expect((await post({ state: session.request.state, vp_token: "not json" })).status).toBe(400);
    expect(
      (await post({ state: session.request.state, vp_token: JSON.stringify({ other: [] }) }))
        .status,
    ).toBe(400); // no entry for our query id
  });
});

describe("revocation", () => {
  it("rejects a presentation that omits the demanded non-revocation proof", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
      nonRevocation: "omit",
    });
    expect(res.status).toBe(400);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/non-revocation proof/);
    expect(status.reason).toMatch(/reissued at the DMV/);
  }, 30_000);

  it("revokes a license: honest wallets fail at refresh, stale proofs fail at the verifier", async () => {
    // The stale state a cheating wallet would cling to: pre-revocation
    // registry state + a witness valid against it.
    const staleClaim = freshClaimFor(doomedAdult);

    revokeInRegistry([doomedAdult.revocationId]);

    // The honest path: the wallet's refresh IS the revocation discovery —
    // no valid witness exists, so nothing can be presented at all.
    expect(
      refreshRevocationWitness({
        revocationId: doomedAdult.revocationId,
        witness: doomedAdult.witness,
        epoch: doomedAdult.witnessEpoch,
        state: registryState,
      }),
    ).toEqual({ revoked: true });

    // The dishonest path: post the pre-revocation proof anyway. The verifier
    // restates the registry's CURRENT state from its own fetch — the stale
    // epoch fails the wire cross-check (and the merged challenge regardless).
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: doomedAdult,
      pointers: [FLAG],
      nonRevocation: staleClaim,
    });
    expect(res.status).toBe(400);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/registry sync|epoch/);
  }, 30_000);

  it("a survivor keeps verifying after someone else's revocation (refreshed witness)", async () => {
    // doomedAdult was revoked above; adult refreshes from the PUBLISHED
    // update record and passes end to end at the new epoch.
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
    });
    expect(res.status).toBe(200);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    expect(status.reason).toMatch(/NOT REVOKED/);
    expect(status.disclosed["revocation_status"]).toMatch(/not revoked/);
    expect(status.disclosed["revocation_status"]).toMatch(/epoch 1/);
  }, 30_000);

  it("fails the request (not the session) when the registry is unreachable", async () => {
    const env = makeEnv({ REVOCATION_REGISTRY_URL: "http://registry.test/nowhere" });
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: adult,
      pointers: [FLAG],
    });
    expect(res.status).toBe(500);
    // Not recorded as an outcome — the user's attempt isn't burned.
    expect((await sessionStatus(env, session.session_id)).status).toBe("pending");
  }, 30_000);
});

describe("trustedIssuerDid discovery", () => {
  beforeEach(() => clearIssuerDidCache());

  const envWithoutPin = (dmvOrigin: string): ShopBindings =>
    makeEnv({ TRUSTED_ISSUER_DID: undefined, DMV_ORIGIN: dmvOrigin });

  it("prefers the pinned TRUSTED_ISSUER_DID", async () => {
    const did = await trustedIssuerDid(makeEnv(), () => {
      throw new Error("must not fetch when pinned");
    });
    expect(did).toBe(issuer.controller);
  });

  it("discovers vgw_issuer_did from the DMV metadata and caches it", async () => {
    let calls = 0;
    const fetchStub: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(
        Response.json({ vgw_issuer_did: "did:key:zUC7discovered" }),
      );
    };
    const env = envWithoutPin("https://dmv.example");
    expect(await trustedIssuerDid(env, fetchStub)).toBe("did:key:zUC7discovered");
    expect(await trustedIssuerDid(env, fetchStub)).toBe("did:key:zUC7discovered");
    expect(calls).toBe(1);
  });

  it("fails closed when the metadata carries no DID, without caching the failure", async () => {
    let calls = 0;
    const responses: Response[] = [
      Response.json({}),
      Response.json({ vgw_issuer_did: "did:key:zUC7later" }),
    ];
    const fetchStub: typeof fetch = () => {
      const response = responses[calls];
      calls += 1;
      if (response === undefined) throw new Error("unexpected extra fetch");
      return Promise.resolve(response);
    };
    const env = envWithoutPin("https://dmv.example");
    await expect(trustedIssuerDid(env, fetchStub)).rejects.toThrow(/vgw_issuer_did/);
    expect(await trustedIssuerDid(env, fetchStub)).toBe("did:key:zUC7later");
  });

  it("fails closed on HTTP errors from the metadata endpoint", async () => {
    const fetchStub: typeof fetch = () =>
      Promise.resolve(new Response("boom", { status: 503 }));
    await expect(
      trustedIssuerDid(envWithoutPin("https://dmv.example"), fetchStub),
    ).rejects.toThrow(/HTTP 503/);
  });
});
