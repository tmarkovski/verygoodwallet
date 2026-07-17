/**
 * Utopia Wheels verifier Worker — OID4VP with DCQL and `direct_post`.
 *
 * ```
 * POST /api/verification        rentals UI starts a verification session
 *                               (body {flow}: "standard" driver check, or
 *                                the "resident-rate" composite — N5b)
 * GET  /api/verification/:id    rentals UI polls the session outcome
 * GET  /oid4vp/request/:id      wallet fetches the request by reference
 * POST /oid4vp/response         wallet direct_posts the vp_token
 * ```
 *
 * Same architecture as the shop Worker (the two verifiers deliberately do
 * not share server code — they are independent parties in the story):
 * response *validation* is stateless — the OID4VP `state` value is an
 * HMAC-signed blob carrying the session id and nonce, so any isolate can
 * validate a response with no lookup. The per-session Durable Object holds
 * the *outcome* (the poller and the wallet are usually different devices)
 * and the *authorization request*, so the wallet link can pass it by
 * reference — the QR carries a short `request_uri` instead of a by-value
 * query string too dense to scan (the composite request especially). The
 * rentals origin is derived from each request's URL — never hardcoded.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { toBase64Url } from "@vgw/keys";
import {
  REDIRECT_URI_CLIENT_ID_PREFIX,
  mintSignedToken,
  readSignedToken,
  walletPresentLinkByReference,
  type DirectPostResult,
  type OauthErrorResponse,
  type PresentationRequest,
} from "@vgw/protocols";
import {
  summarizeCredkitPresentation,
  verifyCredkitPresentation,
  type ExpectedMembershipClaim,
  type ExpectedRangeClaim,
  type GraphEquality,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import {
  resolveTokenSecret,
  trustedIssuerDid,
  type RentalsBindings,
} from "./env.js";
import {
  RENTAL_QUERY_ID,
  RESIDENT_RATE_DL_QUERY_ID,
  buildRentalDcqlQuery,
  buildResidentRateDcqlQuery,
  evaluateRentalPolicy,
  evaluateRentalPredicatePolicy,
  evaluateResidentRatePolicy,
  type OfferedClaims,
} from "./policy.js";
import { COASTAL_SET_ID, CREDKIT_PARAMS_PATH, getVerifierParams } from "./params.js";
import type { SessionOutcome, SessionStatus } from "./sessions.js";

export { VerificationSessions } from "./sessions.js";

const VERIFIER_DISPLAY_NAME = "Utopia Wheels";

/** How long a started session may be answered (state token TTL). */
const SESSION_TTL_SECONDS = 600;

/** The two verification flows this counter runs. */
export type VerificationFlow = "standard" | "resident-rate";

/** What `POST /api/verification` returns to the rentals UI. */
export interface VerificationSessionBody {
  session_id: string;
  /** Poll here for the outcome. */
  status_url: string;
  /** The full authorization request (inspector exhibit; DC API input). */
  request: PresentationRequest;
  /** Where the wallet fetches that request — what the wallet link carries. */
  request_uri: string;
  /** Omitted when no wallet origin is configured. */
  wallet_link?: string;
}

/**
 * Payload inside the HMAC-signed OID4VP `state` value. The token is the
 * verifier's memory (MIGRATION Appendix D.2, generalized at N5b per D.5.6):
 * `offer` restates, at response time, exactly the statement-indexed range
 * claims, membership claims, and link-secret equalities THIS session
 * offered — bounds pinned at request time, never re-derived, never read
 * from the wire. The shape replaced the pre-N5b `predicates` array; a
 * legacy token fails the {@link assertOfferedClaims} gate closed (same
 * semantics as a params-seed rotation: in-flight sessions die).
 */
interface StateTokenPayload extends Record<string, unknown> {
  use: "vp-session";
  sessionId: string;
  nonce: string;
  flow: VerificationFlow;
  offer: OfferedClaims;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fail-closed shape gate for the token's offer memory: whatever a decoded
 * (authentic) token carries must be exactly the D.5.6 shape this build
 * writes — anything else (a pre-N5b `predicates` token, a future field
 * rename) is treated as an invalid state rather than half-parsed.
 */
function assertOfferedClaims(value: unknown): OfferedClaims {
  if (!isRecord(value)) throw new Error("offer memory is not an object");
  const statements = value["statements"];
  if (typeof statements !== "number" || !Number.isInteger(statements) || statements < 1) {
    throw new Error("offer memory has no statement count");
  }
  const inRange = (statement: unknown): statement is number =>
    typeof statement === "number" && Number.isInteger(statement) && statement >= 0 && statement < statements;
  const range = value["range"];
  if (!Array.isArray(range)) throw new Error("offer memory has no range list");
  for (const claim of range) {
    if (
      !isRecord(claim) ||
      !inRange(claim["statement"]) ||
      typeof claim["pointer"] !== "string" ||
      (claim["kind"] !== "greaterOrEqual" && claim["kind"] !== "lessOrEqual") ||
      typeof claim["bound"] !== "string" ||
      !/^\d+$/.test(claim["bound"]) ||
      typeof claim["digits"] !== "number"
    ) {
      throw new Error("offer memory carries a malformed range claim");
    }
  }
  const membership = value["membership"];
  if (!Array.isArray(membership)) throw new Error("offer memory has no membership list");
  for (const claim of membership) {
    if (
      !isRecord(claim) ||
      !inRange(claim["statement"]) ||
      typeof claim["pointer"] !== "string" ||
      typeof claim["set_id"] !== "string" ||
      claim["set_id"] === ""
    ) {
      throw new Error("offer memory carries a malformed membership claim");
    }
  }
  const equalities = value["equalities"];
  if (!Array.isArray(equalities)) throw new Error("offer memory has no equalities list");
  for (const group of equalities) {
    if (!Array.isArray(group) || group.length < 2 || !group.every(inRange)) {
      throw new Error("offer memory carries a malformed equality group");
    }
  }
  return value as unknown as OfferedClaims;
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
  env: RentalsBindings,
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
      "vgw-rentals: WALLET_ORIGIN is not set — omitting wallet_link from sessions. Set the Worker var (see DEPLOY.md).",
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

export function createApp(): Hono<{ Bindings: RentalsBindings }> {
  const app = new Hono<{ Bindings: RentalsBindings }>();

  const oauthError = (
    status: 400 | 404 | 500,
    error: string,
    description: string,
  ): [OauthErrorResponse, 400 | 404 | 500] => [
    { error, error_description: description },
    status,
  ];

  // The wallet calls /oid4vp/response cross-origin and fetches the params
  // document cross-origin from the browser; /api/* is for the rentals UI but
  // reflecting there too is harmless (no cookies, no ambient auth).
  const publicCors = cors({
    origin: (origin) => origin,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  });
  app.use("/oid4vp/*", publicCors);
  app.use("/api/*", publicCors);
  app.use(CREDKIT_PARAMS_PATH, publicCors);

  // The published proof alphabets (MIGRATION §8, D.3, D.5.5): one public
  // artifact — range + the coastal set — fetched by every prover; a
  // per-prover alphabet would be a tracking tag. Deterministically minted
  // from the seed, so caching is purely a bandwidth courtesy; modest
  // max-age keeps a seed rotation honest within an hour.
  app.get(CREDKIT_PARAMS_PATH, async (c) => {
    const { document } = await getVerifierParams(c.env);
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(document);
  });

  app.post("/api/verification", async (c) => {
    // The flow discriminator rides an optional JSON body; no body (the
    // pre-N5b UI) means the standard driver check. Unknown flows fail
    // closed — a typo must not silently run the wrong policy.
    let flow: VerificationFlow = "standard";
    const raw = await c.req.text();
    if (raw.trim() !== "") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return c.json(...oauthError(400, "invalid_request", "body must be JSON"));
      }
      const requested = isRecord(parsed) ? (parsed["flow"] ?? "standard") : undefined;
      if (requested !== "standard" && requested !== "resident-rate") {
        return c.json(
          ...oauthError(
            400,
            "invalid_request",
            'flow must be "standard" or "resident-rate"',
          ),
        );
      }
      flow = requested;
    }

    const origin = new URL(c.req.url).origin;
    const sessionId = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(12)));
    const nonce = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));

    // Per-request query: the predicate bound is "25+ as of NOW", pinned into
    // the signed state token so the response endpoint restates exactly what
    // this session offered (Appendix D.2; the D.5.6 generalized memory).
    const verifierParams = await getVerifierParams(c.env);
    let query: PresentationRequest["dcql_query"];
    let offer: OfferedClaims;
    if (flow === "resident-rate") {
      const built = buildResidentRateDcqlQuery({
        origin,
        now: new Date(),
        rangeParamsHash: verifierParams.range.hash,
        setParamsHash: verifierParams.coastalSet.hash,
      });
      query = built.query;
      offer = built.offered;
    } else {
      const built = buildRentalDcqlQuery({
        origin,
        now: new Date(),
        paramsHash: verifierParams.range.hash,
      });
      query = built.query;
      offer = {
        statements: 1,
        range: built.offeredRangeClaims.map((claim) => ({ statement: 0, ...claim })),
        membership: [],
        equalities: [],
      };
    }
    const state = await mintSignedToken({
      secret: resolveTokenSecret(c.env),
      payload: {
        use: "vp-session",
        sessionId,
        nonce,
        flow,
        offer,
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

    // Park the request in the session's Durable Object so the wallet link
    // can pass it by reference — the QR stays scannable.
    const requestUri = `${origin}/oid4vp/request/${encodeURIComponent(sessionId)}`;
    const stub = c.env.SESSIONS.get(c.env.SESSIONS.idFromName(sessionId));
    await stub.fetch("https://sessions/request", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    const walletOrigin = resolveWalletOrigin(c.env, c.req.header("origin"));
    const body: VerificationSessionBody = {
      session_id: sessionId,
      status_url: sessionStatusUrl(origin, sessionId),
      request,
      request_uri: requestUri,
      ...(walletOrigin !== undefined
        ? { wallet_link: walletPresentLinkByReference(walletOrigin, requestUri) }
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

  // The by-reference half of the wallet link: serves the session's
  // authorization request verbatim. Public and CORS-open like the rest of
  // /oid4vp/* — it holds nothing the by-value link wouldn't have printed in
  // the open, and the write-once outcome keeps the nonce single-use.
  app.get("/oid4vp/request/:id", async (c) => {
    const sessionId = c.req.param("id");
    const stub = c.env.SESSIONS.get(c.env.SESSIONS.idFromName(sessionId));
    const response = await stub.fetch("https://sessions/request");
    if (response.status === 404) {
      return c.json(
        ...oauthError(404, "invalid_request", "unknown or expired verification session"),
      );
    }
    return c.json(await response.json());
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
    // a valid one there is nothing to record an outcome against. The offer
    // memory's shape is validated fail-closed (a pre-N5b token dies here).
    const state = stringParam(params, "state");
    if (state === undefined || state === "") {
      return c.json(...oauthError(400, "invalid_request", "missing state"));
    }
    let session: StateTokenPayload;
    try {
      const payload = await readSignedToken<StateTokenPayload>({
        secret: resolveTokenSecret(c.env),
        token: state,
      });
      if (payload.use !== "vp-session") throw new Error("not a vp-session token");
      if (payload.flow !== "standard" && payload.flow !== "resident-rate") {
        throw new Error("token names no known flow");
      }
      assertOfferedClaims(payload.offer);
      session = payload;
    } catch {
      return c.json(
        ...oauthError(400, "invalid_request", "state is invalid or expired"),
      );
    }
    const offer = session.offer;

    // 2. Extract the presentation. Per the D.5.1 vp_token convention a
    // composite's ONE graph VP answers every query, keyed by the FIRST
    // credential query's id; the standard flow keeps its single query id.
    const vpKey = session.flow === "resident-rate" ? RESIDENT_RATE_DL_QUERY_ID : RENTAL_QUERY_ID;
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
        ? (vpToken as Record<string, unknown>)[vpKey]
        : undefined;
    const presentation = Array.isArray(presentations) ? presentations[0] : undefined;
    if (typeof presentation !== "object" || presentation === null) {
      return c.json(
        ...oauthError(
          400,
          "invalid_request",
          `vp_token carries no presentation for credential query "${vpKey}"`,
        ),
      );
    }

    // 3. The trusted issuer: pinned or discovered from the DMV. Without it
    // verification cannot proceed — fail the request, not the session, so a
    // transient discovery error doesn't burn the user's attempt. Both
    // resident-rate statements are DMV-issued: one DID, restated per
    // statement.
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
    // The route peek compares ALL THREE envelope counts (range, membership,
    // equalities — counts only, no trust decisions) against the token's
    // offer, then restates the matching verifier-authored expectation set
    // (Appendix D.2/D.5.6) from the SIGNED TOKEN plus this isolate's own
    // params objects. The standard flow's DCQL offered disclosure
    // ALTERNATIVES, so an all-zero envelope selects its disclosure
    // expectations; the composite offered exactly one shape — anything else
    // was never offered and fails.
    const origin = new URL(c.req.url).origin;
    const domain = `${REDIRECT_URI_CLIENT_ID_PREFIX}${origin}/oid4vp/response`;

    const judge = async (): Promise<
      Pick<
        SessionOutcome,
        "status" | "verdict" | "reason" | "disclosed" | "predicate" | "composite"
      >
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

      const offeredRoute =
        (offer.range.length > 0 || offer.membership.length > 0 || offer.equalities.length > 0) &&
        summary.rangeClaims === offer.range.length &&
        summary.membershipClaims === offer.membership.length &&
        summary.equalities === offer.equalities.length;
      const disclosureRoute =
        session.flow === "standard" &&
        summary.rangeClaims === 0 &&
        summary.membershipClaims === 0 &&
        summary.equalities === 0;
      if (!offeredRoute && !disclosureRoute) {
        return {
          status: "failed",
          reason:
            `The presentation carries ${summary.rangeClaims} range, ${summary.membershipClaims} ` +
            `membership, and ${summary.equalities} equality claims — this session offered ` +
            `${offer.range.length}/${offer.membership.length}/${offer.equalities.length}` +
            `${session.flow === "standard" ? " (or plain disclosure)" : ""}, not that shape.`,
          disclosed: {},
        };
      }

      // Expectations come from the signed token (the bounds and sets this
      // session offered, statement-indexed) + this isolate's own params
      // objects. If the params seed rotated since the request, the wire's
      // paramsHash no longer matches — credkit fails that closed, which is
      // the intended outcome for in-flight sessions across a rotation.
      const verifierParams = await getVerifierParams(c.env);
      const expectedRangeClaims: ExpectedRangeClaim[] = offeredRoute
        ? offer.range.map((claim) => ({
            statement: claim.statement,
            pointer: claim.pointer,
            kind: claim.kind,
            bound: BigInt(claim.bound),
            digits: claim.digits,
            params: verifierParams.range.params,
          }))
        : [];
      const expectedMembershipClaims: ExpectedMembershipClaim[] = [];
      if (offeredRoute) {
        for (const claim of offer.membership) {
          if (claim.set_id !== COASTAL_SET_ID) {
            // Unreachable for tokens this Worker minted; fail the request,
            // never verify against a set that does not exist.
            return {
              status: "failed",
              reason: `The session offered an unknown set "${claim.set_id}".`,
              disclosed: {},
            };
          }
          expectedMembershipClaims.push({
            statement: claim.statement,
            pointer: claim.pointer,
            params: verifierParams.coastalSet.params,
          });
        }
      }
      const expectedEqualities: GraphEquality[] = offeredRoute
        ? offer.equalities.map((group) =>
            group.map((statement) => ({ statement, linkSecret: true as const })),
          )
        : [];
      const expectedIssuerDids = Array.from(
        { length: offer.statements },
        () => expectedIssuer,
      );

      const result = await verifyCredkitPresentation({
        verifiablePresentation: presentation as VerifiablePresentation,
        expectedIssuerDids,
        challenge: session.nonce,
        domain,
        expectedRangeClaims,
        expectedMembershipClaims,
        expectedEqualities,
      });
      if (!result.verified || result.documents === undefined) {
        return {
          status: "failed",
          reason: result.error ?? "presentation verification failed",
          disclosed: {},
        };
      }
      if (session.flow === "resident-rate") {
        return evaluateResidentRatePolicy(result.documents, offer);
      }
      return offeredRoute
        ? evaluateRentalPredicatePolicy(
            result.documents,
            // The standard evaluator (and its stored exhibit) predates the
            // statement-indexed memory — strip the index it never carried.
            offer.range.map(({ statement: _statement, ...claim }) => claim),
          )
        : evaluateRentalPolicy(result.documents);
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
