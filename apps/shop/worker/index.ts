/**
 * The Nightcap verifier Worker — OID4VP with DCQL and `direct_post`.
 *
 * ```
 * POST /api/verification        shop UI starts an age-verification session
 * GET  /api/verification/:id    shop UI polls the session outcome
 * POST /oid4vp/response         wallet direct_posts the vp_token
 * ```
 *
 * State model: the *request* side is stateless — the OID4VP `state` value is
 * an HMAC-signed blob carrying the session id and nonce, so any isolate can
 * validate a response with no lookup. Only the *outcome* is stored (in a
 * per-session Durable Object) because the poller and the wallet are usually
 * different devices. The shop origin is derived from each request's URL —
 * never hardcoded — matching the DMV Worker's convention.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { toBase64Url } from "@vgw/keys";
import {
  REDIRECT_URI_CLIENT_ID_PREFIX,
  mintSignedToken,
  readSignedToken,
  walletPresentLink,
  type DirectPostResult,
  type OauthErrorResponse,
  type PresentationRequest,
} from "@vgw/protocols";
import {
  verifyPresentation,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import {
  resolveTokenSecret,
  trustedIssuerDid,
  type ShopBindings,
} from "./env.js";
import {
  AGE_DCQL_QUERY,
  AGE_QUERY_ID,
  evaluateAgePolicy,
  evaluateZkAgePolicy,
} from "./policy.js";
import type { SessionOutcome, SessionStatus } from "./sessions.js";

export { VerificationSessions } from "./sessions.js";

const VERIFIER_DISPLAY_NAME = "The Nightcap";

/** How long a started session may be answered (state token TTL). */
const SESSION_TTL_SECONDS = 600;

/** What `POST /api/verification` returns to the shop UI. */
export interface VerificationSessionBody {
  session_id: string;
  /** Poll here for the outcome. */
  status_url: string;
  /** The authorization request the wallet link carries (inspector exhibit). */
  request: PresentationRequest;
  /** Omitted when no wallet origin is configured. */
  wallet_link?: string;
}

/** Payload inside the HMAC-signed OID4VP `state` value. */
interface StateTokenPayload extends Record<string, unknown> {
  use: "vp-session";
  sessionId: string;
  nonce: string;
}

/** Loopback origins only — a production verifier must not reflect arbitrary Origins into links. */
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
 * Which wallet the server-built `wallet_link` targets — same policy as the
 * DMV Worker: the WALLET_ORIGIN var when set, else a localhost caller's own
 * origin (dev heuristic), else nothing. No production default: a guessed
 * origin would dead-end the presentation on a host with no /present route.
 */
function resolveWalletOrigin(
  env: ShopBindings,
  requestOrigin: string | undefined,
): string | undefined {
  if (env.WALLET_ORIGIN !== undefined && env.WALLET_ORIGIN !== "") {
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
      "vgw-shop: WALLET_ORIGIN is not set — omitting wallet_link from sessions. Set the Worker var (see DEPLOY.md).",
    );
  }
  return undefined;
}

/** Coerce a form/JSON body field to a string parameter (forms may yield Files/arrays). */
function stringParam(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  return typeof value === "string" ? value : undefined;
}

function sessionStatusUrl(origin: string, sessionId: string): string {
  return `${origin}/api/verification/${encodeURIComponent(sessionId)}`;
}

export function createApp(): Hono<{ Bindings: ShopBindings }> {
  const app = new Hono<{ Bindings: ShopBindings }>();

  const oauthError = (
    status: 400 | 404 | 500,
    error: string,
    description: string,
  ): [OauthErrorResponse, 400 | 404 | 500] => [
    { error, error_description: description },
    status,
  ];

  // The wallet calls /oid4vp/response cross-origin; /api/* is for the shop
  // UI but reflecting there too is harmless (no cookies, no ambient auth).
  const publicCors = cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  });
  app.use("/oid4vp/*", publicCors);
  app.use("/api/*", publicCors);

  app.post("/api/verification", async (c) => {
    const origin = new URL(c.req.url).origin;
    const sessionId = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(12)));
    const nonce = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const state = await mintSignedToken({
      secret: resolveTokenSecret(c.env),
      payload: { use: "vp-session", sessionId, nonce } satisfies StateTokenPayload,
      ttlSeconds: SESSION_TTL_SECONDS,
    });

    const responseUri = `${origin}/oid4vp/response`;
    const request: PresentationRequest = {
      response_type: "vp_token",
      response_mode: "direct_post",
      client_id: `${REDIRECT_URI_CLIENT_ID_PREFIX}${responseUri}`,
      response_uri: responseUri,
      nonce,
      state,
      dcql_query: AGE_DCQL_QUERY,
      client_metadata: { client_name: VERIFIER_DISPLAY_NAME },
    };

    const walletOrigin = resolveWalletOrigin(c.env, c.req.header("origin"));
    const body: VerificationSessionBody = {
      session_id: sessionId,
      status_url: sessionStatusUrl(origin, sessionId),
      request,
      ...(walletOrigin !== undefined
        ? { wallet_link: walletPresentLink(walletOrigin, request) }
        : {}),
    };
    return c.json(body);
  });

  app.get("/api/verification/:id", async (c) => {
    const sessionId = c.req.param("id");
    const stub = c.env.SESSIONS.get(c.env.SESSIONS.idFromName(sessionId));
    const response = await stub.fetch("https://sessions/status");
    const status = (await response.json()) as SessionStatus;
    return c.json(status);
  });

  app.post("/oid4vp/response", async (c) => {
    // OID4VP direct_post is application/x-www-form-urlencoded; JSON is
    // accepted as a convenience for fetch-based wallets (same tolerance as
    // the DMV token endpoint).
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

    // 1. The state token identifies (and authenticates) the session; without
    // a valid one there is nothing to record an outcome against.
    const state = stringParam(params, "state");
    if (state === undefined || state === "") {
      return c.json(...oauthError(400, "invalid_request", "missing state"));
    }
    let session: StateTokenPayload;
    try {
      session = await readSignedToken<StateTokenPayload>({
        secret: resolveTokenSecret(c.env),
        token: state,
      });
      if (session.use !== "vp-session") throw new Error("not a vp-session token");
    } catch {
      return c.json(
        ...oauthError(400, "invalid_request", "state is invalid or expired"),
      );
    }

    // 2. Extract the presentation for our single credential query.
    const rawVpToken = stringParam(params, "vp_token");
    if (rawVpToken === undefined || rawVpToken === "") {
      return c.json(...oauthError(400, "invalid_request", "missing vp_token"));
    }
    let vpToken: unknown;
    try {
      vpToken = JSON.parse(rawVpToken);
    } catch {
      return c.json(...oauthError(400, "invalid_request", "vp_token is not valid JSON"));
    }
    const presentations =
      typeof vpToken === "object" && vpToken !== null && !Array.isArray(vpToken)
        ? (vpToken as Record<string, unknown>)[AGE_QUERY_ID]
        : undefined;
    const presentation = Array.isArray(presentations) ? presentations[0] : undefined;
    if (typeof presentation !== "object" || presentation === null) {
      return c.json(
        ...oauthError(
          400,
          "invalid_request",
          `vp_token carries no presentation for credential query "${AGE_QUERY_ID}"`,
        ),
      );
    }

    // 3. The trusted issuer: pinned or discovered from the DMV. Without it
    // verification cannot proceed — fail the request, not the session, so a
    // transient discovery error doesn't burn the user's attempt.
    let expectedIssuer: string;
    try {
      expectedIssuer = await trustedIssuerDid(c.env);
    } catch (error) {
      return c.json(
        ...oauthError(
          500,
          "server_error",
          error instanceof Error ? error.message : "trusted issuer discovery failed",
        ),
      );
    }

    // 4. Verify: VP wrapper (challenge = session nonce, domain = this
    // endpoint's client_id) and every embedded credential against the
    // trusted issuer. Then judge the disclosed claims.
    const origin = new URL(c.req.url).origin;
    const domain = `${REDIRECT_URI_CLIENT_ID_PREFIX}${origin}/oid4vp/response`;
    const result = await verifyPresentation({
      presentation: presentation as VerifiablePresentation,
      challenge: session.nonce,
      domain,
      expectedIssuer,
    });

    // A zkAgeProof on the presentation selects the tier-2 policy path. The
    // property is signature-covered (a VGW JSON-literal term), so after
    // verifyPresentation succeeded it is exactly what the wallet signed.
    const zkAgeProof = (presentation as VerifiablePresentation)["zkAgeProof"];
    const verifiedCredentials = () => result.credentials.map((r) => r.credential);
    const outcome: SessionOutcome = result.verified
      ? {
          ...(zkAgeProof !== undefined
            ? evaluateZkAgePolicy(verifiedCredentials(), zkAgeProof)
            : evaluateAgePolicy(verifiedCredentials())),
          vpToken,
          completedAt: Date.now(),
        }
      : {
          status: "failed",
          reason: result.error ?? "presentation verification failed",
          disclosed: {},
          vpToken,
          completedAt: Date.now(),
        };

    // 5. Record write-once; a second post for the same session is a replay.
    const stub = c.env.SESSIONS.get(c.env.SESSIONS.idFromName(session.sessionId));
    const stored = await stub.fetch("https://sessions/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(outcome),
    });
    if (stored.status === 409) {
      return c.json(
        ...oauthError(400, "invalid_request", "this session already received a response"),
      );
    }

    if (outcome.status === "failed") {
      return c.json(...oauthError(400, "invalid_request", outcome.reason));
    }
    const body: DirectPostResult = {
      redirect_uri: `${origin}/?session=${encodeURIComponent(session.sessionId)}`,
    };
    return c.json(body);
  });

  return app;
}

const app = createApp();

export default app;
