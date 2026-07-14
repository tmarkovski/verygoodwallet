/**
 * Verifier Worker tests — full-fidelity: real BBS credentials, real derived
 * proofs, real Ed25519 presentation signatures, and the real
 * VerificationSessions class running against Map-backed storage. Only the
 * Durable Object *namespace* is stubbed (plain-Node vitest has no workerd).
 *
 * The rentals-specific surface under test: identity claims are REQUIRED on
 * every route, the age gate is 25 (not the shop's 18), and the ZK route
 * proves over-25 against the same committed birthdate the shop's over-18
 * proof used.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildUtopiaDriversLicense,
  deriveCredential,
  generateBbsKeyPair,
  generateEd25519KeyPair,
  signCredential,
  signPresentation,
  type BbsKeyPair,
  type Ed25519KeyPair,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import { VGW_CONTEXT_URL } from "@vgw/vc-kit/contexts";
import { createCommitment, daysSinceEpoch, toBase64Url } from "@vgw/keys";
import { ageCutoffDays, proveAgePredicate, verifyAgeProof, type AgeProofBundle } from "@vgw/zk";
import type { OauthErrorResponse, PresentationRequest } from "@vgw/protocols";
import { createApp, type VerificationSessionBody } from "./index.js";
import {
  clearIssuerDidCache,
  trustedIssuerDid,
  type DurableObjectNamespaceLike,
  type RentalsBindings,
} from "./env.js";
import { AGE_YEARS, RENTAL_QUERY_ID } from "./policy.js";
import { VerificationSessions, type SessionStatus } from "./sessions.js";

const app = createApp();

const ISSUER_SEED = new Uint8Array(32).fill(31);
const ROGUE_ISSUER_SEED = new Uint8Array(32).fill(32);
const PRESENTER_SEED = new Uint8Array(32).fill(33);

/** app.request resolves bare paths against this origin. */
const RENTALS_ORIGIN = "http://localhost";

const LICENSE = "/credentialSubject/driversLicense";
const IDENTITY_POINTERS = [
  `${LICENSE}/given_name`,
  `${LICENSE}/family_name`,
  `${LICENSE}/document_number`,
];
const FLAG_25 = `${LICENSE}/age_over_25`;
const DOB = `${LICENSE}/birth_date`;
const COMMITMENT = `${LICENSE}/birthDateCommitment`;

let issuer: BbsKeyPair;
let rogueIssuer: BbsKeyPair;
let presenter: Ed25519KeyPair;
/** Derived credentials, reusable across sessions (independent of nonce). */
let adultViaFlag: VerifiableCredential;
let adultViaDob: VerifiableCredential;
/** 22 years old at the 2026 test clock: over 18, under 25. */
let youngViaFlag: VerifiableCredential;
/** Discloses only the flag — no identity claims: must fail the policy. */
let flagWithoutIdentity: VerifiableCredential;
let rogueViaFlag: VerifiableCredential;
/** Tier-2 fixtures: identity + commitment disclosure + a REAL over-25 proof. */
let adultViaCommitment: VerifiableCredential;
let adultOpening: { commitment: string; blinding: string };
let adultZkBundle: AgeProofBundle;

const ADULT_BIRTH_DATE = "1988-04-19";
const YOUNG_BIRTH_DATE = "2004-05-01";

beforeAll(async () => {
  issuer = await generateBbsKeyPair(ISSUER_SEED);
  rogueIssuer = await generateBbsKeyPair(ROGUE_ISSUER_SEED);
  presenter = await generateEd25519KeyPair(PRESENTER_SEED);

  adultOpening = createCommitment(daysSinceEpoch(ADULT_BIRTH_DATE));

  const sign = async (opts: {
    keyPair: BbsKeyPair;
    birthDate: string;
    pointers: string[];
    birthDateCommitment?: string;
  }): Promise<VerifiableCredential> => {
    const credential = buildUtopiaDriversLicense({
      givenName: "RILEY",
      familyName: "MERCER",
      birthDate: opts.birthDate,
      documentNumber: "UDL-XM42-PL77",
      issuer: { id: opts.keyPair.controller, name: "Utopia DMV" },
      validFrom: "2026-01-01T00:00:00Z",
      validUntil: "2032-01-01T00:00:00Z",
      ...(opts.birthDateCommitment !== undefined
        ? { birthDateCommitment: opts.birthDateCommitment }
        : {}),
    });
    const signed = await signCredential({ credential, keyPair: opts.keyPair });
    return deriveCredential({
      verifiableCredential: signed,
      selectivePointers: opts.pointers,
    });
  };

  [
    adultViaFlag,
    adultViaDob,
    youngViaFlag,
    flagWithoutIdentity,
    rogueViaFlag,
    adultViaCommitment,
    { bundle: adultZkBundle },
  ] = await Promise.all([
    sign({
      keyPair: issuer,
      birthDate: ADULT_BIRTH_DATE,
      pointers: [...IDENTITY_POINTERS, FLAG_25],
    }),
    sign({
      keyPair: issuer,
      birthDate: ADULT_BIRTH_DATE,
      pointers: [...IDENTITY_POINTERS, DOB],
    }),
    sign({
      keyPair: issuer,
      birthDate: YOUNG_BIRTH_DATE,
      pointers: [...IDENTITY_POINTERS, FLAG_25],
    }),
    sign({ keyPair: issuer, birthDate: ADULT_BIRTH_DATE, pointers: [FLAG_25] }),
    sign({
      keyPair: rogueIssuer,
      birthDate: ADULT_BIRTH_DATE,
      pointers: [...IDENTITY_POINTERS, FLAG_25],
    }),
    sign({
      keyPair: issuer,
      birthDate: ADULT_BIRTH_DATE,
      pointers: [...IDENTITY_POINTERS, COMMITMENT],
      birthDateCommitment: adultOpening.commitment,
    }),
    proveAgePredicate({
      dobDays: daysSinceEpoch(ADULT_BIRTH_DATE),
      blinding: adultOpening.blinding,
      commitment: adultOpening.commitment,
      cutoffDays: ageCutoffDays(AGE_YEARS),
      years: AGE_YEARS,
    }),
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

async function presentAndPost(options: {
  env: RentalsBindings;
  request: PresentationRequest;
  credential: VerifiableCredential;
  challenge?: string;
  domain?: string;
  state?: string;
  /** Embed a tier-2 proof bundle (signed into the VP under the VGW context). */
  zkAgeProof?: unknown;
  mutate?: (vp: VerifiablePresentation) => VerifiablePresentation;
}): Promise<Response> {
  const vp = await signPresentation({
    credentials: [options.credential],
    keyPair: presenter,
    challenge: options.challenge ?? options.request.nonce,
    domain: options.domain ?? options.request.client_id,
    ...(options.zkAgeProof !== undefined
      ? { contexts: [VGW_CONTEXT_URL], properties: { zkAgeProof: options.zkAgeProof } }
      : {}),
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

describe("POST /api/verification", () => {
  it("creates a session with a well-formed OID4VP request and wallet link", async () => {
    const env = makeEnv();
    const body = await createSession(env);

    expect(body.session_id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body.status_url).toBe(`${RENTALS_ORIGIN}/api/verification/${body.session_id}`);

    const request = body.request;
    expect(request.response_type).toBe("vp_token");
    expect(request.response_mode).toBe("direct_post");
    expect(request.response_uri).toBe(`${RENTALS_ORIGIN}/oid4vp/response`);
    expect(request.client_id).toBe(`redirect_uri:${RENTALS_ORIGIN}/oid4vp/response`);
    expect(request.nonce).not.toBe("");
    expect(request.client_metadata?.client_name).toBe("Utopia Wheels");

    const query = request.dcql_query.credentials[0];
    expect(query?.id).toBe(RENTAL_QUERY_ID);
    // Identity claims ride in EVERY claim_set alternative.
    for (const set of query?.claim_sets ?? []) {
      expect(set).toEqual(expect.arrayContaining(["given_name", "family_name", "document_number"]));
    }
    expect(query?.vgw_zk).toMatchObject({ predicate: "age_over", years: AGE_YEARS });

    expect(body.wallet_link).toContain("http://localhost:5173/present?");
  });
});

describe("POST /oid4vp/response", () => {
  it("verifies an over-25 driver via the age flag, identity included", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({ env, request: session.request, credential: adultViaFlag });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirect_uri?: string };
    expect(body.redirect_uri).toBe(`${RENTALS_ORIGIN}/?session=${session.session_id}`);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    expect(status.disclosed["given_name"]).toBe("RILEY");
    expect(status.disclosed["family_name"]).toBe("MERCER");
    expect(status.disclosed["document_number"]).toBe("UDL-XM42-PL77");
    expect(status.disclosed["age_over_25"]).toBe(true);
    // The flag path must not have leaked the birthdate.
    expect(status.disclosed["birth_date"]).toBeUndefined();
    expect(status.vpToken).toBeDefined();
  });

  it("denies a 22-year-old whose license attests age_over_25: false (over 18 is not enough here)", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({ env, request: session.request, credential: youngViaFlag });
    expect(res.status).toBe(200);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("denied");
    expect(status.disclosed["age_over_25"]).toBe(false);
  });

  it("falls back to birth_date disclosure and computes the 25-year age itself", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({ env, request: session.request, credential: adultViaDob });
    expect(res.status).toBe(200);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    expect(status.disclosed["birth_date"]).toBe(ADULT_BIRTH_DATE);
    expect(status.reason).toMatch(/full birthdate/);
  });

  it("rejects a presentation that hides the driver's identity", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      credential: flagWithoutIdentity,
    });
    expect(res.status).toBe(400);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/identity/);
  });

  it("rejects a replayed response for an already-completed session", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const first = await presentAndPost({ env, request: session.request, credential: adultViaFlag });
    expect(first.status).toBe(200);

    const replay = await presentAndPost({ env, request: session.request, credential: adultViaFlag });
    expect(replay.status).toBe(400);
    const error = (await replay.json()) as OauthErrorResponse;
    expect(error.error_description).toMatch(/already received/);

    // The recorded outcome is untouched.
    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
  });

  it("rejects a presentation signed over the wrong nonce and records the failure", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      credential: adultViaFlag,
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
      credential: adultViaFlag,
      domain: "redirect_uri:https://evil.example/oid4vp/response",
    });
    expect(res.status).toBe(400);
    expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
  });

  it("rejects credentials from an issuer other than the trusted DMV", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({ env, request: session.request, credential: rogueViaFlag });
    expect(res.status).toBe(400);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("failed");
    if (status.status !== "failed") return;
    expect(status.reason).toMatch(/issuer/i);
  });

  describe("tier 2 (zkAgeProof, over-25)", () => {
    it("accepts a real proof: zk_pending outcome whose payload then verifies like the client would", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaCommitment,
        zkAgeProof: adultZkBundle,
      });
      expect(res.status).toBe(200);

      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("verified");
      if (status.status !== "verified") return;
      expect(status.verdict).toBe("zk_pending");
      // Identity + the opaque commitment — no flag, no birthdate.
      expect(status.disclosed["given_name"]).toBe("RILEY");
      expect(status.disclosed["document_number"]).toBe("UDL-XM42-PL77");
      expect(status.disclosed["birthDateCommitment"]).toBe(adultOpening.commitment);
      expect(status.disclosed["age_over_25"]).toBeUndefined();
      expect(status.disclosed["birth_date"]).toBeUndefined();

      expect(status.zk).toBeDefined();
      if (status.zk === undefined) return;
      expect(status.zk.commitment).toBe(adultOpening.commitment);
      expect(status.zk.years).toBe(AGE_YEARS);

      // The exact call the rentals client (and a self-hosted verifier) makes:
      const zkResult = await verifyAgeProof({
        proof: status.zk.proof,
        commitment: status.zk.commitment,
        cutoffDays: status.zk.cutoffDays,
      });
      expect(zkResult.verified).toBe(true);
    }, 60_000);

    const fakeProof = () => toBase64Url(new Uint8Array(14656).fill(1));

    it("rejects the shop's over-18 threshold — this counter requires over-25", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaCommitment,
        zkAgeProof: {
          ...adultZkBundle,
          years: 18,
          cutoffDays: ageCutoffDays(18),
          proof: fakeProof(),
        },
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/age_over_18.*age_over_25/);
    });

    it("rejects a cutoff later than today's policy cutoff", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaCommitment,
        zkAgeProof: {
          ...adultZkBundle,
          cutoffDays: ageCutoffDays(AGE_YEARS) + 30,
          proof: fakeProof(),
        },
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/cutoff/);
    });

    it("rejects a proof about a different commitment than the issuer signed", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const otherCommitment = createCommitment(daysSinceEpoch("1990-01-01")).commitment;
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaCommitment,
        zkAgeProof: { ...adultZkBundle, commitment: otherCommitment, proof: fakeProof() },
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/other birthdate/);
    });

    it("rejects a zkAgeProof when the commitment claim is not disclosed", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaFlag, // identity + flag, but no commitment
        zkAgeProof: adultZkBundle,
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/does not disclose/);
    });

    it("rejects a bundle tampered with after signing (wrapper coverage)", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaCommitment,
        zkAgeProof: adultZkBundle,
        mutate: (vp) => {
          const tampered = structuredClone(vp) as VerifiablePresentation;
          (tampered["zkAgeProof"] as Record<string, unknown>)["cutoffDays"] =
            ageCutoffDays(AGE_YEARS) - 10_000;
          return tampered;
        },
      });
      expect(res.status).toBe(400);
      expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
    });
  });

  it("rejects an unknown or expired state without recording anything", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      credential: adultViaFlag,
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

  it("discovers vgw_issuer_did from the DMV metadata and caches it", async () => {
    let calls = 0;
    const fetchStub: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(Response.json({ vgw_issuer_did: "did:key:zUC7discovered" }));
    };
    const env = makeEnv({ TRUSTED_ISSUER_DID: undefined, DMV_ORIGIN: "https://dmv.example" });
    expect(await trustedIssuerDid(env, fetchStub)).toBe("did:key:zUC7discovered");
    expect(await trustedIssuerDid(env, fetchStub)).toBe("did:key:zUC7discovered");
    expect(calls).toBe(1);
  });
});
