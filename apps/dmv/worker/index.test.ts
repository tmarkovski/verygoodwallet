/**
 * Protocol tests for the DMV issuer Worker, driven through `app.request`
 * with a fixed test env. The worker is WebCrypto + pure JS (no CF-only
 * APIs), so these run in plain Node.
 *
 * The centerpiece is a full end-to-end pass of the pinned N2 contract:
 * offer -> offer-by-reference -> token -> link-secret commitment + PoP JWT
 * signing its digest -> credkit blind-signed VC that passes the holder's
 * receipt check (`verifyIssuedCredkitCredential`). No commitment opening
 * travels; the issuer never sees the link secret.
 */

import { describe, expect, it } from "vitest";
import { toBase64Url } from "@vgw/keys";
import {
  CREDENTIAL_CONFIGURATION_ID,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  RESIDENT_CREDENTIAL_CONFIGURATION_ID,
  commitmentDigest,
  createProofJwt,
  ed25519KeyPairFromSeed,
  mintSignedToken,
  readSignedToken,
  type CredentialOffer,
  type CredentialResponse,
  type IssuerMetadata,
  type Oid4vciErrorResponse,
  type TokenResponse,
} from "@vgw/protocols";
import {
  createHolderBinding,
  credentialRevocationStatus,
  parseRevocationRegistryState,
  refreshRevocationWitness,
  verifyIssuedCredkitCredential,
  verifyRevocationWitness,
  type HolderBinding,
  type RevocationRegistryState,
  type VerifiableCredential,
} from "@vgw/vc-kit";
import app, { type OfferResponseBody } from "./index.js";
import type { DmvBindings, DurableObjectNamespaceLike } from "./env.js";
import { RevocationRegistry, type RegistryCredentialRow } from "./registry.js";
import type { OfferCodePayload } from "./tokens.js";

async function readOfferPayload(offer: CredentialOffer): Promise<OfferCodePayload> {
  return readSignedToken<OfferCodePayload>({
    secret: TEST_ENV.TOKEN_SECRET ?? "",
    token: preAuthorizedCode(offer),
  });
}

/** In-memory namespace running the REAL RevocationRegistry class. */
function memoryRegistryNamespace(): DurableObjectNamespaceLike {
  const instances = new Map<string, RevocationRegistry>();
  return {
    idFromName: (name: string) => ({ name }),
    get: (id) => {
      const name = (id as { name: string }).name;
      let instance = instances.get(name);
      if (instance === undefined) {
        const data = new Map<string, unknown>();
        instance = new RevocationRegistry({
          storage: {
            get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
            put: (key: string, value: unknown) => {
              data.set(key, value);
              return Promise.resolve();
            },
            // Real DO storage lists in key order — the registry's zero-padded
            // update keys depend on it, so the stub must sort too.
            list: <T>(options: { prefix: string }) => {
              const entries = [...data.entries()]
                .filter(([key]) => key.startsWith(options.prefix))
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
              return Promise.resolve(new Map(entries) as Map<string, T>);
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

const TEST_ENV: DmvBindings = {
  ISSUER_SEED: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  TOKEN_SECRET: "test-token-secret",
  REGISTRY: memoryRegistryNamespace(),
};

/** `app.request` resolves bare paths against http://localhost. */
const TEST_ISSUER_ORIGIN = "http://localhost";

/** Fixed issuance-PoP key so the expected pairwise did:key is deterministic. */
const HOLDER_SEED = new Uint8Array(32).fill(7);
const HOLDER_DID = ed25519KeyPairFromSeed(HOLDER_SEED).did;

/** The wallet's one-for-life link secret (fixed for determinism). */
const LINK_SECRET = new Uint8Array(32).fill(5);

const SUBJECT = {
  givenName: "Jamie",
  familyName: "Voss",
  birthDate: "1996-03-14",
} as const;

/** Jamie's resident record: Port Azure (coastal, fips 11, postal block 40100–40199). */
const RESIDENT_SUBJECT = {
  credential_configuration_id: RESIDENT_CREDENTIAL_CONFIGURATION_ID,
  givenName: "Jamie",
  familyName: "Voss",
  districtFips: 11,
  postalCode: 40125,
} as const;

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  env: DmvBindings = TEST_ENV,
): Promise<Response> {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function createOffer(
  body: Record<string, unknown> = SUBJECT,
): Promise<OfferResponseBody> {
  const res = await postJson("/api/offers", body);
  expect(res.status).toBe(200);
  return (await res.json()) as OfferResponseBody;
}

function preAuthorizedCode(offer: CredentialOffer): string {
  return offer.grants[PRE_AUTHORIZED_CODE_GRANT_TYPE]["pre-authorized_code"];
}

async function exchangeForToken(code: string): Promise<TokenResponse> {
  const res = await app.request(
    "/oid4vci/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE,
        "pre-authorized_code": code,
      }).toString(),
    },
    TEST_ENV,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as TokenResponse;
}

async function expectOauthError(
  res: Response,
  status: number,
  error: string,
): Promise<Oid4vciErrorResponse> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Oid4vciErrorResponse;
  expect(body.error).toBe(error);
  expect(typeof body.error_description).toBe("string");
  return body;
}

describe("issuer metadata", () => {
  it("serves /.well-known/openid-credential-issuer per the pinned contract", async () => {
    const res = await app.request("/.well-known/openid-credential-issuer", {}, TEST_ENV);
    expect(res.status).toBe(200);
    const metadata = (await res.json()) as IssuerMetadata;

    expect(metadata.credential_issuer).toBe(TEST_ISSUER_ORIGIN);
    expect(metadata.credential_endpoint).toBe(`${TEST_ISSUER_ORIGIN}/oid4vci/credential`);
    expect(metadata.token_endpoint).toBe(`${TEST_ISSUER_ORIGIN}/oid4vci/token`);
    expect(metadata.display).toEqual([{ name: "Utopia DMV", locale: "en-US" }]);
    // Verifiers pin expectedIssuer from this field (fetched over our origin);
    // it must be the same DID the credential endpoint signs under.
    expect(metadata.vgw_issuer_did).toMatch(/^did:key:zUC7/);

    const config =
      metadata.credential_configurations_supported[CREDENTIAL_CONFIGURATION_ID];
    expect(config).toBeDefined();
    expect(config?.format).toBe("ldp_vc");
    expect(config?.credential_definition.type).toEqual([
      "VerifiableCredential",
      "Iso18013DriversLicenseCredential",
    ]);
    expect(config?.cryptographic_binding_methods_supported).toEqual(["did:key"]);
    expect(
      config?.proof_types_supported.jwt.proof_signing_alg_values_supported,
    ).toEqual(["EdDSA"]);
  });

  it("advertises the resident registration as a second configuration (N5)", async () => {
    const res = await app.request("/.well-known/openid-credential-issuer", {}, TEST_ENV);
    const metadata = (await res.json()) as IssuerMetadata;
    const config =
      metadata.credential_configurations_supported[RESIDENT_CREDENTIAL_CONFIGURATION_ID];
    expect(config).toBeDefined();
    expect(config?.format).toBe("ldp_vc");
    expect(config?.credential_definition.type).toEqual([
      "VerifiableCredential",
      "UtopiaResidentRegistrationCredential",
    ]);
    expect(config?.credential_definition["@context"]).toEqual([
      "https://www.w3.org/ns/credentials/v2",
      "https://w3id.org/citizenship/v3",
      "https://verygoodwallet.com/contexts/utopia-resident/v1",
    ]);
    expect(config?.display).toEqual([{ name: "Utopia Resident Registration" }]);
  });
});

describe("POST /api/offers", () => {
  it("mints an offer whose code round-trips through the offer URI", async () => {
    const { credential_offer, credential_offer_uri, wallet_link } = await createOffer();

    expect(credential_offer.credential_issuer).toBe(TEST_ISSUER_ORIGIN);
    expect(credential_offer.credential_configuration_ids).toEqual([
      CREDENTIAL_CONFIGURATION_ID,
    ]);
    const code = preAuthorizedCode(credential_offer);
    expect(credential_offer_uri).toBe(`${TEST_ISSUER_ORIGIN}/oid4vci/offer/${code}`);
    // No Origin header, no WALLET_ORIGIN -> no wallet_link. Pre-M6 there is
    // no production wallet to default to (the apex serves the legacy app),
    // so omitting the link beats minting one that dead-ends at the wrong host.
    expect(wallet_link).toBeUndefined();

    const fetched = await app.request(new URL(credential_offer_uri).pathname, {}, TEST_ENV);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()) as CredentialOffer).toEqual(credential_offer);
  });

  it("auto-generates a well-formed documentNumber and embeds the record in the code", async () => {
    const { credential_offer } = await createOffer();
    const payload = await readOfferPayload(credential_offer);
    expect(payload.use).toBe("offer");
    // An offer body without a discriminator is a license offer (the pre-N5
    // API shape) — and the code binds that configuration explicitly.
    if (payload.configurationId !== CREDENTIAL_CONFIGURATION_ID) {
      throw new Error(`expected a license offer, got ${payload.configurationId}`);
    }
    expect(payload.givenName).toBe(SUBJECT.givenName);
    expect(payload.familyName).toBe(SUBJECT.familyName);
    expect(payload.birthDate).toBe(SUBJECT.birthDate);
    expect(payload.documentNumber).toMatch(/^UDL-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });

  it("accepts a caller-supplied documentNumber and trims names", async () => {
    const { credential_offer } = await createOffer({
      givenName: "  Jamie ",
      familyName: " Voss ",
      birthDate: SUBJECT.birthDate,
      documentNumber: "UDL-K4Q7-XW2M",
    });
    const payload = await readOfferPayload(credential_offer);
    if (payload.configurationId !== CREDENTIAL_CONFIGURATION_ID) {
      throw new Error(`expected a license offer, got ${payload.configurationId}`);
    }
    expect(payload.givenName).toBe("Jamie");
    expect(payload.familyName).toBe("Voss");
    expect(payload.documentNumber).toBe("UDL-K4Q7-XW2M");
  });

  it("uses a localhost Origin header for the wallet link", async () => {
    const res = await postJson("/api/offers", SUBJECT, { origin: "http://localhost:5173" });
    const { wallet_link } = (await res.json()) as OfferResponseBody;
    expect(wallet_link?.startsWith("http://localhost:5173/offer?")).toBe(true);
  });

  it("ignores a non-localhost Origin header (no wallet_link rather than a guess)", async () => {
    const res = await postJson("/api/offers", SUBJECT, { origin: "https://evil.example" });
    const { wallet_link } = (await res.json()) as OfferResponseBody;
    expect(wallet_link).toBeUndefined();
  });

  it("lets WALLET_ORIGIN override everything", async () => {
    const res = await postJson("/api/offers", SUBJECT, { origin: "http://localhost:5173" }, {
      ...TEST_ENV,
      WALLET_ORIGIN: "https://wallet.example",
    });
    const { wallet_link } = (await res.json()) as OfferResponseBody;
    expect(wallet_link?.startsWith("https://wallet.example/offer?")).toBe(true);
  });

  it("normalizes a WALLET_ORIGIN with a trailing slash", async () => {
    // "https://x/" + "/offer" would yield "//offer", which the wallet's
    // router silently redirects away from — the origin must be normalized.
    const res = await postJson("/api/offers", SUBJECT, {}, {
      ...TEST_ENV,
      WALLET_ORIGIN: "https://wallet.example/",
    });
    const { wallet_link } = (await res.json()) as OfferResponseBody;
    expect(wallet_link?.startsWith("https://wallet.example/offer?")).toBe(true);
  });

  it("fails loudly on a WALLET_ORIGIN that is not an absolute URL", async () => {
    // Same policy as a malformed ISSUER_SEED: a misconfigured deploy should
    // error, not silently emit broken links.
    const res = await postJson("/api/offers", SUBJECT, {}, {
      ...TEST_ENV,
      WALLET_ORIGIN: "verygoodwallet.com",
    });
    expect(res.status).toBe(500);
  });

  it.each([
    ["missing givenName", { ...SUBJECT, givenName: "  " }],
    ["missing familyName", { givenName: "Jamie", birthDate: SUBJECT.birthDate }],
    ["overlong name", { ...SUBJECT, givenName: "x".repeat(81) }],
    ["malformed birthDate", { ...SUBJECT, birthDate: "March 14, 1996" }],
    ["impossible birthDate", { ...SUBJECT, birthDate: "1996-02-30" }],
    ["future birthDate", { ...SUBJECT, birthDate: "2999-01-01" }],
    ["age over 120", { ...SUBJECT, birthDate: "1880-01-01" }],
    ["bad documentNumber", { ...SUBJECT, documentNumber: "UDL-101O-ILLO" }],
  ])("rejects %s with invalid_request", async (_label, body) => {
    const res = await postJson("/api/offers", body);
    await expectOauthError(res, 400, "invalid_request");
  });

  it("mints a resident offer bound to the resident configuration (N5)", async () => {
    const { credential_offer, credential_offer_uri } = await createOffer(RESIDENT_SUBJECT);
    expect(credential_offer.credential_configuration_ids).toEqual([
      RESIDENT_CREDENTIAL_CONFIGURATION_ID,
    ]);

    const payload = await readOfferPayload(credential_offer);
    expect(payload.use).toBe("offer");
    if (payload.configurationId !== RESIDENT_CREDENTIAL_CONFIGURATION_ID) {
      throw new Error(`expected a resident offer, got ${payload.configurationId}`);
    }
    expect(payload.givenName).toBe("Jamie");
    expect(payload.familyName).toBe("Voss");
    expect(payload.districtFips).toBe(11);
    expect(payload.postalCode).toBe(40125);

    // The offer-by-reference reconstruction reflects the SAME configuration.
    const fetched = await app.request(new URL(credential_offer_uri).pathname, {}, TEST_ENV);
    expect(fetched.status).toBe(200);
    expect((await fetched.json()) as CredentialOffer).toEqual(credential_offer);
  });

  it.each([
    ["unknown credential_configuration_id", { ...RESIDENT_SUBJECT, credential_configuration_id: "SomeOtherCredential" }],
    ["missing resident givenName", { ...RESIDENT_SUBJECT, givenName: "  " }],
    ["missing resident familyName", { ...RESIDENT_SUBJECT, familyName: undefined }],
    ["missing districtFips", { ...RESIDENT_SUBJECT, districtFips: undefined }],
    ["non-integer districtFips", { ...RESIDENT_SUBJECT, districtFips: "11" }],
    ["unknown districtFips", { ...RESIDENT_SUBJECT, districtFips: 99 }],
    ["missing postalCode", { ...RESIDENT_SUBJECT, postalCode: undefined }],
    ["non-integer postalCode", { ...RESIDENT_SUBJECT, postalCode: 40125.5 }],
    ["postal code below the district block", { ...RESIDENT_SUBJECT, postalCode: 40099 }],
    ["postal code from another district's block", { ...RESIDENT_SUBJECT, postalCode: 41150 }],
  ])("rejects a resident offer with %s", async (_label, body) => {
    const res = await postJson("/api/offers", body);
    await expectOauthError(res, 400, "invalid_request");
  });
});

describe("GET /oid4vci/offer/:code", () => {
  it("404s on a tampered code", async () => {
    const { credential_offer } = await createOffer();
    const code = preAuthorizedCode(credential_offer);
    const tampered = (code[0] === "A" ? "B" : "A") + code.slice(1);
    const res = await app.request(`/oid4vci/offer/${tampered}`, {}, TEST_ENV);
    await expectOauthError(res, 404, "invalid_request");
  });
});

describe("POST /oid4vci/token", () => {
  it("exchanges a form-encoded pre-authorized code for a Bearer token", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    expect(token.token_type).toBe("Bearer");
    expect(token.expires_in).toBe(300);
    expect(token.c_nonce_expires_in).toBe(300);
    expect(token.c_nonce.length).toBeGreaterThan(0);
    expect(token.access_token.split(".")).toHaveLength(2);
  });

  it("also accepts a JSON body", async () => {
    const { credential_offer } = await createOffer();
    const res = await postJson("/oid4vci/token", {
      grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE,
      "pre-authorized_code": preAuthorizedCode(credential_offer),
    });
    expect(res.status).toBe(200);
    const token = (await res.json()) as TokenResponse;
    expect(token.token_type).toBe("Bearer");
  });

  it("rejects a wrong grant_type", async () => {
    const res = await postJson("/oid4vci/token", {
      grant_type: "authorization_code",
      "pre-authorized_code": "whatever",
    });
    await expectOauthError(res, 400, "unsupported_grant_type");
  });

  it("rejects a missing pre-authorized_code", async () => {
    const res = await postJson("/oid4vci/token", {
      grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE,
    });
    await expectOauthError(res, 400, "invalid_request");
  });

  it("rejects a tampered code", async () => {
    const { credential_offer } = await createOffer();
    const code = preAuthorizedCode(credential_offer);
    const res = await postJson("/oid4vci/token", {
      grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE,
      "pre-authorized_code": (code[0] === "A" ? "B" : "A") + code.slice(1),
    });
    await expectOauthError(res, 400, "invalid_grant");
  });

  it("rejects an expired code", async () => {
    const expired = await mintSignedToken({
      secret: TEST_ENV.TOKEN_SECRET ?? "",
      payload: { use: "offer", ...SUBJECT, documentNumber: "UDL-AAAA-2222" },
      ttlSeconds: -10,
    });
    const res = await postJson("/oid4vci/token", {
      grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE,
      "pre-authorized_code": expired,
    });
    await expectOauthError(res, 400, "invalid_grant");
  });

  it("rejects an access token presented as a code (wrong use)", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const res = await postJson("/oid4vci/token", {
      grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE,
      "pre-authorized_code": token.access_token,
    });
    await expectOauthError(res, 400, "invalid_grant");
  });
});

describe("POST /oid4vci/credential", () => {
  /** The wallet side of the N2 request: commitment + PoP signing its digest. */
  async function credentialRequestBody(
    binding: HolderBinding,
    nonce: string,
    configurationId: string = CREDENTIAL_CONFIGURATION_ID,
  ): Promise<Record<string, unknown>> {
    return {
      credential_configuration_id: configurationId,
      proof: {
        proof_type: "jwt",
        jwt: createProofJwt({
          seed: HOLDER_SEED,
          audience: TEST_ISSUER_ORIGIN,
          nonce,
          commitmentDigest: await commitmentDigest(binding.commitmentWithProof),
        }),
      },
      vgw_holder_commitment: toBase64Url(binding.commitmentWithProof),
    };
  }

  it("blind-issues a credkit DL end-to-end that passes the holder receipt check", async () => {
    const { credential_offer } = await createOffer();
    expect(credential_offer.credential_issuer).toBe(TEST_ISSUER_ORIGIN);

    const token = await exchangeForToken(preAuthorizedCode(credential_offer));

    // Wallet side: commit to the link secret, then prove possession of the
    // PoP key AND of this very commitment (its digest is signed into the PoP).
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const res = await postJson(
      "/oid4vci/credential",
      await credentialRequestBody(binding, token.c_nonce),
      { authorization: `Bearer ${token.access_token}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CredentialResponse;

    const vc = body.credentials[0]?.credential;
    expect(vc).toBeDefined();
    const proof = vc?.["proof"] as Record<string, unknown>;
    expect(proof["cryptosuite"]).toBe("credkit-bbs-sha-2026");
    expect(proof["type"]).toBe("DataIntegrityProof");

    // No subject id, deliberately: selective disclosure reveals node ids
    // structurally, so an embedded holder DID would correlate every
    // presentation of this credential across verifiers. Binding lives in the
    // blind-signed link-secret commitment instead.
    const subject = vc?.["credentialSubject"] as Record<string, unknown>;
    expect(subject["id"]).toBeUndefined();

    const license = subject["driversLicense"] as Record<string, unknown>;
    expect(license["given_name"]).toBe(SUBJECT.givenName);
    expect(license["family_name"]).toBe(SUBJECT.familyName);
    expect(license["birth_date"]).toBe(SUBJECT.birthDate);
    // The Poseidon handle is gone: age predicates prove against the hidden
    // date1900 twin, not a disclosed commitment.
    expect(license["birthDateCommitment"]).toBeUndefined();

    const issuer = vc?.["issuer"] as Record<string, unknown>;
    expect(issuer["name"]).toBe("Utopia DMV");
    expect(String(issuer["id"]).startsWith("did:key:")).toBe(true);

    // No opening travels — there is nothing the issuer could open.
    expect("vgw_commitment_opening" in body).toBe(false);

    // Holder receipt check: the credential really is blind-signed over THIS
    // wallet's link secret with THIS issuance's blind.
    const receivedVc = vc as unknown as VerifiableCredential;
    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: receivedVc,
        holderBinding: {
          linkSecret: LINK_SECRET,
          secretProverBlind: binding.secretProverBlind,
        },
      }),
    ).resolves.toBe(true);

    // …and fails closed for anyone who does not hold the secret + blind.
    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: receivedVc,
        holderBinding: {
          linkSecret: new Uint8Array(32).fill(6),
          secretProverBlind: binding.secretProverBlind,
        },
      }),
    ).resolves.toBe(false);
  });

  it("rejects a request without vgw_holder_commitment", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const body = await credentialRequestBody(binding, token.c_nonce);
    delete body["vgw_holder_commitment"];
    const res = await postJson("/oid4vci/credential", body, {
      authorization: `Bearer ${token.access_token}`,
    });
    const error = await expectOauthError(res, 400, "invalid_credential_request");
    expect(error.error_description).toContain("vgw_holder_commitment");
  });

  it("rejects a commitment that is not valid base64url", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const body = await credentialRequestBody(binding, token.c_nonce);
    body["vgw_holder_commitment"] = "not+valid/base64url!";
    const res = await postJson("/oid4vci/credential", body, {
      authorization: `Bearer ${token.access_token}`,
    });
    const error = await expectOauthError(res, 400, "invalid_credential_request");
    expect(error.error_description).toContain("base64url");
  });

  it("rejects well-formed base64url that is not a valid credkit commitment", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    // Garbage bytes with a MATCHING digest: the PoP passes, blind-signing
    // must still refuse the commitment itself (fail-closed at the crypto).
    const garbage = new Uint8Array(144).fill(9);
    const jwt = createProofJwt({
      seed: HOLDER_SEED,
      audience: TEST_ISSUER_ORIGIN,
      nonce: token.c_nonce,
      commitmentDigest: await commitmentDigest(garbage),
    });
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: { proof_type: "jwt", jwt },
        vgw_holder_commitment: toBase64Url(garbage),
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    const error = await expectOauthError(res, 400, "invalid_credential_request");
    expect(error.error_description).toContain("vgw_holder_commitment rejected");
  });

  it("rejects a PoP whose digest was minted for a different commitment", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const otherBinding = createHolderBinding({ linkSecret: LINK_SECRET });
    const jwt = createProofJwt({
      seed: HOLDER_SEED,
      audience: TEST_ISSUER_ORIGIN,
      nonce: token.c_nonce,
      commitmentDigest: await commitmentDigest(otherBinding.commitmentWithProof),
    });
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: { proof_type: "jwt", jwt },
        vgw_holder_commitment: toBase64Url(binding.commitmentWithProof),
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    const error = await expectOauthError(res, 400, "invalid_proof");
    expect(error.error_description).toContain("vgw_commitment_digest");
  });

  it("rejects a PoP that signs no commitment digest at all", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const jwt = createProofJwt({
      seed: HOLDER_SEED,
      audience: TEST_ISSUER_ORIGIN,
      nonce: token.c_nonce,
    });
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: { proof_type: "jwt", jwt },
        vgw_holder_commitment: toBase64Url(binding.commitmentWithProof),
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    const error = await expectOauthError(res, 400, "invalid_proof");
    expect(error.error_description).toContain("missing vgw_commitment_digest");
  });

  it("rejects a missing Authorization header", async () => {
    const res = await postJson("/oid4vci/credential", {
      credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
      proof: { proof_type: "jwt", jwt: "x.y.z" },
    });
    await expectOauthError(res, 401, "invalid_token");
  });

  it("rejects a garbage Bearer token", async () => {
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: { proof_type: "jwt", jwt: "x.y.z" },
      },
      { authorization: "Bearer not-a-token" },
    );
    await expectOauthError(res, 401, "invalid_token");
  });

  it("rejects a pre-authorized code presented as a Bearer token (wrong use)", async () => {
    const { credential_offer } = await createOffer();
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: { proof_type: "jwt", jwt: "x.y.z" },
      },
      { authorization: `Bearer ${preAuthorizedCode(credential_offer)}` },
    );
    await expectOauthError(res, 401, "invalid_token");
  });

  it.each([
    ["null", null],
    ["array", []],
  ])("rejects a JSON %s body with invalid_credential_request (not a 500)", async (_label, body) => {
    // JSON.parse("null") returns null without throwing, so without a shape
    // guard the handler would TypeError on property access -> a bare 500.
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const res = await postJson("/oid4vci/credential", body, {
      authorization: `Bearer ${token.access_token}`,
    });
    await expectOauthError(res, 400, "invalid_credential_request");
  });

  it("rejects an unknown credential_configuration_id", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: "SomeOtherCredential",
        proof: { proof_type: "jwt", jwt: "x.y.z" },
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    await expectOauthError(res, 400, "unsupported_credential_type");
  });

  it("blind-issues a resident registration end-to-end that passes the receipt check (N5)", async () => {
    const { credential_offer } = await createOffer(RESIDENT_SUBJECT);
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));

    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const res = await postJson(
      "/oid4vci/credential",
      await credentialRequestBody(binding, token.c_nonce, RESIDENT_CREDENTIAL_CONFIGURATION_ID),
      { authorization: `Bearer ${token.access_token}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CredentialResponse;

    const vc = body.credentials[0]?.credential;
    expect(vc).toBeDefined();
    const proof = vc?.["proof"] as Record<string, unknown>;
    expect(proof["cryptosuite"]).toBe("credkit-bbs-sha-2026");
    expect(vc?.["type"]).toEqual([
      "VerifiableCredential",
      "UtopiaResidentRegistrationCredential",
    ]);

    // Same discipline as the license: no subject id, ever.
    const subject = vc?.["credentialSubject"] as Record<string, unknown>;
    expect(subject["id"]).toBeUndefined();
    expect(subject["type"]).toEqual(["Person", "UtopiaResident"]);
    expect(subject["givenName"]).toBe("Jamie");
    expect(subject["familyName"]).toBe("Voss");
    // The district name is re-derived from the shared geography, and the
    // twins ride as canonical decimal STRINGS (xsd:unsignedInt via context —
    // the N5 lexical-form decision).
    expect(subject["districtName"]).toBe("Port Azure");
    expect(subject["stateFips"]).toBe("11");
    expect(subject["postalCode"]).toBe("40125");

    // Holder receipt check: blind-signed over THIS wallet's link secret.
    const receivedVc = vc as unknown as VerifiableCredential;
    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: receivedVc,
        holderBinding: {
          linkSecret: LINK_SECRET,
          secretProverBlind: binding.secretProverBlind,
        },
      }),
    ).resolves.toBe(true);
  });

  it("refuses to issue a configuration the token was not minted for (offer↔token binding)", async () => {
    // A resident offer's token must not redeem for a license…
    const resident = await createOffer(RESIDENT_SUBJECT);
    const residentToken = await exchangeForToken(preAuthorizedCode(resident.credential_offer));
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const asLicense = await postJson(
      "/oid4vci/credential",
      await credentialRequestBody(binding, residentToken.c_nonce, CREDENTIAL_CONFIGURATION_ID),
      { authorization: `Bearer ${residentToken.access_token}` },
    );
    const licenseError = await expectOauthError(asLicense, 400, "invalid_credential_request");
    expect(licenseError.error_description).toContain("was issued for");

    // …and a license offer's token must not redeem for a registration.
    const license = await createOffer();
    const licenseToken = await exchangeForToken(preAuthorizedCode(license.credential_offer));
    const asResident = await postJson(
      "/oid4vci/credential",
      await credentialRequestBody(binding, licenseToken.c_nonce, RESIDENT_CREDENTIAL_CONFIGURATION_ID),
      { authorization: `Bearer ${licenseToken.access_token}` },
    );
    const residentError = await expectOauthError(asResident, 400, "invalid_credential_request");
    expect(residentError.error_description).toContain("was issued for");
  });

  it("rejects an access token that binds no configuration (pre-N5 shape, fail closed)", async () => {
    const legacyToken = await mintSignedToken({
      secret: TEST_ENV.TOKEN_SECRET ?? "",
      payload: {
        use: "access",
        ...SUBJECT,
        documentNumber: "UDL-AAAA-2222",
        c_nonce: "legacy-nonce",
      },
      ttlSeconds: 60,
    });
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const res = await postJson(
      "/oid4vci/credential",
      await credentialRequestBody(binding, "legacy-nonce"),
      { authorization: `Bearer ${legacyToken}` },
    );
    await expectOauthError(res, 400, "invalid_credential_request");
  });

  it("rejects a proof over the wrong nonce", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const body = await credentialRequestBody(binding, "not-the-c-nonce");
    const res = await postJson("/oid4vci/credential", body, {
      authorization: `Bearer ${token.access_token}`,
    });
    const error = await expectOauthError(res, 400, "invalid_proof");
    expect(error.error_description).toContain("nonce");
  });

  it("rejects a proof with a tampered signature", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const body = await credentialRequestBody(binding, token.c_nonce);
    const proof = body["proof"] as { proof_type: "jwt"; jwt: string };
    proof.jwt =
      proof.jwt.slice(0, -4) + (proof.jwt.endsWith("AAAA") ? "BBBB" : "AAAA");
    const res = await postJson("/oid4vci/credential", body, {
      authorization: `Bearer ${token.access_token}`,
    });
    await expectOauthError(res, 400, "invalid_proof");
  });
});

describe("revocation registry", () => {
  // Isolated registry so epoch arithmetic is deterministic regardless of
  // what the other suites issued against the shared TEST_ENV instance.
  const env: DmvBindings = { ...TEST_ENV, REGISTRY: memoryRegistryNamespace() };

  interface Issued {
    vc: VerifiableCredential;
    revocationId: string;
    sidecar: NonNullable<CredentialResponse["vgw_revocation"]>;
  }

  async function issueLicense(givenName: string): Promise<Issued> {
    const { credential_offer } = await createOffer({ ...SUBJECT, givenName });
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const binding = createHolderBinding({ linkSecret: LINK_SECRET });
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: {
          proof_type: "jwt",
          jwt: createProofJwt({
            seed: HOLDER_SEED,
            audience: TEST_ISSUER_ORIGIN,
            nonce: token.c_nonce,
            commitmentDigest: await commitmentDigest(binding.commitmentWithProof),
          }),
        },
        vgw_holder_commitment: toBase64Url(binding.commitmentWithProof),
      },
      { authorization: `Bearer ${token.access_token}` },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CredentialResponse;
    const vc = body.credentials[0]?.credential as unknown as VerifiableCredential;
    const sidecar = body.vgw_revocation;
    if (sidecar === undefined) throw new Error("expected a vgw_revocation sidecar");
    const status = credentialRevocationStatus(vc);
    if (status === undefined) throw new Error("expected a credentialStatus");
    return { vc, revocationId: status.revocationId, sidecar };
  }

  async function registryState(): Promise<RevocationRegistryState> {
    const res = await app.request("/api/registry", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    return parseRevocationRegistryState(await res.json());
  }

  let alice: Issued;
  let bob: Issued;

  it("issues revocable credentials: hidden-id status + a witness sidecar that verifies", async () => {
    alice = await issueLicense("Alice");
    bob = await issueLicense("Bob");

    // The credential names the registry and carries the id lexical; the
    // sidecar echoes the registry state the witness was issued against.
    expect(credentialRevocationStatus(alice.vc)?.registry).toBe(
      `${TEST_ISSUER_ORIGIN}/api/registry`,
    );
    expect(alice.sidecar.registry).toBe(`${TEST_ISSUER_ORIGIN}/api/registry`);
    expect(alice.sidecar.epoch).toBe(0);
    expect(alice.revocationId).not.toBe(bob.revocationId);

    for (const issued of [alice, bob]) {
      expect(
        verifyRevocationWitness({
          params: issued.sidecar.params,
          accumulator: issued.sidecar.accumulator,
          revocationId: issued.revocationId,
          witness: issued.sidecar.witness,
        }),
      ).toBe(true);
    }
  }, 60_000);

  it("serves the public state document and advertises it in issuer metadata", async () => {
    const state = await registryState();
    expect(state.epoch).toBe(0);
    expect(state.updates).toEqual([]);
    expect(state.params).toBe(alice.sidecar.params);
    expect(state.accumulator).toBe(alice.sidecar.accumulator);

    const res = await app.request("/.well-known/openid-credential-issuer", {}, env);
    const metadata = (await res.json()) as IssuerMetadata;
    expect(metadata.vgw_revocation_registry).toBe(`${TEST_ISSUER_ORIGIN}/api/registry`);
  });

  it("lists issued credentials for the admin page", async () => {
    const res = await app.request("/api/registry/credentials", {}, env);
    expect(res.status).toBe(200);
    const { credentials } = (await res.json()) as { credentials: RegistryCredentialRow[] };
    expect(credentials).toHaveLength(2);
    expect(credentials.map((row) => row.kind)).toEqual(["license", "license"]);
    expect(credentials.every((row) => row.revokedAtEpoch === undefined)).toBe(true);
    expect(credentials.some((row) => row.label.startsWith("Alice"))).toBe(true);
  });

  it("revokes Bob: epoch bumps, Alice's refreshed witness survives, Bob's is terminal", async () => {
    const res = await postJson(
      "/api/registry/revoke",
      { revocationIds: [bob.revocationId] },
      {},
      env,
    );
    expect(res.status).toBe(200);
    const applied = (await res.json()) as { epoch: number };
    expect(applied.epoch).toBe(1);

    const state = await registryState();
    expect(state.epoch).toBe(1);
    expect(state.updates).toHaveLength(1);
    expect(state.accumulator).not.toBe(alice.sidecar.accumulator);

    // Alice syncs from PUBLISHED data only and keeps verifying.
    const refreshed = refreshRevocationWitness({
      revocationId: alice.revocationId,
      witness: alice.sidecar.witness,
      epoch: 0,
      state,
    });
    if (refreshed.revoked) throw new Error("Alice must not be revoked");
    expect(refreshed.changed).toBe(true);
    expect(
      verifyRevocationWitness({
        params: state.params,
        accumulator: state.accumulator,
        revocationId: alice.revocationId,
        witness: refreshed.witness,
      }),
    ).toBe(true);

    // Bob's refresh IS the revocation discovery.
    expect(
      refreshRevocationWitness({
        revocationId: bob.revocationId,
        witness: bob.sidecar.witness,
        epoch: 0,
        state,
      }),
    ).toEqual({ revoked: true });

    // The admin list reflects it.
    const listRes = await app.request("/api/registry/credentials", {}, env);
    const { credentials } = (await listRes.json()) as { credentials: RegistryCredentialRow[] };
    const bobRow = credentials.find((row) => row.revocationId === bob.revocationId);
    expect(bobRow?.revokedAtEpoch).toBe(1);
  }, 30_000);

  it("rejects unknown ids and double revocation", async () => {
    const unknown = await postJson("/api/registry/revoke", { revocationIds: ["12345"] }, {}, env);
    const unknownError = await expectOauthError(unknown, 400, "invalid_request");
    expect(unknownError.error_description).toContain("unknown revocation id");

    const again = await postJson(
      "/api/registry/revoke",
      { revocationIds: [bob.revocationId] },
      {},
      env,
    );
    const againError = await expectOauthError(again, 400, "invalid_request");
    expect(againError.error_description).toContain("already revoked at epoch 1");

    const empty = await postJson("/api/registry/revoke", { revocationIds: [] }, {}, env);
    await expectOauthError(empty, 400, "invalid_request");
  });
});

describe("CORS", () => {
  it("answers a credential-endpoint preflight with reflected origin and Authorization", async () => {
    const res = await app.request(
      "/oid4vci/credential",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://verygoodwallet.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      },
      TEST_ENV,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://verygoodwallet.com",
    );
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
  });

  it("reflects the origin on well-known metadata responses", async () => {
    const res = await app.request(
      "/.well-known/openid-credential-issuer",
      { headers: { origin: "http://localhost:5173" } },
      TEST_ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
