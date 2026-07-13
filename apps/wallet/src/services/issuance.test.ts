/**
 * OID4VCI wallet-side tests against a scripted fake issuer that uses REAL
 * crypto end to end: it verifies the wallet's proof-of-possession JWT with
 * `verifyProofJwt` (aud + nonce checked) before answering, and returns a
 * genuine BBS-signed Utopia DL with a Poseidon birthdate commitment — so a
 * green run means the wallet's integrity checks exercised actual signatures,
 * not fixtures. Only IndexedDB is mocked (in-memory `addCredential` capture).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCommitment,
  daysSinceEpoch,
  decryptJson,
  deriveHolderSeed,
  deriveVaultKey,
  verifyCommitment,
} from "@vgw/keys";
import {
  CREDENTIAL_CONFIGURATION_ID,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  ed25519KeyPairFromSeed,
  verifyProofJwt,
  type CredentialOffer,
  type CredentialRequest,
  type CredentialResponse,
  type IssuerMetadata,
  type TokenResponse,
} from "@vgw/protocols";
import {
  buildUtopiaDriversLicense,
  generateBbsKeyPair,
  signCredential,
  type BbsKeyPair,
} from "@vgw/vc-kit";
import type { CredentialPayload, NewCredentialRecord } from "./db";
import {
  ISSUANCE_STEPS,
  acceptCredentialOffer,
  isInsecureIssuerOrigin,
  parseOfferParams,
  previewCredentialOffer,
  type IssuanceStep,
} from "./issuance";

const db = vi.hoisted(() => {
  const stored: (NewCredentialRecord & { id: number })[] = [];
  return {
    stored,
    async addCredential(input: NewCredentialRecord) {
      const record = { ...input, id: stored.length + 1 };
      stored.push(record);
      return record;
    },
  };
});

// Replace the real IndexedDB-backed module before issuance.ts imports it.
vi.mock("./db", () => ({ addCredential: db.addCredential }));

const SUBJECT = {
  givenName: "Jamie",
  familyName: "Voss",
  birthDate: "1996-03-14",
  documentNumber: "UDL-TEST-0001",
} as const;

const PRE_AUTH_CODE = "demo-pre-auth-code";
const ACCESS_TOKEN = "demo-access-token";
const C_NONCE = "demo-c-nonce";

interface FakeIssuerConfig {
  origin: string;
  seed: Uint8Array;
  /** Bind the VC to this DID instead of the holder proven by the PoP JWT. */
  subjectIdOverride?: string;
  /** Return a wrong blinding in vgw_commitment_opening. */
  tamperOpening?: boolean;
  /** Make the token endpoint fail with this OAuth error. */
  tokenError?: { status: number; body: Record<string, unknown> };
  /** Transform the served metadata (hostile-display tests). */
  mutateMetadata?: (metadata: IssuerMetadata) => unknown;
  /** Runs as the token endpoint is hit — interleave session actions mid-flight. */
  onTokenRequest?: () => void;
  /** Transform the credential response (malformed-response tests). */
  mutateCredentialResponse?: (response: CredentialResponse) => unknown;
}

interface FakeIssuer {
  origin: string;
  offerUri: string;
  keyPair: BbsKeyPair;
  handle(request: Request): Promise<Response>;
  captured: {
    grantType: string | null;
    preAuthorizedCode: string | null;
    authorization: string | null;
    configurationId: string | null;
    holderDid: string | null;
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function makeFakeIssuer(config: FakeIssuerConfig): Promise<FakeIssuer> {
  const keyPair = await generateBbsKeyPair(config.seed);
  const { origin } = config;

  const offer: CredentialOffer = {
    credential_issuer: origin,
    credential_configuration_ids: [CREDENTIAL_CONFIGURATION_ID],
    grants: {
      [PRE_AUTHORIZED_CODE_GRANT_TYPE]: { "pre-authorized_code": PRE_AUTH_CODE },
    },
  };
  const metadata: IssuerMetadata = {
    credential_issuer: origin,
    credential_endpoint: `${origin}/oid4vci/credential`,
    token_endpoint: `${origin}/oid4vci/token`,
    display: [{ name: "Utopia DMV", locale: "en-US" }],
    credential_configurations_supported: {
      [CREDENTIAL_CONFIGURATION_ID]: {
        format: "ldp_vc",
        credential_definition: {
          "@context": ["https://www.w3.org/ns/credentials/v2"],
          type: ["VerifiableCredential", "Iso18013DriversLicenseCredential"],
        },
        cryptographic_binding_methods_supported: ["did:key"],
        proof_types_supported: {
          jwt: { proof_signing_alg_values_supported: ["EdDSA"] },
        },
        display: [{ name: "Utopia Driver's License" }],
      },
    },
  };

  const captured: FakeIssuer["captured"] = {
    grantType: null,
    preAuthorizedCode: null,
    authorization: null,
    configurationId: null,
    holderDid: null,
  };

  const handle = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;

    if (request.method === "GET" && path === "/oid4vci/offer/demo") {
      return json(offer);
    }
    if (request.method === "GET" && path === "/.well-known/openid-credential-issuer") {
      return json(config.mutateMetadata?.(metadata) ?? metadata);
    }
    if (request.method === "POST" && path === "/oid4vci/token") {
      config.onTokenRequest?.();
      if (config.tokenError !== undefined) {
        return json(config.tokenError.body, config.tokenError.status);
      }
      const form = new URLSearchParams(await request.text());
      captured.grantType = form.get("grant_type");
      captured.preAuthorizedCode = form.get("pre-authorized_code");
      const token: TokenResponse = {
        access_token: ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 300,
        c_nonce: C_NONCE,
        c_nonce_expires_in: 300,
      };
      return json(token);
    }
    if (request.method === "POST" && path === "/oid4vci/credential") {
      captured.authorization = request.headers.get("authorization");
      const body = (await request.json()) as CredentialRequest;
      captured.configurationId = body.credential_configuration_id;
      // Real PoP verification, exactly like the Worker will do: aud and
      // nonce are asserted inside verifyProofJwt (throws on any mismatch).
      const verified = verifyProofJwt({
        jwt: body.proof.jwt,
        audience: origin,
        nonce: C_NONCE,
      });
      captured.holderDid = verified.holderDid;

      const days = daysSinceEpoch(SUBJECT.birthDate);
      const opening = createCommitment(days);
      // Like the real DMV: no subjectId by default (unlinkability — node ids
      // are structurally revealed by every derived proof).
      const unsigned = buildUtopiaDriversLicense({
        ...(config.subjectIdOverride !== undefined
          ? { subjectId: config.subjectIdOverride }
          : {}),
        ...SUBJECT,
        birthDateCommitment: opening.commitment,
        issuer: { id: keyPair.controller, name: "Utopia DMV" },
      });
      const signed = await signCredential({ credential: unsigned, keyPair });
      const response: CredentialResponse = {
        credentials: [{ credential: signed as Record<string, unknown> }],
        vgw_commitment_opening: {
          value: days,
          blinding: config.tamperOpening ? `0x${"11".repeat(31)}` : opening.blinding,
          commitment: opening.commitment,
        },
      };
      return json(config.mutateCredentialResponse?.(response) ?? response);
    }
    return json({ error: "not_found" }, 404);
  };

  return { origin, offerUri: `${origin}/oid4vci/offer/demo`, keyPair, handle, captured };
}

/** Route global fetch by origin to the given fake issuers. */
function routeFetchTo(...issuers: FakeIssuer[]): void {
  const byOrigin = new Map(issuers.map((issuer) => [issuer.origin, issuer]));
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(
        input instanceof Request ? input : String(input),
        init,
      );
      const issuer = byOrigin.get(new URL(request.url).origin);
      if (issuer === undefined) {
        throw new TypeError(`No fake issuer registered for ${request.url}`);
      }
      return issuer.handle(request);
    },
  );
}

describe("acceptCredentialOffer", () => {
  let masterSecret: Uint8Array;
  let vaultKey: CryptoKey;

  beforeAll(async () => {
    masterSecret = crypto.getRandomValues(new Uint8Array(32));
    vaultKey = await deriveVaultKey(masterSecret);
  });

  beforeEach(() => {
    db.stored.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs the full pre-authorized flow and stores the encrypted credential", async () => {
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
    });
    routeFetchTo(issuer);

    const steps: IssuanceStep[] = [];
    const record = await acceptCredentialOffer({
      offerUri: issuer.offerUri,
      accountId: 7,
      masterSecret,
      vaultKey,
      onStep: (step) => steps.push(step),
    });

    expect(steps).toEqual(ISSUANCE_STEPS.map((s) => s.id));
    expect(issuer.captured.grantType).toBe(PRE_AUTHORIZED_CODE_GRANT_TYPE);
    expect(issuer.captured.preAuthorizedCode).toBe(PRE_AUTH_CODE);
    expect(issuer.captured.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(issuer.captured.configurationId).toBe(CREDENTIAL_CONFIGURATION_ID);

    expect(record.accountId).toBe(7);
    expect(record.meta).toEqual({
      name: "Utopia Driver's License",
      issuerName: "Utopia DMV",
      kind: "Iso18013DriversLicenseCredential",
      colorSeed: "Iso18013DriversLicenseCredential",
    });
    expect(db.stored).toHaveLength(1);

    // The payload must decrypt under the vault key to the full envelope.
    const envelope = await decryptJson<CredentialPayload>(vaultKey, record.payload);
    expect(envelope.commitmentOpening).toBeDefined();
    const opening = envelope.commitmentOpening;
    if (opening === undefined) throw new Error("unreachable");
    expect(opening.value).toBe(daysSinceEpoch(SUBJECT.birthDate));
    expect(verifyCommitment(opening.value, opening.blinding, opening.commitment)).toBe(
      true,
    );

    // Holder binding happens in the PoP JWT (the issuer saw the wallet's
    // pairwise DID there); the stored VC itself deliberately names no
    // subject id — every derived proof would reveal it structurally.
    const holderSeed = await deriveHolderSeed(masterSecret, issuer.origin);
    const holder = ed25519KeyPairFromSeed(holderSeed);
    const subject = envelope.vc.credentialSubject as Record<string, unknown>;
    expect(subject["id"]).toBeUndefined();
    expect(issuer.captured.holderDid).toBe(holder.did);
  }, 60_000);

  it("derives a different pairwise holder DID per issuer origin", async () => {
    const issuerA = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
    });
    const issuerB = await makeFakeIssuer({
      origin: "https://insurance.utopia.example",
      seed: new Uint8Array(32).fill(2),
    });
    routeFetchTo(issuerA, issuerB);

    const recordA = await acceptCredentialOffer({
      offerUri: issuerA.offerUri,
      accountId: 1,
      masterSecret,
      vaultKey,
    });

    // Issuer B goes through the preview → accept path the Offer page uses.
    const preview = await previewCredentialOffer({ offerUri: issuerB.offerUri });
    expect(preview.issuerOrigin).toBe(issuerB.origin);
    expect(preview.issuerName).toBe("Utopia DMV");
    expect(preview.credentialName).toBe("Utopia Driver's License");
    const recordB = await acceptCredentialOffer({
      offer: preview.offer,
      metadata: preview.metadata,
      accountId: 1,
      masterSecret,
      vaultKey,
    });

    // Both issuances stored successfully…
    expect(recordA.id).not.toBe(recordB.id);
    // …and the pairwise property shows in the PoP DIDs each issuer observed:
    // same master secret, different issuer origin, different DID. (The
    // stored VCs deliberately carry no subject id — the binding lives in
    // the PoP JWT.)
    expect(typeof issuerA.captured.holderDid).toBe("string");
    expect(typeof issuerB.captured.holderDid).toBe("string");
    expect(issuerA.captured.holderDid).not.toBe(issuerB.captured.holderDid);
  }, 90_000);

  it("surfaces token endpoint errors with the endpoint and OAuth detail", async () => {
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      tokenError: {
        status: 400,
        body: { error: "invalid_grant", error_description: "unknown pre-authorized code" },
      },
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(
      /token endpoint.*HTTP 400.*invalid_grant — unknown pre-authorized code/,
    );
    expect(db.stored).toHaveLength(0);
  }, 30_000);

  it("rejects a credential bound to a different subject DID", async () => {
    const stranger = ed25519KeyPairFromSeed(new Uint8Array(32).fill(9));
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      subjectIdOverride: stranger.did,
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/bound to .* instead of this wallet's holder DID/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);

  it("proves the real pairwise DID even if the session zeroes the secret mid-flight", async () => {
    // What logout() does during the token round-trip: the session's buffer
    // is zeroed IN PLACE while the flow still holds a reference to it. The
    // PoP JWT must never end up proving the publicly-derivable
    // all-zero-master key. (The VC carries no subject id, so the PoP DID the
    // issuer observed is where the binding lives.)
    const liveSecret = masterSecret.slice();
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      onTokenRequest: () => liveSecret.fill(0),
    });
    routeFetchTo(issuer);

    await acceptCredentialOffer({
      offerUri: issuer.offerUri,
      accountId: 1,
      masterSecret: liveSecret,
      vaultKey,
    });

    const realHolder = ed25519KeyPairFromSeed(
      await deriveHolderSeed(masterSecret, issuer.origin),
    );
    const zeroHolder = ed25519KeyPairFromSeed(
      await deriveHolderSeed(new Uint8Array(32), issuer.origin),
    );
    expect(issuer.captured.holderDid).toBe(realHolder.did);
    expect(issuer.captured.holderDid).not.toBe(zeroHolder.did);
  }, 60_000);

  it("stops at the next phase boundary when the session locks mid-flight", async () => {
    const liveSecret = masterSecret.slice();
    const lock = new AbortController();
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      // Both halves of logout(): zero the secret, abort the lock signal.
      onTokenRequest: () => {
        liveSecret.fill(0);
        lock.abort(new Error("The wallet was locked"));
      },
    });
    routeFetchTo(issuer);

    const steps: IssuanceStep[] = [];
    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret: liveSecret,
        vaultKey,
        signal: lock.signal,
        onStep: (step) => steps.push(step),
      }),
    ).rejects.toThrow(/wallet was locked/);
    // Nothing signed, nothing stored: the flow never reached the proof phase.
    expect(steps).not.toContain("creating-proof");
    expect(db.stored).toHaveLength(0);
  }, 30_000);

  it("never lets non-string metadata display names reach the preview", async () => {
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      // A hostile issuer can put any JSON shape in display — a non-string
      // rendered as a React child would crash the whole app.
      mutateMetadata: (metadata) => ({
        ...metadata,
        display: [{ name: { x: 1 } }],
        credential_configurations_supported: {
          [CREDENTIAL_CONFIGURATION_ID]: {
            ...metadata.credential_configurations_supported[
              CREDENTIAL_CONFIGURATION_ID
            ],
            display: [{ name: "" }],
          },
        },
      }),
    });
    routeFetchTo(issuer);

    const preview = await previewCredentialOffer({ offerUri: issuer.offerUri });
    expect(preview.issuerName).toBe("dmv.utopia.example");
    expect(preview.credentialName).toBe(CREDENTIAL_CONFIGURATION_ID);
  }, 30_000);

  it("reports a malformed credentials array as a protocol error, not a TypeError", async () => {
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      mutateCredentialResponse: () => ({ credentials: [null] }),
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/empty or malformed credentials array/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);

  it("reports a null proof as an unbound-proof error, not a TypeError", async () => {
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      mutateCredentialResponse: (response) => ({
        ...response,
        credentials: response.credentials.map((entry) => ({
          credential: { ...entry.credential, proof: null },
        })),
      }),
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/not controlled by its declared issuer/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);

  it("rejects a tampered commitment opening", async () => {
    const issuer = await makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      tamperOpening: true,
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/commitment opening does not open/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);
});

describe("parseOfferParams", () => {
  const offer: CredentialOffer = {
    credential_issuer: "https://dmv.utopia.example",
    credential_configuration_ids: [CREDENTIAL_CONFIGURATION_ID],
    grants: {
      [PRE_AUTHORIZED_CODE_GRANT_TYPE]: { "pre-authorized_code": "abc" },
    },
  };

  it("reads credential_offer_uri", () => {
    const params = new URLSearchParams({
      credential_offer_uri: "https://dmv.utopia.example/oid4vci/offer/xyz",
    });
    expect(parseOfferParams(params)).toEqual({
      kind: "uri",
      offerUri: "https://dmv.utopia.example/oid4vci/offer/xyz",
    });
  });

  it("rejects a non-URL credential_offer_uri", () => {
    const params = new URLSearchParams({ credential_offer_uri: "not a url" });
    expect(parseOfferParams(params).kind).toBe("invalid");
  });

  it("accepts an inline credential_offer", () => {
    const params = new URLSearchParams({ credential_offer: JSON.stringify(offer) });
    expect(parseOfferParams(params)).toEqual({ kind: "inline", offer });
  });

  it("rejects an inline offer without the pre-authorized grant", () => {
    const { grants: _grants, ...rest } = offer;
    const params = new URLSearchParams({ credential_offer: JSON.stringify(rest) });
    const parsed = parseOfferParams(params);
    expect(parsed.kind).toBe("invalid");
    if (parsed.kind === "invalid") {
      expect(parsed.reason).toMatch(/pre-authorized_code/);
    }
  });

  it("reports missing params", () => {
    expect(parseOfferParams(new URLSearchParams())).toEqual({ kind: "missing" });
  });
});

describe("isInsecureIssuerOrigin", () => {
  it("flags plain http on non-local hosts only", () => {
    expect(isInsecureIssuerOrigin("http://dmv.utopia.example")).toBe(true);
    expect(isInsecureIssuerOrigin("https://dmv.utopia.example")).toBe(false);
    expect(isInsecureIssuerOrigin("http://localhost:8787")).toBe(false);
    expect(isInsecureIssuerOrigin("http://127.0.0.1:8787")).toBe(false);
    expect(isInsecureIssuerOrigin("http://dmv.localhost:8787")).toBe(false);
  });
});
