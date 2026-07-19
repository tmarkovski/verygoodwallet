/**
 * Rentals verifier Worker tests — full-fidelity: real credkit credentials
 * (blind-issued, holder-bound), real presentations (identity disclosure +
 * range proofs over the hidden birth_date twin), and the real
 * VerificationSessions class against Map-backed storage. Only the Durable
 * Object *namespace* is stubbed (plain-Node vitest has no workerd).
 *
 * The rentals profile: identity claims (name + license number) are required
 * on EVERY route; only the age question rides the privacy ladder — and the
 * predicate route proves 25+ (not the shop's 18+) from the SAME hidden twin.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REVOCATION_CLAIM_POINTER,
  REVOCATION_NUMERIC_DECLARATION,
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  UTOPIA_RESIDENT_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  buildUtopiaResidentRegistration,
  createCredkitPresentation,
  createHolderBinding,
  createSeededRevocationAccumulator,
  deriveRevocationRegistryAuthority,
  districtByFips,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
  issueRevocationWitness,
  mintRevocationId,
  rangeParamsFromBase64Url,
  rangeParamsHashBase64Url,
  refreshRevocationWitness,
  revokeRevocationIds,
  setParamsFromBase64Url,
  setParamsHashBase64Url,
  verifySetParams,
  type CredkitBbsKeyPair,
  type CredkitNonRevocationProveInput,
  type GraphEquality,
  type HolderBinding,
  type MembershipClaimRequest,
  type RangeClaimRequest,
  type RangeParams,
  type RevocationRegistryState,
  type SetMembershipParams,
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
  type RentalsBindings,
} from "./env.js";
import {
  BIRTH_DATE_POINTER,
  RENTAL_QUERY_ID,
  RESIDENT_RATE_DL_QUERY_ID,
  RESIDENT_RATE_RESIDENT_QUERY_ID,
  STATE_FIPS_POINTER,
} from "./policy.js";
import { VerificationSessions, type SessionStatus } from "./sessions.js";

const app = createApp();

const ISSUER_SEED = new Uint8Array(32).fill(21);
const ROGUE_ISSUER_SEED = new Uint8Array(32).fill(22);
/** The wallet's one-for-life link secret (fixed for determinism). */
const LINK_SECRET = new Uint8Array(32).fill(23);

/** app.request resolves bare paths against this origin. */
const RENTALS_ORIGIN = "http://localhost";

/** Over 25 (passes) and under 25 (fails the rental gate). */
const SENIOR_BIRTH_DATE = "1958-06-21";
const YOUNG_BIRTH_DATE = "2003-05-05";

const LICENSE = "/credentialSubject/driversLicense";
const IDENTITY_POINTERS = [
  `${LICENSE}/given_name`,
  `${LICENSE}/family_name`,
  `${LICENSE}/document_number`,
];
const FLAG = `${LICENSE}/age_over_25`;
const DOB = `${LICENSE}/birth_date`;

interface IssuedFixture {
  vc: VerifiableCredential;
  binding: Pick<HolderBinding, "linkSecret" | "secretProverBlind">;
  /** The credential's registry coordinates + the holder's witness sidecar. */
  revocationId: string;
  witness: string;
  witnessEpoch: number;
}

/** Marisol's district for the resident fixtures: Port Azure (coastal, fips 11). */
const PORT_AZURE = districtByFips(11)!;

// ---------------------------------------------------------------------------
// The test registry: a real accumulator run in-process (one registry for
// both credential kinds, like the DMV's). The Worker fetches its state over
// global fetch, so a stub serves the CURRENT `registryState` at the pinned
// REVOCATION_REGISTRY_URL.
// ---------------------------------------------------------------------------

const REGISTRY_URL = "http://registry.test/api/registry";

const registryAuthority = deriveRevocationRegistryAuthority({
  seed: "rentals-test-registry",
  dst: "VGW-RENTALS-TEST-REVOCATION-KEY-V1",
});

let registryState: RevocationRegistryState = {
  params: registryAuthority.paramsBase64Url,
  accumulator: createSeededRevocationAccumulator({
    seed: "rentals-test-registry",
    dst: "VGW-RENTALS-TEST-REVOCATION-ACC-V1",
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

/** The wallet's witness upkeep, in-process: refresh + build the prove input. */
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
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

let issuer: CredkitBbsKeyPair;
let rogueIssuer: CredkitBbsKeyPair;
let senior: IssuedFixture;
let young: IssuedFixture;
let rogueSenior: IssuedFixture;
/** Marisol's resident registration — SAME link secret as her DL, own blind. */
let coastalResident: IssuedFixture;
/** A coastal registration signed by the wrong issuer. */
let rogueResident: IssuedFixture;

beforeAll(async () => {
  issuer = generateCredkitBbsKeyPair(ISSUER_SEED);
  rogueIssuer = generateCredkitBbsKeyPair(ROGUE_ISSUER_SEED);

  /** Witness sidecar for a freshly enrolled id, as issuance would mint it. */
  const enroll = (): { revocationId: string; witness: string; witnessEpoch: number } => {
    const revocation = mintRevocationId();
    return {
      revocationId: revocation.lexical,
      witness: issueRevocationWitness({
        authority: registryAuthority,
        accumulator: registryState.accumulator,
        revocationId: revocation.lexical,
      }),
      witnessEpoch: registryState.epoch,
    };
  };

  const issue = async (
    keyPair: CredkitBbsKeyPair,
    birthDate: string,
  ): Promise<IssuedFixture> => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const enrolled = enroll();
    const vc = await issueCredkitCredential({
      credential: buildUtopiaDriversLicense({
        givenName: "MARISOL",
        familyName: "DENG",
        birthDate,
        documentNumber: "R000111222",
        issuer: { id: keyPair.controller, name: "Utopia DMV" },
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2032-01-01T00:00:00Z",
        revocation: { registry: REGISTRY_URL, revocationId: enrolled.revocationId },
      }),
      keyPair,
      numericDeclarations: [...UTOPIA_DL_NUMERIC_DECLARATIONS, REVOCATION_NUMERIC_DECLARATION],
      holderCommitment: binding.commitmentWithProof,
    });
    return {
      vc,
      binding: { linkSecret: LINK_SECRET, secretProverBlind: binding.secretProverBlind },
      ...enrolled,
    };
  };

  const issueResident = async (keyPair: CredkitBbsKeyPair): Promise<IssuedFixture> => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const enrolled = enroll();
    const vc = await issueCredkitCredential({
      credential: buildUtopiaResidentRegistration({
        givenName: "Marisol",
        familyName: "Deng",
        districtName: PORT_AZURE.name,
        stateFips: PORT_AZURE.fips,
        postalCode: 40140,
        issuer: { id: keyPair.controller, name: "Utopia DMV" },
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
        revocation: { registry: REGISTRY_URL, revocationId: enrolled.revocationId },
      }),
      keyPair,
      numericDeclarations: [
        ...UTOPIA_RESIDENT_NUMERIC_DECLARATIONS,
        REVOCATION_NUMERIC_DECLARATION,
      ],
      holderCommitment: binding.commitmentWithProof,
    });
    return {
      vc,
      binding: { linkSecret: LINK_SECRET, secretProverBlind: binding.secretProverBlind },
      ...enrolled,
    };
  };

  [senior, young, rogueSenior, coastalResident, rogueResident] = await Promise.all([
    issue(issuer, SENIOR_BIRTH_DATE),
    issue(issuer, YOUNG_BIRTH_DATE),
    issue(rogueIssuer, SENIOR_BIRTH_DATE),
    issueResident(issuer),
    issueResident(rogueIssuer),
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

function makeEnv(overrides?: Partial<RentalsBindings>): RentalsBindings {
  return {
    TOKEN_SECRET: "test-secret",
    TRUSTED_ISSUER_DID: issuer.controller,
    WALLET_ORIGIN: "http://localhost:5173",
    REVOCATION_REGISTRY_URL: REGISTRY_URL,
    SESSIONS: memoryNamespace(),
    ...overrides,
  };
}

async function createSession(env: RentalsBindings): Promise<VerificationSessionBody> {
  const res = await app.request("/api/verification", { method: "POST" }, env);
  expect(res.status).toBe(200);
  return (await res.json()) as VerificationSessionBody;
}

async function createResidentRateSession(
  env: RentalsBindings,
): Promise<VerificationSessionBody> {
  const res = await app.request(
    "/api/verification",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "resident-rate" }),
    },
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as VerificationSessionBody;
}

/** The wallet's params pinning, in-process: fetch, validate, decode. */
async function fetchParams(
  env: RentalsBindings,
): Promise<{ params: RangeParams; hash: string }> {
  const res = await app.request(CREDKIT_PARAMS_PATH, {}, env);
  expect(res.status).toBe(200);
  const document = assertCredkitParamsDocument(await res.json());
  expect(document.range).toBeDefined();
  return {
    params: rangeParamsFromBase64Url(document.range!.params),
    hash: document.range!.hash,
  };
}

/** The published coastal set, decoded as the wallet would. */
async function fetchCoastalSet(
  env: RentalsBindings,
): Promise<{ params: SetMembershipParams; hash: string }> {
  const res = await app.request(CREDKIT_PARAMS_PATH, {}, env);
  expect(res.status).toBe(200);
  const document = assertCredkitParamsDocument(await res.json());
  const entry = document.sets?.["coastal"];
  expect(entry).toBeDefined();
  return { params: setParamsFromBase64Url(entry!.params), hash: entry!.hash };
}

/** Range claims answering the session's query, exactly as the wallet builds them. */
function queryRangeClaims(
  request: PresentationRequest,
  params: RangeParams,
): RangeClaimRequest[] {
  const predicates = request.dcql_query.credentials[0]?.vgw_predicates;
  expect(predicates?.range).toBeDefined();
  return predicates!.range!.map((entry) => ({
    pointer: BIRTH_DATE_POINTER,
    kind: entry.kind,
    bound: BigInt(entry.bound),
    digits: entry.digits,
    params,
  }));
}

async function presentAndPost(options: {
  env: RentalsBindings;
  request: PresentationRequest;
  fixture: IssuedFixture;
  pointers?: string[];
  rangeClaims?: RangeClaimRequest[];
  /**
   * Default: the fixture's refreshed non-revocation claim (every session
   * demands one now). `"omit"` presents without one.
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
    vp_token: JSON.stringify({ [RENTAL_QUERY_ID]: [finalVp] }),
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

async function sessionStatus(env: RentalsBindings, sessionId: string): Promise<SessionStatus> {
  const res = await app.request(`/api/verification/${sessionId}`, {}, env);
  expect(res.status).toBe(200);
  return (await res.json()) as SessionStatus;
}

/** The one equality the resident-rate flow demands: statements 0+1 share the link secret. */
const LINK_SECRET_EQUALITY: GraphEquality[] = [
  [
    { statement: 0, linkSecret: true },
    { statement: 1, linkSecret: true },
  ],
];

/** Build a two-statement graph VP exactly as the wallet's composite ceremony does. */
async function compositeVp(options: {
  request: PresentationRequest;
  dl: IssuedFixture;
  resident: IssuedFixture;
  rangeClaims?: RangeClaimRequest[];
  membershipClaims?: MembershipClaimRequest[];
  equalities?: GraphEquality[];
  /** Default: both statements carry refreshed non-revocation claims. */
  nonRevocation?: "omit";
}): Promise<VerifiablePresentation> {
  const withClaims = options.nonRevocation !== "omit";
  return createCredkitPresentation({
    credentials: [
      {
        verifiableCredential: options.dl.vc,
        selectivePointers: [],
        ...(options.rangeClaims !== undefined ? { rangeClaims: options.rangeClaims } : {}),
        ...(withClaims ? { nonRevocationClaims: [freshClaimFor(options.dl)] } : {}),
        holderBinding: options.dl.binding,
      },
      {
        verifiableCredential: options.resident.vc,
        selectivePointers: [],
        ...(options.membershipClaims !== undefined
          ? { membershipClaims: options.membershipClaims }
          : {}),
        ...(withClaims ? { nonRevocationClaims: [freshClaimFor(options.resident)] } : {}),
        holderBinding: options.resident.binding,
      },
    ],
    ...(options.equalities !== undefined ? { equalities: options.equalities } : {}),
    challenge: options.request.nonce,
    domain: options.request.client_id,
  });
}

/** direct_post a prebuilt vp_token entry (the D.5.1 single-VP convention). */
async function postVp(options: {
  env: RentalsBindings;
  state: string;
  vpKey: string;
  vp: VerifiablePresentation | Record<string, unknown>;
}): Promise<Response> {
  const body = new URLSearchParams({
    vp_token: JSON.stringify({ [options.vpKey]: [options.vp] }),
    state: options.state,
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

describe("GET /.well-known/credkit-params", () => {
  it("serves a valid document whose hash matches the published octets", async () => {
    const env = makeEnv();
    const res = await app.request(CREDKIT_PARAMS_PATH, {}, env);
    expect(res.status).toBe(200);
    const document = assertCredkitParamsDocument(await res.json());
    expect(document.suite).toBe("credkit-bbs-sha-2026");
    expect(document.range?.base).toBe(16);
    const params = rangeParamsFromBase64Url(document.range!.params);
    expect(await rangeParamsHashBase64Url(params)).toBe(document.range!.hash);
  });

  it("publishes the coastal set (N5b): valid alphabet, matching hash, coastal fips in publication order", async () => {
    const { params, hash } = await fetchCoastalSet(makeEnv());
    // The members ARE the verifier's policy: coastal fips, publication order.
    expect(params.members).toEqual([11n, 12n, 13n]);
    expect(await setParamsHashBase64Url(params)).toBe(hash);
    // 2 pairings per member — run once, here.
    expect(verifySetParams(params)).toBe(true);
  }, 30_000);

  it("serves byte-identical params across app instances with the same seed", async () => {
    const first = await (await app.request(CREDKIT_PARAMS_PATH, {}, makeEnv())).json();
    const again = createApp();
    const second = await (await again.request(CREDKIT_PARAMS_PATH, {}, makeEnv())).json();
    expect(second).toEqual(first);
  });
});

describe("POST /api/verification", () => {
  it("creates a session whose query demands identity on every route", async () => {
    const env = makeEnv();
    const body = await createSession(env);
    const query = body.request.dcql_query.credentials[0];
    expect(query?.id).toBe(RENTAL_QUERY_ID);
    expect(body.request.client_metadata?.client_name).toBe("Utopia Wheels");

    // Identity rides in every disclosure alternative…
    for (const set of query?.claim_sets ?? []) {
      expect(set).toEqual(
        expect.arrayContaining(["given_name", "family_name", "document_number"]),
      );
    }
    // …and in the predicate route's claim_set.
    expect(query?.vgw_predicates?.claim_set).toEqual([
      "given_name",
      "family_name",
      "document_number",
    ]);
    expect(query?.vgw_predicates?.params_uri).toBe(`${RENTALS_ORIGIN}${CREDKIT_PARAMS_PATH}`);
    expect(query?.vgw_predicates?.range?.[0]?.kind).toBe("lessOrEqual");

    const { hash } = await fetchParams(env);
    expect(query?.vgw_predicates?.range?.[0]?.params_hash).toBe(hash);
  });

  it("links the wallet by reference — the QR must stay scannable", async () => {
    const env = makeEnv();
    const body = await createSession(env);
    expect(body.request_uri).toBe(`${RENTALS_ORIGIN}/oid4vp/request/${body.session_id}`);
    expect(body.wallet_link).toBe(
      `http://localhost:5173/present?request_uri=${encodeURIComponent(body.request_uri)}`,
    );
    expect(body.wallet_link!.length).toBeLessThan(200);
  });
});

describe("GET /oid4vp/request/:id", () => {
  it("serves the session's authorization request verbatim (both flows)", async () => {
    const env = makeEnv();
    const standard = await createSession(env);
    const composite = await createResidentRateSession(env);
    for (const session of [standard, composite]) {
      const res = await app.request(session.request_uri, {}, env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(session.request);
    }
  });

  it("answers 404 for an unknown session", async () => {
    const env = makeEnv();
    const res = await app.request("/oid4vp/request/nonexistent", {}, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as OauthErrorResponse;
    expect(body.error).toBe("invalid_request");
  });
});

describe("POST /oid4vp/response", () => {
  it("verifies identity + age_over_25 flag end to end", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: senior,
      pointers: [...IDENTITY_POINTERS, FLAG],
    });
    expect(res.status).toBe(200);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    expect(status.disclosed["given_name"]).toBe("MARISOL");
    expect(status.disclosed["document_number"]).toBe("R000111222");
    expect(status.disclosed["age_over_25"]).toBe(true);
    expect(status.disclosed["birth_date"]).toBeUndefined();
  });

  it("denies an under-25 whose license attests age_over_25: false", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: young,
      pointers: [...IDENTITY_POINTERS, FLAG],
    });
    expect(res.status).toBe(200);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("denied");
  });

  it("falls back to identity + birth_date and computes the age itself", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: senior,
      pointers: [...IDENTITY_POINTERS, DOB],
    });
    expect(res.status).toBe(200);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    expect(status.disclosed["birth_date"]).toBe(SENIOR_BIRTH_DATE);
  });

  it("fails a presentation that omits the identity claims — whatever the age route", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    // Flag only, no identity: the rental agreement cannot be written.
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: senior,
      pointers: [FLAG],
    });
    expect(res.status).toBe(400);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/driver's identity/);
  });

  describe("predicate route (identity + range proof over the hidden twin)", () => {
    it("verifies identity + the 25+ range proof entirely on the Worker", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const { params } = await fetchParams(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        fixture: senior,
        // The predicate route's claim_set: identity discloses, age proves.
        pointers: IDENTITY_POINTERS,
        rangeClaims: queryRangeClaims(session.request, params),
      });
      expect(res.status).toBe(200);

      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("verified");
      if (status.status !== "verified") return;
      expect(status.verdict).toBe("allowed");
      expect(status.reason).toMatch(/verified entirely on the Worker/);
      // Identity disclosed; the age question cost one bit.
      expect(status.disclosed["given_name"]).toBe("MARISOL");
      expect(status.disclosed["birth_date"]).toBeUndefined();
      expect(status.disclosed["age_over_25"]).toBeUndefined();
      expect(status.predicate?.pointer).toBe(BIRTH_DATE_POINTER);
      expect(status.predicate?.cutoffIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }, 30_000);

    it("fails a range proof that arrives without the identity disclosures", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const { params } = await fetchParams(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        fixture: senior,
        rangeClaims: queryRangeClaims(session.request, params),
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/driver's identity/);
    }, 30_000);

    it("the under-25 holder cannot produce the proof at all — the prover throws", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const { params } = await fetchParams(env);
      await expect(
        presentAndPost({
          env,
          request: session.request,
          fixture: young,
          pointers: IDENTITY_POINTERS,
          rangeClaims: queryRangeClaims(session.request, params),
        }),
      ).rejects.toThrow(/does not fit/);
      expect((await sessionStatus(env, session.session_id)).status).toBe("pending");
    }, 30_000);
  });

  it("rejects credentials from an issuer other than the trusted DMV", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: rogueSenior,
      pointers: [...IDENTITY_POINTERS, FLAG],
    });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
  });

  it("rejects a presentation proven over the wrong nonce", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: senior,
      pointers: [...IDENTITY_POINTERS, FLAG],
      challenge: "wrong-nonce",
    });
    expect(res.status).toBe(400);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/challenge/i);
  });

  it("rejects a replayed response for an already-completed session", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const first = await presentAndPost({
      env,
      request: session.request,
      fixture: senior,
      pointers: [...IDENTITY_POINTERS, FLAG],
    });
    expect(first.status).toBe(200);
    const replay = await presentAndPost({
      env,
      request: session.request,
      fixture: senior,
      pointers: [...IDENTITY_POINTERS, FLAG],
    });
    expect(replay.status).toBe(400);
    const error = (await replay.json()) as OauthErrorResponse;
    expect(error.error_description).toMatch(/already received/);
  });

  it("rejects a tampered disclosed claim", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      fixture: young,
      pointers: [...IDENTITY_POINTERS, FLAG],
      mutate: (vp) => {
        const tampered = structuredClone(vp) as VerifiablePresentation;
        const creds = tampered.verifiableCredential as VerifiableCredential[];
        const subject = creds[0]?.credentialSubject as Record<string, unknown>;
        (subject["driversLicense"] as Record<string, unknown>)["age_over_25"] = true;
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
      vp_token: JSON.stringify({ [RENTAL_QUERY_ID]: [{ type: "VerifiablePresentation" }] }),
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
      fixture: senior,
      pointers: [...IDENTITY_POINTERS, FLAG],
      state: "bogus.token",
    });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("pending");
  });
});

describe("resident-rate composite flow (N5b, showcases B + C)", () => {
  /** The full wallet side of the composite, against a fresh session. */
  async function presentComposite(
    env: RentalsBindings,
    options?: {
      dl?: IssuedFixture;
      resident?: IssuedFixture;
      omitRange?: boolean;
      omitMembership?: boolean;
      omitEquality?: boolean;
    },
  ): Promise<{ session: VerificationSessionBody; res: Response }> {
    const session = await createResidentRateSession(env);
    const { params } = await fetchParams(env);
    const { params: coastalSet } = await fetchCoastalSet(env);
    const vp = await compositeVp({
      request: session.request,
      dl: options?.dl ?? senior,
      resident: options?.resident ?? coastalResident,
      ...(options?.omitRange === true
        ? {}
        : { rangeClaims: queryRangeClaims(session.request, params) }),
      ...(options?.omitMembership === true
        ? {}
        : { membershipClaims: [{ pointer: STATE_FIPS_POINTER, params: coastalSet }] }),
      ...(options?.omitEquality === true ? {} : { equalities: LINK_SECRET_EQUALITY }),
    });
    const res = await postVp({
      env,
      state: session.request.state,
      vpKey: RESIDENT_RATE_DL_QUERY_ID,
      vp,
    });
    return { session, res };
  }

  it("rejects an unknown flow discriminator (fail closed)", async () => {
    const res = await app.request(
      "/api/verification",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flow: "vip-rate" }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("offers TWO predicate-only queries linked by a link-secret equality (D.5.3)", async () => {
    const env = makeEnv();
    const session = await createResidentRateSession(env);
    const [dl, resident] = session.request.dcql_query.credentials;
    expect(dl?.id).toBe(RESIDENT_RATE_DL_QUERY_ID);
    expect(resident?.id).toBe(RESIDENT_RATE_RESIDENT_QUERY_ID);

    // Zero disclosure by construction: no claims, no claim_sets, and empty
    // predicate claim_sets — there is deliberately no dob fallback.
    for (const query of [dl!, resident!]) {
      expect(query.claims).toBeUndefined();
      expect(query.claim_sets).toBeUndefined();
      expect(query.vgw_predicates?.claim_set).toEqual([]);
    }
    expect(dl?.meta?.type_values).toEqual([
      ["VerifiableCredential", "Iso18013DriversLicenseCredential"],
    ]);
    expect(resident?.meta?.type_values).toEqual([
      ["VerifiableCredential", "UtopiaResidentRegistrationCredential"],
    ]);

    // The claims pin THIS isolate's published alphabets.
    const { hash: rangeHash } = await fetchParams(env);
    const { hash: setHash } = await fetchCoastalSet(env);
    expect(dl?.vgw_predicates?.range?.[0]?.kind).toBe("lessOrEqual");
    expect(dl?.vgw_predicates?.range?.[0]?.params_hash).toBe(rangeHash);
    expect(resident?.vgw_predicates?.membership?.[0]?.set_id).toBe("coastal");
    expect(resident?.vgw_predicates?.membership?.[0]?.params_hash).toBe(setHash);

    expect(session.request.dcql_query.vgw_equalities).toEqual([
      [
        { query: RESIDENT_RATE_DL_QUERY_ID, link_secret: true },
        { query: RESIDENT_RATE_RESIDENT_QUERY_ID, link_secret: true },
      ],
    ]);
  });

  it("verifies the whole composite on the Worker: allowed, disclosed EMPTY, three proofs narrated", async () => {
    const env = makeEnv();
    const { session, res } = await presentComposite(env);
    expect(res.status).toBe(200);
    const ack = (await res.json()) as { redirect_uri?: string };
    expect(ack.redirect_uri).toContain(`session=${session.session_id}`);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    // THE exhibit: an allowed verdict disclosing NO personal data — the
    // only entry is the revocation narration (a bit, not a claim value).
    expect(Object.keys(status.disclosed)).toEqual(["revocation_status"]);
    expect(status.disclosed["revocation_status"]).toMatch(/not revoked/);
    expect(status.reason).toMatch(/Three facts, zero disclosures/);
    expect(status.reason).toMatch(/verified entirely on the Worker/i);
    expect(status.reason).toMatch(/NOT REVOKED/);

    // The composite exhibit narrates all three proofs for the UI.
    expect(status.composite?.statements).toBe(2);
    expect(status.composite?.range?.[0]).toMatchObject({
      statement: 0,
      pointer: BIRTH_DATE_POINTER,
      kind: "lessOrEqual",
    });
    expect(status.composite?.range?.[0]?.cutoffIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(status.composite?.membership?.[0]).toEqual({
      statement: 1,
      pointer: STATE_FIPS_POINTER,
      setId: "coastal",
      members: ["11", "12", "13"],
    });
    expect(status.composite?.equalities).toEqual([
      { kind: "link_secret", statements: [0, 1] },
    ]);
    expect(status.predicate).toBeUndefined();
  }, 30_000);

  it("fails a range-only presentation — not the shape this session offered", async () => {
    const env = makeEnv();
    const { session, res } = await presentComposite(env, {
      omitMembership: true,
      omitEquality: true,
    });
    expect(res.status).toBe(400);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/offered 1\/1\/2\/1, not that shape/);
  }, 30_000);

  it("fails a membership-only presentation", async () => {
    const env = makeEnv();
    const { session, res } = await presentComposite(env, {
      omitRange: true,
      omitEquality: true,
    });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
  }, 30_000);

  it("fails when the offered equality is missing from the presentation", async () => {
    const env = makeEnv();
    const { session, res } = await presentComposite(env, { omitEquality: true });
    expect(res.status).toBe(400);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/1 membership, 2 non-revocation, and 0 equality/);
  }, 30_000);

  it("fails an equality-carrying presentation against a STANDARD session (vice versa)", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const { params } = await fetchParams(env);
    const { params: coastalSet } = await fetchCoastalSet(env);
    const vp = await compositeVp({
      request: session.request,
      dl: senior,
      resident: coastalResident,
      rangeClaims: queryRangeClaims(session.request, params),
      membershipClaims: [{ pointer: STATE_FIPS_POINTER, params: coastalSet }],
      equalities: LINK_SECRET_EQUALITY,
    });
    const res = await postVp({
      env,
      state: session.request.state,
      vpKey: RENTAL_QUERY_ID,
      vp,
    });
    expect(res.status).toBe(400);
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/1 equality claims.*offered 1\/0\/1\/0/s);
  }, 30_000);

  it("fails when the DL statement's issuer is not the trusted DMV", async () => {
    const env = makeEnv();
    const { session, res } = await presentComposite(env, { dl: rogueSenior });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
  }, 30_000);

  it("fails when the RESIDENT statement's issuer is not the trusted DMV", async () => {
    const env = makeEnv();
    const { session, res } = await presentComposite(env, { resident: rogueResident });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
  }, 30_000);

  it("rejects a replayed composite response for an already-completed session", async () => {
    const env = makeEnv();
    const { session, res } = await presentComposite(env);
    expect(res.status).toBe(200);
    // Replay the exact flow against the same session's state token.
    const { params } = await fetchParams(env);
    const { params: coastalSet } = await fetchCoastalSet(env);
    const vp = await compositeVp({
      request: session.request,
      dl: senior,
      resident: coastalResident,
      rangeClaims: queryRangeClaims(session.request, params),
      membershipClaims: [{ pointer: STATE_FIPS_POINTER, params: coastalSet }],
      equalities: LINK_SECRET_EQUALITY,
    });
    const replay = await postVp({
      env,
      state: session.request.state,
      vpKey: RESIDENT_RATE_DL_QUERY_ID,
      vp,
    });
    expect(replay.status).toBe(400);
    const error = (await replay.json()) as OauthErrorResponse;
    expect(error.error_description).toMatch(/already received/);
    // The first outcome stands.
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
  }, 30_000);

  it("fails closed on a pre-N5b state token shape (the D.5.6 memory is versioned)", async () => {
    const env = makeEnv();
    // The pre-N5b payload: a bare `predicates` array, no flow, no offer.
    const legacyState = await mintSignedToken({
      secret: "test-secret",
      payload: {
        use: "vp-session",
        sessionId: "legacy-session",
        nonce: "legacy-nonce",
        predicates: [
          { pointer: BIRTH_DATE_POINTER, kind: "lessOrEqual", bound: "40000", digits: 4 },
        ],
      },
      ttlSeconds: 600,
    });
    const res = await postVp({
      env,
      state: legacyState,
      vpKey: RENTAL_QUERY_ID,
      vp: { type: "VerifiablePresentation" },
    });
    expect(res.status).toBe(400);
    const error = (await res.json()) as OauthErrorResponse;
    expect(error.error_description).toMatch(/state is invalid or expired/);
    // Nothing was recorded against the named session.
    expect((await sessionStatus(env, "legacy-session")).status).toBe("pending");
  });
});

describe("trustedIssuerDid discovery", () => {
  beforeEach(() => clearIssuerDidCache());

  it("prefers the pinned TRUSTED_ISSUER_DID", async () => {
    const did = await trustedIssuerDid(makeEnv(), () => {
      throw new Error("must not fetch when pinned");
    });
    expect(did).toBe(issuer.controller);
  });

  it("discovers vgw_issuer_did from the DMV metadata", async () => {
    const fetchStub: typeof fetch = () =>
      Promise.resolve(Response.json({ vgw_issuer_did: "did:key:zUC7discovered" }));
    const env = makeEnv({ TRUSTED_ISSUER_DID: undefined, DMV_ORIGIN: "https://dmv.example" });
    expect(await trustedIssuerDid(env, fetchStub)).toBe("did:key:zUC7discovered");
  });
});
