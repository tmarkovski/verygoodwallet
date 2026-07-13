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
      return json(metadata);
    }
    if (request.method === "POST" && path === "/oid4vci/token") {
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
      const unsigned = buildUtopiaDriversLicense({
        subjectId: config.subjectIdOverride ?? verified.holderDid,
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
      return json(response);
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

    // Subject binding: the stored VC names the wallet's pairwise DID for
    // this issuer origin — the same DID the issuer saw in the PoP JWT.
    const holderSeed = await deriveHolderSeed(masterSecret, issuer.origin);
    const holder = ed25519KeyPairFromSeed(holderSeed);
    const subject = envelope.vc.credentialSubject as Record<string, unknown>;
    expect(subject["id"]).toBe(holder.did);
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

    const envelopeA = await decryptJson<CredentialPayload>(vaultKey, recordA.payload);
    const envelopeB = await decryptJson<CredentialPayload>(vaultKey, recordB.payload);
    const subjectA = envelopeA.vc.credentialSubject as Record<string, unknown>;
    const subjectB = envelopeB.vc.credentialSubject as Record<string, unknown>;
    expect(typeof subjectA["id"]).toBe("string");
    expect(typeof subjectB["id"]).toBe("string");
    // Pairwise property: same master secret, different issuer, different DID.
    expect(subjectA["id"]).not.toBe(subjectB["id"]);
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
