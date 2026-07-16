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
  summarizeCredkitPresentation,
  verifyCredkitPresentation,
  type ExpectedRangeClaim,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import {
  resolveTokenSecret,
  trustedIssuerDid,
  type ShopBindings,
} from "./env.js";
import {
  AGE_QUERY_ID,
  buildAgeDcqlQuery,
  evaluateAgePolicy,
  evaluateAgePredicatePolicy,
  type OfferedRangeClaim,
} from "./policy.js";
import { CREDKIT_PARAMS_PATH, getRangeParams } from "./params.js";
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

/**
 * Payload inside the HMAC-signed OID4VP `state` value. The token is the
 * verifier's memory (MIGRATION Appendix D.2): `predicates` restates, at
 * response time, exactly the range claims THIS session offered — bound
 * pinned at request time, never re-derived, never read from the wire.
 */
interface StateTokenPayload extends Record<string, unknown> {
  use: "vp-session";
  sessionId: string;
  nonce: string;
  predicates: OfferedRangeClaim[];
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

  // The wallet calls /oid4vp/response cross-origin and fetches the params
  // document cross-origin from the browser; /api/* is for the shop UI but
  // reflecting there too is harmless (no cookies, no ambient auth).
  const publicCors = cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  });
  app.use("/oid4vp/*", publicCors);
  app.use("/api/*", publicCors);
  app.use(CREDKIT_PARAMS_PATH, publicCors);

  // The published proof alphabet (MIGRATION §8, D.3): one public artifact,
  // fetched by every prover — a per-prover alphabet would be a tracking tag.
  // Deterministically minted from the seed, so caching is purely a bandwidth
  // courtesy; modest max-age keeps a seed rotation honest within an hour.
  app.get(CREDKIT_PARAMS_PATH, async (c) => {
    const { document } = await getRangeParams(c.env);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(document);
  });

  app.post("/api/verification", async (c) => {
    const origin = new URL(c.req.url).origin;
    const sessionId = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(12)));
    const nonce = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));

    // Per-request query: the predicate bound is "18+ as of NOW", pinned into
    // the signed state token so the response endpoint restates exactly what
    // this session offered (Appendix D.2).
    const { hash } = await getRangeParams(c.env);
    const { query, offeredRangeClaims } = buildAgeDcqlQuery({
      origin,
      now: new Date(),
      paramsHash: hash,
    });
    const state = await mintSignedToken({
      secret: resolveTokenSecret(c.env),
      payload: {
        use: "vp-session",
        sessionId,
        nonce,
        predicates: offeredRangeClaims,
      } satisfies StateTokenPayload,
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
      dcql_query: query,
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
      if (!Array.isArray(session.predicates)) throw new Error("token carries no offer memory");
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

    // 4. Route-select, then verify — the whole check runs on this Worker
    // (MIGRATION §8: credkit's verifier is pure JS, no WASM, no zk_pending).
    // The DCQL query offered ALTERNATIVES (flag / dob / predicate), so peek
    // at the envelope's claim COUNTS — counts only, no trust decisions — and
    // restate the matching verifier-authored expectation set (Appendix D.2):
    // the predicate route rebuilds bounds from the SIGNED TOKEN plus this
    // isolate's own params; the disclosure route expects no claims; any
    // other shape was never offered and fails.
    const origin = new URL(c.req.url).origin;
    const domain = `${REDIRECT_URI_CLIENT_ID_PREFIX}${origin}/oid4vp/response`;

    const judge = async (): Promise<
      Pick<SessionOutcome, "status" | "verdict" | "reason" | "disclosed" | "predicate">
    > => {
      let summary;
      try {
        summary = summarizeCredkitPresentation(presentation as VerifiablePresentation);
      } catch (error) {
        return {
          status: "failed",
          reason: `The presentation is not a credkit presentation envelope: ${
            error instanceof Error ? error.message : String(error)
          }`,
          disclosed: {},
        };
      }

      const offered = session.predicates;
      const predicateRoute =
        offered.length > 0 &&
        summary.rangeClaims === offered.length &&
        summary.membershipClaims === 0 &&
        summary.equalities === 0;
      const disclosureRoute =
        summary.rangeClaims === 0 && summary.membershipClaims === 0 && summary.equalities === 0;
      if (!predicateRoute && !disclosureRoute) {
        return {
          status: "failed",
          reason:
            `The presentation carries ${summary.rangeClaims} range, ${summary.membershipClaims} ` +
            `membership, and ${summary.equalities} equality claims — not a shape this session offered.`,
          disclosed: {},
        };
      }

      // Predicate expectations come from the signed token (the bound this
      // session offered) + this isolate's own params object. If the params
      // seed rotated since the request, the wire's paramsHash no longer
      // matches — credkit fails that closed, which is the intended outcome
      // for in-flight sessions across a rotation.
      const { params } = await getRangeParams(c.env);
      const expectedRangeClaims: ExpectedRangeClaim[] = predicateRoute
        ? offered.map((claim) => ({
            statement: 0,
            pointer: claim.pointer,
            kind: claim.kind,
            bound: BigInt(claim.bound),
            digits: claim.digits,
            params,
          }))
        : [];

      const result = await verifyCredkitPresentation({
        verifiablePresentation: presentation as VerifiablePresentation,
        expectedIssuerDids: [expectedIssuer],
        challenge: session.nonce,
        domain,
        expectedRangeClaims,
      });
      if (!result.verified || result.documents === undefined) {
        return {
          status: "failed",
          reason: result.error ?? "presentation verification failed",
          disclosed: {},
        };
      }
      return predicateRoute
        ? evaluateAgePredicatePolicy(result.documents, offered)
        : evaluateAgePolicy(result.documents);
    };

    const outcome: SessionOutcome = {
      ...(await judge()),
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
