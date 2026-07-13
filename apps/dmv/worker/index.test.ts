/**
 * Protocol tests for the DMV issuer Worker, driven through `app.request`
 * with a fixed test env. The worker is WebCrypto + pure JS (no CF-only
 * APIs), so these run in plain Node.
 *
 * The centerpiece is a full end-to-end pass of the pinned M2 contract:
 * offer -> offer-by-reference -> token -> real PoP JWT -> signed VC with a
 * verifiable Poseidon birthdate commitment opening.
 */

import { describe, expect, it } from "vitest";
import { daysSinceEpoch, verifyCommitment } from "@vgw/keys";
import {
  CREDENTIAL_CONFIGURATION_ID,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
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
import app, { type OfferResponseBody } from "./index.js";
import type { DmvBindings } from "./env.js";
import type { OfferCodePayload } from "./tokens.js";

const TEST_ENV: DmvBindings = {
  ISSUER_SEED: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  TOKEN_SECRET: "test-token-secret",
};

/** `app.request` resolves bare paths against http://localhost. */
const TEST_ISSUER_ORIGIN = "http://localhost";

/** Fixed holder key so the expected pairwise did:key is deterministic. */
const HOLDER_SEED = new Uint8Array(32).fill(7);
const HOLDER_DID = ed25519KeyPairFromSeed(HOLDER_SEED).did;

const SUBJECT = {
  givenName: "Jamie",
  familyName: "Voss",
  birthDate: "1996-03-14",
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
    const payload = await readSignedToken<OfferCodePayload>({
      secret: TEST_ENV.TOKEN_SECRET ?? "",
      token: preAuthorizedCode(credential_offer),
    });
    expect(payload.use).toBe("offer");
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
    const payload = await readSignedToken<OfferCodePayload>({
      secret: TEST_ENV.TOKEN_SECRET ?? "",
      token: preAuthorizedCode(credential_offer),
    });
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
  it("issues a bound, commitment-carrying VC end-to-end", async () => {
    const { credential_offer } = await createOffer();
    expect(credential_offer.credential_issuer).toBe(TEST_ISSUER_ORIGIN);

    const token = await exchangeForToken(preAuthorizedCode(credential_offer));

    const jwt = createProofJwt({
      seed: HOLDER_SEED,
      audience: credential_offer.credential_issuer,
      nonce: token.c_nonce,
    });
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: { proof_type: "jwt", jwt },
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CredentialResponse;

    const vc = body.credentials[0]?.credential;
    expect(vc).toBeDefined();
    const proof = vc?.["proof"] as Record<string, unknown>;
    expect(proof["cryptosuite"]).toBe("bbs-2023");
    expect(proof["type"]).toBe("DataIntegrityProof");

    // No subject id, deliberately: bbs-2023 derivation reveals node ids
    // structurally, so an embedded holder DID would correlate every
    // presentation of this credential across verifiers.
    const subject = vc?.["credentialSubject"] as Record<string, unknown>;
    expect(subject["id"]).toBeUndefined();

    const license = subject["driversLicense"] as Record<string, unknown>;
    expect(license["given_name"]).toBe(SUBJECT.givenName);
    expect(license["family_name"]).toBe(SUBJECT.familyName);
    expect(license["birth_date"]).toBe(SUBJECT.birthDate);

    const issuer = vc?.["issuer"] as Record<string, unknown>;
    expect(issuer["name"]).toBe("Utopia DMV");
    expect(String(issuer["id"]).startsWith("did:key:")).toBe(true);

    // The signed commitment and the returned opening must agree — and the
    // opening must actually open the commitment to the birthdate.
    const opening = body.vgw_commitment_opening;
    expect(opening).toBeDefined();
    expect(license["birthDateCommitment"]).toBe(opening?.commitment);
    expect(opening?.value).toBe(daysSinceEpoch(SUBJECT.birthDate));
    expect(
      verifyCommitment(opening?.value ?? -1, opening?.blinding ?? "", opening?.commitment ?? ""),
    ).toBe(true);
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

  it("rejects a proof over the wrong nonce", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const jwt = createProofJwt({
      seed: HOLDER_SEED,
      audience: credential_offer.credential_issuer,
      nonce: "not-the-c-nonce",
    });
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: { proof_type: "jwt", jwt },
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    const body = await expectOauthError(res, 400, "invalid_proof");
    expect(body.error_description).toContain("nonce");
  });

  it("rejects a proof with a tampered signature", async () => {
    const { credential_offer } = await createOffer();
    const token = await exchangeForToken(preAuthorizedCode(credential_offer));
    const jwt = createProofJwt({
      seed: HOLDER_SEED,
      audience: credential_offer.credential_issuer,
      nonce: token.c_nonce,
    });
    const tampered = jwt.slice(0, -4) + (jwt.endsWith("AAAA") ? "BBBB" : "AAAA");
    const res = await postJson(
      "/oid4vci/credential",
      {
        credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
        proof: { proof_type: "jwt", jwt: tampered },
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    await expectOauthError(res, 400, "invalid_proof");
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
