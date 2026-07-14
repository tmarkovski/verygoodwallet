/**
 * The verification-session Durable Object — the demo's one piece of
 * server-side state.
 *
 * Why state at all when the DMV issuer is fully stateless: in the
 * cross-device flow the wallet (phone) direct_posts the presentation while
 * the shop tab (desktop) polls for the outcome — two requests that share
 * nothing but the session id, possibly hitting different isolates in
 * different colos. KV's eventual consistency could stall the poll for up to
 * a minute; a SQLite-backed Durable Object (Workers Free plan) gives the
 * poll read-your-writes consistency.
 *
 * One instance per session (`idFromName(sessionId)`), write-once: the first
 * `POST /complete` wins and every later one is rejected, which is what makes
 * a captured direct_post unreplayable. Instances purge themselves via alarm.
 *
 * Deliberately a classic fetch-style DO (no `cloudflare:workers` import):
 * the Worker tests run this exact class in plain Node against a Map-backed
 * storage stub, which an RPC DO's platform base class would preclude.
 */

/** The tier-2 payload the shop CLIENT verifies (see policy.ts on why not here). */
export interface ZkOutcomePayload {
  scheme: string;
  circuit: string;
  years: number;
  /** Cutoff the Worker validated against its own policy clock. */
  cutoffDays: number;
  /** The BBS-disclosed commitment (canonical hex) — the proof's other public input. */
  commitment: string;
  /** UltraHonk proof bytes, base64url. */
  proof: string;
}

/** Everything the shop UI learns about a completed session. */
export interface SessionOutcome {
  /** `verified` = the presentation checked out; `failed` = it did not. */
  status: "verified" | "failed";
  /**
   * Only for `verified`: what the age policy decided. `zk_pending` means
   * every Worker-side check passed and the final UltraHonk verification is
   * the client's (see the `zk` payload).
   */
  verdict?: "allowed" | "denied" | "zk_pending";
  /** Human-readable basis for the outcome (shown in the shop UI). */
  reason: string;
  /** Claim name → disclosed value — exactly what this verifier learned. */
  disclosed: Record<string, unknown>;
  /** Present iff `verdict` is `zk_pending`. */
  zk?: ZkOutcomePayload;
  /** The vp_token as received, for the protocol inspector. */
  vpToken?: unknown;
  completedAt: number;
}

export type SessionStatus = { status: "pending" } | SessionOutcome;

/** How long a completed session stays queryable before the alarm purges it. */
const SESSION_RETENTION_MS = 30 * 60 * 1000;

/** The slice of the Durable Object storage API this class uses. */
export interface SessionStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface SessionState {
  storage: SessionStorage;
}

export class VerificationSessions {
  private readonly storage: SessionStorage;

  constructor(state: SessionState) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      const outcome = await this.storage.get<SessionOutcome>("outcome");
      const status: SessionStatus = outcome ?? { status: "pending" };
      return Response.json(status);
    }
    if (request.method === "POST" && url.pathname === "/complete") {
      const existing = await this.storage.get<SessionOutcome>("outcome");
      if (existing !== undefined) {
        // Write-once: a second completion is a replayed or duplicated
        // response and must not overwrite the recorded outcome.
        return Response.json({ error: "already completed" }, { status: 409 });
      }
      const outcome = (await request.json()) as SessionOutcome;
      await this.storage.put("outcome", outcome);
      await this.storage.setAlarm(Date.now() + SESSION_RETENTION_MS);
      return Response.json({ stored: true });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.storage.deleteAll();
  }
}
