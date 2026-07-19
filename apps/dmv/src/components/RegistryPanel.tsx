/**
 * The DMV records desk: every credential this issuer has enrolled in its
 * revocation registry, with a revoke action per row — the admin side of the
 * accumulator demo. Revoking here is what makes a wallet's next witness
 * refresh throw and every verifier's next non-revocation check fail.
 *
 * Unauthenticated LIKE THE REST OF THE ISSUER (anyone can mint offers at
 * the counter); this is a demo control surface, not an access-controlled
 * back office.
 */

import { useCallback, useEffect, useState } from "react";

interface RegistryCredentialRow {
  revocationId: string;
  kind: string;
  label: string;
  issuedAt: number;
  revokedAtEpoch?: number;
}

interface RegistryStateSummary {
  epoch: number;
  accumulator: string;
}

export function RegistryPanel() {
  const [rows, setRows] = useState<RegistryCredentialRow[] | null>(null);
  const [state, setState] = useState<RegistryStateSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** revocationId currently in its "confirm" arm, or being revoked. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [listRes, stateRes] = await Promise.all([
        fetch("/api/registry/credentials"),
        fetch("/api/registry"),
      ]);
      if (!listRes.ok || !stateRes.ok) {
        throw new Error(`registry responded ${listRes.ok ? stateRes.status : listRes.status}`);
      }
      const list = (await listRes.json()) as { credentials: RegistryCredentialRow[] };
      const stateBody = (await stateRes.json()) as RegistryStateSummary;
      setRows(list.credentials);
      setState(stateBody);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = async (revocationId: string) => {
    setRevoking(revocationId);
    setError(null);
    try {
      const response = await fetch("/api/registry/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revocationIds: [revocationId] }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const description = (body as { error_description?: string }).error_description;
        throw new Error(description ?? `Revocation failed (${response.status})`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevoking(null);
      setConfirming(null);
    }
  };

  return (
    <section className="animate-rise">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Issued records
        </h2>
        {state !== null && (
          <p className="text-[11px] text-muted">
            registry epoch <span className="font-mono text-ink-dim">{state.epoch}</span>
          </p>
        )}
      </div>

      <div className="mt-4 rounded-3xl border border-line bg-surface p-6">
        {rows === null && error === null && (
          <p className="text-sm text-muted">Loading records…</p>
        )}

        {rows !== null && rows.length === 0 && (
          <p className="text-sm text-muted">
            Nothing on file yet — issue a document at the counter first. Every
            credential issued here is enrolled in the revocation registry the
            moment it is signed.
          </p>
        )}

        {rows !== null && rows.length > 0 && (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const revoked = row.revokedAtEpoch !== undefined;
              const isConfirming = confirming === row.revocationId;
              const isRevoking = revoking === row.revocationId;
              return (
                <li
                  key={row.revocationId}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{row.label}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {row.kind === "resident" ? "Resident registration" : "Driver's license"}
                      {" · issued "}
                      {new Date(row.issuedAt).toLocaleString()}
                    </p>
                  </div>
                  {revoked ? (
                    <span className="shrink-0 rounded-full bg-danger-soft px-3 py-1 text-xs font-medium text-danger">
                      Revoked · epoch {row.revokedAtEpoch}
                    </span>
                  ) : isConfirming ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isRevoking}
                        onClick={() => void revoke(row.revocationId)}
                        className="rounded-full bg-danger px-3 py-1.5 text-xs font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                      >
                        {isRevoking ? "Revoking…" : "Confirm revoke"}
                      </button>
                      <button
                        type="button"
                        disabled={isRevoking}
                        onClick={() => setConfirming(null)}
                        className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-ink-dim transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-50"
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-ok-soft px-3 py-1 text-xs font-medium text-ok">
                        Active
                      </span>
                      <button
                        type="button"
                        onClick={() => setConfirming(row.revocationId)}
                        className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-danger transition-colors hover:border-danger/50 hover:bg-danger-soft active:scale-[0.98]"
                      >
                        Revoke
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error !== null && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Revoking removes the record's hidden id from the registry accumulator
        and publishes one update record. Wallets refresh their witnesses from
        that public record before presenting — a revoked credential fails its
        own refresh, and verifiers checking against the current registry state
        reject anything staler. Which record was revoked is never visible in a
        presentation.
      </p>
    </section>
  );
}
