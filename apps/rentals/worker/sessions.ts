/**
 * The verification-session Durable Object — the rentals Worker's one piece
 * of server-side state (same design as the shop's; the two verifiers are
 * independent parties and deliberately do not share server code).
 *
 * Why state at all when the DMV issuer is fully stateless: in the
 * cross-device flow the wallet (phone) direct_posts the presentation while
 * the rentals tab (desktop) polls for the outcome — two requests that share
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

/**
 * The predicate-route exhibit: what the range proof established, verified
 * entirely on the Worker (no `zk_pending`, no client hand-off since N3).
 */
export interface PredicateExhibit {
  /** The declared twin the proof is about (never its value). */
  pointer: string;
  kind: "greaterOrEqual" | "lessOrEqual";
  /** Inclusive bound in the twin's encoder units, decimal string. */
  bound: string;
  digits: number;
  /** The bound as a calendar date — the cutoff pinned at request time. */
  cutoffIso: string;
}

/**
 * One membership proof of a composite outcome (N5b): the hidden twin is one
 * of this verifier's PUBLISHED set — the members are public policy (they
 * ride the params document); which one the holder matches stays hidden.
 */
export interface MembershipExhibit {
  statement: number;
  /** The declared twin the proof is about (never its value). */
  pointer: string;
  setId: string;
  /** The published members, decimal strings, in publication order. */
  members: string[];
}

/** One proven cross-statement equality of a composite outcome (N5b). */
export interface EqualityExhibit {
  /** The only kind this verifier offers: the statements' hidden link secrets. */
  kind: "link_secret";
  /** Which statements were proven to share one holder. */
  statements: number[];
}

/**
 * The composite ("coastal resident rate") exhibit: everything the linked
 * presentation PROVED, verified entirely on the Worker — while the
 * disclosed set stayed empty (MIGRATION §9 showcase C, D.5.3).
 */
export interface CompositeExhibit {
  /** How many credentials the one graph presentation spanned. */
  statements: number;
  range: (PredicateExhibit & { statement: number })[];
  membership: MembershipExhibit[];
  equalities: EqualityExhibit[];
}

/** Everything the rentals UI learns about a completed session. */
export interface SessionOutcome {
  /** `verified` = the presentation checked out; `failed` = it did not. */
  status: "verified" | "failed";
  /** Only for `verified`: what the rental policy decided. */
  verdict?: "allowed" | "denied";
  /** Human-readable basis for the outcome (shown in the rentals UI). */
  reason: string;
  /** Claim name → disclosed value — exactly what this verifier learned. */
  disclosed: Record<string, unknown>;
  /** Present iff the wallet took the standard flow's predicate route. */
  predicate?: PredicateExhibit;
  /** Present iff this was the composite resident-rate flow. */
  composite?: CompositeExhibit;
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
