/**
 * Verifier Worker tests — full-fidelity: real BBS credentials, real derived
 * proofs, real Ed25519 presentation signatures, and the real
 * VerificationSessions class running against Map-backed storage. Only the
 * Durable Object *namespace* is stubbed (plain-Node vitest has no workerd).
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
  type ShopBindings,
} from "./env.js";
import { AGE_QUERY_ID } from "./policy.js";
import { VerificationSessions, type SessionStatus } from "./sessions.js";

const app = createApp();

const ISSUER_SEED = new Uint8Array(32).fill(11);
const ROGUE_ISSUER_SEED = new Uint8Array(32).fill(12);
const PRESENTER_SEED = new Uint8Array(32).fill(13);

/** app.request resolves bare paths against this origin. */
const SHOP_ORIGIN = "http://localhost";

let issuer: BbsKeyPair;
let rogueIssuer: BbsKeyPair;
let presenter: Ed25519KeyPair;
/** Derived credentials, reusable across sessions (independent of nonce). */
let adultViaFlag: VerifiableCredential;
let adultViaDob: VerifiableCredential;
let minorViaFlag: VerifiableCredential;
let rogueViaFlag: VerifiableCredential;
/** Tier-2 fixtures: commitment-only disclosure + a REAL UltraHonk proof. */
let adultViaCommitment: VerifiableCredential;
let adultOpening: { commitment: string; blinding: string };
let adultZkBundle: AgeProofBundle;

const ADULT_BIRTH_DATE = "1988-04-19";

beforeAll(async () => {
  issuer = await generateBbsKeyPair(ISSUER_SEED);
  rogueIssuer = await generateBbsKeyPair(ROGUE_ISSUER_SEED);
  presenter = await generateEd25519KeyPair(PRESENTER_SEED);

  adultOpening = createCommitment(daysSinceEpoch(ADULT_BIRTH_DATE));

  const sign = async (opts: {
    keyPair: BbsKeyPair;
    birthDate: string;
    pointer: string;
    birthDateCommitment?: string;
  }): Promise<VerifiableCredential> => {
    const credential = buildUtopiaDriversLicense({
      givenName: "TEST",
      familyName: "PERSON",
      birthDate: opts.birthDate,
      documentNumber: "T000111222",
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
      selectivePointers: [opts.pointer],
    });
  };

  const FLAG = "/credentialSubject/driversLicense/age_over_18";
  const DOB = "/credentialSubject/driversLicense/birth_date";
  const COMMITMENT = "/credentialSubject/driversLicense/birthDateCommitment";
  [adultViaFlag, adultViaDob, minorViaFlag, rogueViaFlag, adultViaCommitment, { bundle: adultZkBundle }] =
    await Promise.all([
      sign({ keyPair: issuer, birthDate: ADULT_BIRTH_DATE, pointer: FLAG }),
      sign({ keyPair: issuer, birthDate: ADULT_BIRTH_DATE, pointer: DOB }),
      sign({ keyPair: issuer, birthDate: "2009-11-02", pointer: FLAG }),
      sign({ keyPair: rogueIssuer, birthDate: ADULT_BIRTH_DATE, pointer: FLAG }),
      sign({
        keyPair: issuer,
        birthDate: ADULT_BIRTH_DATE,
        pointer: COMMITMENT,
        birthDateCommitment: adultOpening.commitment,
      }),
      proveAgePredicate({
        dobDays: daysSinceEpoch(ADULT_BIRTH_DATE),
        blinding: adultOpening.blinding,
        commitment: adultOpening.commitment,
        cutoffDays: ageCutoffDays(18),
        years: 18,
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

function makeEnv(overrides?: Partial<ShopBindings>): ShopBindings {
  return {
    TOKEN_SECRET: "test-secret",
    TRUSTED_ISSUER_DID: issuer.controller,
    WALLET_ORIGIN: "http://localhost:5173",
    SESSIONS: memoryNamespace(),
    ...overrides,
  };
}

async function createSession(env: ShopBindings): Promise<VerificationSessionBody> {
  const res = await app.request("/api/verification", { method: "POST" }, env);
  expect(res.status).toBe(200);
  return (await res.json()) as VerificationSessionBody;
}

async function presentAndPost(options: {
  env: ShopBindings;
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

    expect(body.wallet_link).toContain("http://localhost:5173/present?");
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

describe("POST /oid4vp/response", () => {
  it("verifies an adult age_over_18 flag presentation end to end", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({ env, request: session.request, credential: adultViaFlag });
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
  });

  it("denies a minor whose license attests age_over_18: false", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({ env, request: session.request, credential: minorViaFlag });
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
    const res = await presentAndPost({ env, request: session.request, credential: adultViaDob });
    expect(res.status).toBe(200);

    const status = await sessionStatus(env, session.session_id);
    expect(status.status).toBe("verified");
    if (status.status !== "verified") return;
    expect(status.verdict).toBe("allowed");
    expect(status.disclosed["birth_date"]).toBe("1988-04-19");
    expect(status.reason).toMatch(/full birthdate/);
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

  it("rejects a tampered disclosed claim", async () => {
    const env = makeEnv();
    const session = await createSession(env);
    const res = await presentAndPost({
      env,
      request: session.request,
      credential: minorViaFlag,
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

  describe("tier 2 (zkAgeProof)", () => {
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
      // The commitment is all the shop learned — no flag, no birthdate.
      expect(status.disclosed["birthDateCommitment"]).toBe(adultOpening.commitment);
      expect(status.disclosed["age_over_18"]).toBeUndefined();
      expect(status.disclosed["birth_date"]).toBeUndefined();

      expect(status.zk).toBeDefined();
      if (status.zk === undefined) return;
      expect(status.zk.commitment).toBe(adultOpening.commitment);
      expect(status.zk.years).toBe(18);

      // The exact call the shop client (and a self-hosted verifier) makes:
      const zkResult = await verifyAgeProof({
        proof: status.zk.proof,
        commitment: status.zk.commitment,
        cutoffDays: status.zk.cutoffDays,
      });
      expect(zkResult.verified).toBe(true);
    }, 60_000);

    const fakeProof = () => toBase64Url(new Uint8Array(14656).fill(1));

    it("rejects a proof about a different commitment than the issuer signed", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const otherCommitment = createCommitment(daysSinceEpoch("2005-01-01")).commitment;
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

    it("rejects a cutoff later than today's policy cutoff", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaCommitment,
        zkAgeProof: { ...adultZkBundle, cutoffDays: ageCutoffDays(18) + 30, proof: fakeProof() },
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/cutoff/);
    });

    it("rejects a proof for a weaker age threshold than the policy's", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaCommitment,
        zkAgeProof: { ...adultZkBundle, years: 16, proof: fakeProof() },
      });
      expect(res.status).toBe(400);
      const status = await sessionStatus(env, session.session_id);
      expect(status.status).toBe("failed");
      if (status.status !== "failed") return;
      expect(status.reason).toMatch(/age_over_16.*age_over_18/);
    });

    it("rejects a malformed bundle (unknown scheme)", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaCommitment,
        zkAgeProof: { ...adultZkBundle, scheme: "groth16" },
      });
      expect(res.status).toBe(400);
      expect((await sessionStatus(env, session.session_id)).status).toBe("failed");
    });

    it("rejects a zkAgeProof when the commitment claim is not disclosed", async () => {
      const env = makeEnv();
      const session = await createSession(env);
      const res = await presentAndPost({
        env,
        request: session.request,
        credential: adultViaFlag, // discloses the flag, not the commitment
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
            ageCutoffDays(18) - 10_000;
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
