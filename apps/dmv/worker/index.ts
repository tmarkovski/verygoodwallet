/**
 * Utopia DMV issuer Worker — OID4VCI pre-authorized code flow (draft-15
 * style) with zero server-side session state.
 *
 * ```
 * POST /api/offers                            DMV UI creates an offer
 * GET  /.well-known/openid-credential-issuer  issuer metadata
 * GET  /oid4vci/offer/:code                   offer-by-reference fetch
 * POST /oid4vci/token                         pre-authorized code -> access token
 * POST /oid4vci/credential                    key proof -> signed VC + opening
 * ```
 *
 * Statelessness: the pre-authorized code and the access token are HMAC-signed
 * blobs carrying the citizen record (and, for the access token, the
 * `c_nonce`), so any isolate can serve any step of the flow. The issuer origin
 * is derived from each request's URL — never hardcoded — so the same Worker
 * answers correctly on localhost, workers.dev, and the custom domain.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCommitment, daysSinceEpoch, toBase64Url } from "@vgw/keys";
import {
  CREDENTIAL_CONFIGURATION_ID,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  mintSignedToken,
  readSignedToken,
  verifyProofJwt,
  walletOfferLink,
  type CredentialOffer,
  type CredentialRequest,
  type CredentialResponse,
  type IssuerMetadata,
  type Oid4vciErrorResponse,
  type TokenResponse,
} from "@vgw/protocols";
import {
  CREDENTIALS_V2_CONTEXT_URL,
  VDL_V1_CONTEXT_URL,
  VDL_AAMVA_V1_CONTEXT_URL,
  VGW_CONTEXT_URL,
  buildUtopiaDriversLicense,
  signCredential,
} from "@vgw/vc-kit";
import { getIssuerKeyPair, resolveTokenSecret, type DmvBindings } from "./env.js";
import { OfferValidationError, parseOfferInput, type OfferInput } from "./offers.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  PRE_AUTHORIZED_CODE_TTL_SECONDS,
  type AccessTokenPayload,
  type OfferCodePayload,
} from "./tokens.js";

// Not exported: workerd requires every named export of the Worker entry
// module to be a handler or function — a string export fails script startup.
const ISSUER_DISPLAY_NAME = "Utopia DMV";

/** What `POST /api/offers` returns to the DMV UI. */
export interface OfferResponseBody {
  credential_offer: CredentialOffer;
  credential_offer_uri: string;
  /** Omitted when no wallet origin is configured (see {@link resolveWalletOrigin}). */
  wallet_link?: string;
}

/** Loopback origins only — a production issuer must not reflect arbitrary Origins into links. */
function isLocalhostOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

let warnedWalletOrigin = false;

/**
 * Which wallet the server-built `wallet_link` targets: the WALLET_ORIGIN var
 * when set, else a localhost caller's own origin (dev heuristic), else
 * nothing — the link is omitted from the response. The UI usually rebuilds
 * the link client-side from `credential_offer_uri` (supporting its `?wallet=`
 * override), so this is a fallback for API-only consumers.
 *
 * There is deliberately no production default: until the M6 cutover the apex
 * domain serves the legacy GitHub Pages app, which has no /offer route, so a
 * guessed origin would dead-end issuance AND deliver the PII-bearing code to
 * the wrong host. No link is strictly better than a wrong link.
 */
function resolveWalletOrigin(
  env: DmvBindings,
  requestOrigin: string | undefined,
): string | undefined {
  if (env.WALLET_ORIGIN !== undefined && env.WALLET_ORIGIN !== "") {
    // Normalize the same way the UI's ?wallet= param is normalized — a
    // trailing slash or stray path would otherwise yield //offer links the
    // wallet's router silently redirects away from. A value that doesn't
    // parse throws instead of falling back, same policy as a malformed
    // ISSUER_SEED: failing beats silently minting broken links.
    try {
      return new URL(env.WALLET_ORIGIN).origin;
    } catch {
      throw new Error(
        `WALLET_ORIGIN must be an absolute origin (e.g. https://wallet.example), got: ${env.WALLET_ORIGIN}`,
      );
    }
  }
  if (requestOrigin !== undefined && isLocalhostOrigin(requestOrigin)) {
    return requestOrigin;
  }
  if (!warnedWalletOrigin) {
    warnedWalletOrigin = true;
    console.warn(
      "vgw-dmv: WALLET_ORIGIN is not set — omitting wallet_link from offers. Set the Worker var (see DEPLOY.md) so issued offers can point at a wallet.",
    );
  }
  return undefined;
}

/** Coerce a form/JSON body field to a string parameter (forms may yield Files/arrays). */
function stringParam(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  return typeof value === "string" ? value : undefined;
}

export function createApp(): Hono<{ Bindings: DmvBindings }> {
  const app = new Hono<{ Bindings: DmvBindings }>();

  const oauthError = (
    status: 400 | 401 | 404,
    error: string,
    description: string,
  ): [Oid4vciErrorResponse, 400 | 401 | 404] => [
    { error, error_description: description },
    status,
  ];

  // The protocol endpoints are public (no cookies, Bearer-only auth), so any
  // web origin — the wallet included — may call them: reflect the Origin.
  // /api/offers is meant for the same-origin DMV UI, but reflecting there too
  // is harmless for the same reason and keeps the middleware uniform.
  const publicCors = cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
  });
  app.use("/.well-known/*", publicCors);
  app.use("/oid4vci/*", publicCors);
  app.use("/api/*", publicCors);

  app.get("/.well-known/openid-credential-issuer", (c) => {
    const origin = new URL(c.req.url).origin;
    const metadata: IssuerMetadata = {
      credential_issuer: origin,
      credential_endpoint: `${origin}/oid4vci/credential`,
      token_endpoint: `${origin}/oid4vci/token`,
      display: [{ name: ISSUER_DISPLAY_NAME, locale: "en-US" }],
      credential_configurations_supported: {
        [CREDENTIAL_CONFIGURATION_ID]: {
          format: "ldp_vc",
          credential_definition: {
            "@context": [
              CREDENTIALS_V2_CONTEXT_URL,
              VDL_V1_CONTEXT_URL,
              VDL_AAMVA_V1_CONTEXT_URL,
              VGW_CONTEXT_URL,
            ],
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
    return c.json(metadata);
  });

  app.post("/api/offers", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(...oauthError(400, "invalid_request", "request body must be JSON"));
    }
    let input: OfferInput;
    try {
      input = parseOfferInput(body);
    } catch (error) {
      if (error instanceof OfferValidationError) {
        return c.json(...oauthError(400, "invalid_request", error.message));
      }
      throw error;
    }

    const code = await mintSignedToken({
      secret: resolveTokenSecret(c.env),
      payload: { use: "offer", ...input } satisfies OfferCodePayload,
      ttlSeconds: PRE_AUTHORIZED_CODE_TTL_SECONDS,
    });

    const origin = new URL(c.req.url).origin;
    const credentialOffer: CredentialOffer = {
      credential_issuer: origin,
      credential_configuration_ids: [CREDENTIAL_CONFIGURATION_ID],
      grants: {
        [PRE_AUTHORIZED_CODE_GRANT_TYPE]: { "pre-authorized_code": code },
      },
    };
    // Signed tokens are base64url + "." — safe as a raw path segment.
    const credentialOfferUri = `${origin}/oid4vci/offer/${code}`;
    const walletOrigin = resolveWalletOrigin(c.env, c.req.header("origin"));
    const response: OfferResponseBody = {
      credential_offer: credentialOffer,
      credential_offer_uri: credentialOfferUri,
      ...(walletOrigin !== undefined
        ? { wallet_link: walletOfferLink(walletOrigin, credentialOfferUri) }
        : {}),
    };
    return c.json(response);
  });

  app.get("/oid4vci/offer/:code", async (c) => {
    const code = c.req.param("code");
    // The offer is reconstructed from the code itself (nothing is stored), so
    // a bad code identifies nothing: verify before serving, 404 otherwise.
    try {
      const payload = await readSignedToken<OfferCodePayload>({
        secret: resolveTokenSecret(c.env),
        token: code,
      });
      if (payload.use !== "offer") {
        throw new Error("not a pre-authorized code");
      }
    } catch {
      return c.json(
        ...oauthError(404, "invalid_request", "unknown or expired credential offer"),
      );
    }
    const origin = new URL(c.req.url).origin;
    const offer: CredentialOffer = {
      credential_issuer: origin,
      credential_configuration_ids: [CREDENTIAL_CONFIGURATION_ID],
      grants: {
        [PRE_AUTHORIZED_CODE_GRANT_TYPE]: { "pre-authorized_code": code },
      },
    };
    return c.json(offer);
  });

  app.post("/oid4vci/token", async (c) => {
    // OAuth wants application/x-www-form-urlencoded; JSON is accepted as a
    // convenience for fetch-based wallets.
    let params: Record<string, unknown>;
    try {
      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const parsed: unknown = await c.req.json();
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("JSON body must be an object");
        }
        params = parsed as Record<string, unknown>;
      } else {
        params = await c.req.parseBody();
      }
    } catch {
      return c.json(
        ...oauthError(
          400,
          "invalid_request",
          "expected an application/x-www-form-urlencoded or JSON body",
        ),
      );
    }

    const grantType = stringParam(params, "grant_type");
    if (grantType === undefined) {
      return c.json(...oauthError(400, "invalid_request", "missing grant_type"));
    }
    if (grantType !== PRE_AUTHORIZED_CODE_GRANT_TYPE) {
      return c.json(
        ...oauthError(
          400,
          "unsupported_grant_type",
          `grant_type must be ${PRE_AUTHORIZED_CODE_GRANT_TYPE}`,
        ),
      );
    }
    const code = stringParam(params, "pre-authorized_code");
    if (code === undefined || code === "") {
      return c.json(...oauthError(400, "invalid_request", "missing pre-authorized_code"));
    }

    const secret = resolveTokenSecret(c.env);
    let offer: OfferCodePayload;
    try {
      offer = await readSignedToken<OfferCodePayload>({ secret, token: code });
    } catch {
      return c.json(
        ...oauthError(
          400,
          "invalid_grant",
          "pre-authorized_code is invalid or expired",
        ),
      );
    }
    if (offer.use !== "offer") {
      return c.json(
        ...oauthError(400, "invalid_grant", "token is not a pre-authorized code"),
      );
    }

    // Fresh c_nonce, embedded INSIDE the signed access token: the credential
    // endpoint recovers it from the Bearer token — no nonce store.
    const cNonce = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const accessToken = await mintSignedToken({
      secret,
      payload: {
        use: "access",
        givenName: offer.givenName,
        familyName: offer.familyName,
        birthDate: offer.birthDate,
        documentNumber: offer.documentNumber,
        c_nonce: cNonce,
      } satisfies AccessTokenPayload,
      ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    });

    const response: TokenResponse = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      c_nonce: cNonce,
      c_nonce_expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
    return c.json(response);
  });

  app.post("/oid4vci/credential", async (c) => {
    const authorization = c.req.header("authorization");
    const bearer =
      authorization?.startsWith("Bearer ") === true
        ? authorization.slice("Bearer ".length)
        : undefined;
    if (bearer === undefined || bearer === "") {
      return c.json(...oauthError(401, "invalid_token", "missing Bearer access token"));
    }
    let access: AccessTokenPayload;
    try {
      access = await readSignedToken<AccessTokenPayload>({
        secret: resolveTokenSecret(c.env),
        token: bearer,
      });
    } catch {
      return c.json(
        ...oauthError(401, "invalid_token", "access token is invalid or expired"),
      );
    }
    if (access.use !== "access" || typeof access.c_nonce !== "string") {
      return c.json(...oauthError(401, "invalid_token", "token is not an access token"));
    }

    let request: CredentialRequest;
    try {
      const parsed: unknown = await c.req.json();
      // JSON.parse("null") returns null without throwing — guard the shape
      // (same as the token endpoint) so a null/array body gets a clean 400
      // instead of a TypeError on the property access below.
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("body must be a JSON object");
      }
      request = parsed as CredentialRequest;
    } catch {
      return c.json(
        ...oauthError(
          400,
          "invalid_credential_request",
          "request body must be a JSON object",
        ),
      );
    }
    if (request.credential_configuration_id !== CREDENTIAL_CONFIGURATION_ID) {
      return c.json(
        ...oauthError(
          400,
          "unsupported_credential_type",
          `only ${CREDENTIAL_CONFIGURATION_ID} is supported`,
        ),
      );
    }
    if (request.proof?.proof_type !== "jwt" || typeof request.proof.jwt !== "string") {
      return c.json(
        ...oauthError(
          400,
          "invalid_proof",
          "expected proof: { proof_type: 'jwt', jwt: <compact JWS> }",
        ),
      );
    }

    // The proof must be addressed to THIS issuer (aud = our origin) and echo
    // the c_nonce carried in the verified access token.
    const origin = new URL(c.req.url).origin;
    let holderDid: string;
    try {
      ({ holderDid } = verifyProofJwt({
        jwt: request.proof.jwt,
        audience: origin,
        nonce: access.c_nonce,
      }));
    } catch (error) {
      return c.json(
        ...oauthError(
          400,
          "invalid_proof",
          error instanceof Error ? error.message : "proof verification failed",
        ),
      );
    }

    // Commit to the birthdate; the opening goes back to the wallet in the
    // response (vgw_commitment_opening) — the issuer knows the birthdate
    // anyway, so this costs no privacy. Blind issuance is future work.
    const birthDays = daysSinceEpoch(access.birthDate);
    const opening = createCommitment(birthDays);

    const keyPair = await getIssuerKeyPair(c.env);
    const unsigned = buildUtopiaDriversLicense({
      subjectId: holderDid,
      givenName: access.givenName,
      familyName: access.familyName,
      birthDate: access.birthDate,
      documentNumber: access.documentNumber,
      birthDateCommitment: opening.commitment,
      issuer: { id: keyPair.controller, name: ISSUER_DISPLAY_NAME },
    });
    const signed = await signCredential({ credential: unsigned, keyPair });

    const response: CredentialResponse = {
      credentials: [{ credential: signed }],
      vgw_commitment_opening: {
        value: birthDays,
        blinding: opening.blinding,
        commitment: opening.commitment,
      },
    };
    return c.json(response);
  });

  return app;
}

const app = createApp();

export default app;
