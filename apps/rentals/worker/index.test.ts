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
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  createCredkitPresentation,
  createHolderBinding,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
  rangeParamsFromBase64Url,
  rangeParamsHashBase64Url,
  type CredkitBbsKeyPair,
  type HolderBinding,
  type RangeClaimRequest,
  type RangeParams,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import {
  CREDKIT_PARAMS_PATH,
  assertCredkitParamsDocument,
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
import { BIRTH_DATE_POINTER, RENTAL_QUERY_ID } from "./policy.js";
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
}

let issuer: CredkitBbsKeyPair;
let rogueIssuer: CredkitBbsKeyPair;
let senior: IssuedFixture;
let young: IssuedFixture;
let rogueSenior: IssuedFixture;

beforeAll(async () => {
  issuer = generateCredkitBbsKeyPair(ISSUER_SEED);
  rogueIssuer = generateCredkitBbsKeyPair(ROGUE_ISSUER_SEED);

  const issue = async (
    keyPair: CredkitBbsKeyPair,
    birthDate: string,
  ): Promise<IssuedFixture> => {
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const vc = await issueCredkitCredential({
      credential: buildUtopiaDriversLicense({
        givenName: "MARISOL",
        familyName: "DENG",
        birthDate,
        documentNumber: "R000111222",
        issuer: { id: keyPair.controller, name: "Utopia DMV" },
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2032-01-01T00:00:00Z",
      }),
      keyPair,
      numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
      holderCommitment: binding.commitmentWithProof,
    });
    return {
      vc,
      binding: { linkSecret: LINK_SECRET, secretProverBlind: binding.secretProverBlind },
    };
  };

  [senior, young, rogueSenior] = await Promise.all([
    issue(issuer, SENIOR_BIRTH_DATE),
    issue(issuer, YOUNG_BIRTH_DATE),
    issue(rogueIssuer, SENIOR_BIRTH_DATE),
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
    SESSIONS: memoryNamespace(),
    ...overrides,
  };
}

async function createSession(env: RentalsBindings): Promise<VerificationSessionBody> {
  const res = await app.request("/api/verification", { method: "POST" }, env);
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
  challenge?: string;
  domain?: string;
  state?: string;
  mutate?: (vp: VerifiablePresentation) => VerifiablePresentation;
}): Promise<Response> {
  const vp = await createCredkitPresentation({
    credentials: [
      {
        verifiableCredential: options.fixture.vc,
        selectivePointers: options.pointers ?? [],
        ...(options.rangeClaims !== undefined ? { rangeClaims: options.rangeClaims } : {}),
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
