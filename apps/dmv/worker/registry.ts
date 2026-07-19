/**
 * The revocation-registry Durable Object — the DMV's FIRST piece of durable
 * state (every other part of the issuer is stateless by construction:
 * signed-token sessions, seed-derived BBS keys, seed-derived registry
 * trapdoor).
 *
 * Why state at all: the accumulator VALUE mutates on every revocation and
 * every holder/verifier must read the same current value plus the same
 * ordered update log. That is exactly one small, strongly-consistent record
 * — a SQLite-backed Durable Object, mirroring the shop/rentals
 * `VerificationSessions` pattern. ONE instance for the whole registry
 * (`idFromName('registry')`).
 *
 * Deliberately a DUMB STORE: the cryptography (computing V' and the epoch's
 * Ω record) happens in the Worker, which derives the trapdoor from the
 * issuer seed — the trapdoor never travels to the DO, not even per request.
 * Concurrent revocations are serialized with an epoch compare-and-swap: the
 * Worker computes against the state it read and the write names the epoch
 * it expects; a lost race is a 409 the Worker retries with fresh state.
 *
 * Also deliberately a classic fetch-style DO (no `cloudflare:workers`
 * import): the Worker tests run this exact class in plain Node against a
 * Map-backed storage stub, same as the sessions DO.
 */

/** One issued credential's registry row (the admin page's list entry). */
export interface RegistryCredentialRow {
  /** The revocation id lexical — the row key and the revoke handle. */
  revocationId: string;
  /** Which credential kind was issued ('license' | 'resident'). */
  kind: string;
  /** Human-readable label for the admin page (name + document). */
  label: string;
  issuedAt: number;
  /** Set when revoked: the epoch whose batch removed this id. */
  revokedAtEpoch?: number;
}

/** What `GET /state` returns. `accumulator` is null before initialization. */
export interface RegistryStateBody {
  accumulator: string | null;
  epoch: number;
  updates: string[];
}

/** The slice of the Durable Object storage API this class uses. */
export interface RegistryStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export interface RegistryState {
  storage: RegistryStorage;
}

/** Zero-padded so `list({ prefix })` returns epochs in numeric order. */
function updateKey(epoch: number): string {
  return `update:${String(epoch).padStart(12, '0')}`;
}

function credentialKey(revocationId: string): string {
  return `credential:${revocationId}`;
}

export class RevocationRegistry {
  private readonly storage: RegistryStorage;

  constructor(state: RegistryState) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/state") {
      return Response.json(await this.stateBody());
    }

    if (request.method === "GET" && url.pathname === "/credentials") {
      const rows = await this.storage.list<RegistryCredentialRow>({ prefix: "credential:" });
      const credentials = [...rows.values()].sort((a, b) => b.issuedAt - a.issuedAt);
      return Response.json({ credentials });
    }

    if (request.method === "POST" && url.pathname === "/register") {
      const body = (await request.json()) as {
        revocationId?: unknown;
        kind?: unknown;
        label?: unknown;
        accumulator?: unknown;
      };
      if (
        typeof body.revocationId !== "string" ||
        typeof body.kind !== "string" ||
        typeof body.label !== "string" ||
        typeof body.accumulator !== "string"
      ) {
        return Response.json({ error: "bad register body" }, { status: 400 });
      }
      // First registration initializes the accumulator to the Worker's
      // seeded V0. Additions-static: registering NEVER moves the value or
      // the epoch — the response echoes current state for witness issuance.
      let accumulator = await this.storage.get<string>("accumulator");
      if (accumulator === undefined) {
        accumulator = body.accumulator;
        await this.storage.put("accumulator", accumulator);
        await this.storage.put("epoch", 0);
      }
      const row: RegistryCredentialRow = {
        revocationId: body.revocationId,
        kind: body.kind,
        label: body.label,
        issuedAt: Date.now(),
      };
      await this.storage.put(credentialKey(body.revocationId), row);
      const epoch = (await this.storage.get<number>("epoch")) ?? 0;
      return Response.json({ accumulator, epoch });
    }

    if (request.method === "POST" && url.pathname === "/apply") {
      const body = (await request.json()) as {
        expectedEpoch?: unknown;
        epoch?: unknown;
        accumulator?: unknown;
        update?: unknown;
        revokedIds?: unknown;
      };
      if (
        typeof body.expectedEpoch !== "number" ||
        typeof body.epoch !== "number" ||
        body.epoch !== body.expectedEpoch + 1 ||
        typeof body.accumulator !== "string" ||
        typeof body.update !== "string" ||
        !Array.isArray(body.revokedIds) ||
        body.revokedIds.some((id) => typeof id !== "string")
      ) {
        return Response.json({ error: "bad apply body" }, { status: 400 });
      }
      const current = (await this.storage.get<number>("epoch")) ?? 0;
      if (current !== body.expectedEpoch) {
        // The Worker computed against stale state — it must re-read and
        // recompute; applying anyway would corrupt every holder's witness.
        return Response.json({ error: "epoch conflict", epoch: current }, { status: 409 });
      }
      await this.storage.put("accumulator", body.accumulator);
      await this.storage.put("epoch", body.epoch);
      await this.storage.put(updateKey(body.epoch), body.update);
      for (const id of body.revokedIds as string[]) {
        const row = await this.storage.get<RegistryCredentialRow>(credentialKey(id));
        if (row !== undefined && row.revokedAtEpoch === undefined) {
          await this.storage.put(credentialKey(id), { ...row, revokedAtEpoch: body.epoch });
        }
      }
      return Response.json({ accumulator: body.accumulator, epoch: body.epoch });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async stateBody(): Promise<RegistryStateBody> {
    const accumulator = (await this.storage.get<string>("accumulator")) ?? null;
    const epoch = (await this.storage.get<number>("epoch")) ?? 0;
    const updates = [...(await this.storage.list<string>({ prefix: "update:" })).values()];
    return { accumulator, epoch, updates };
  }
}
