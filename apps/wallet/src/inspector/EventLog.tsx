/**
 * Session event log — everything the wallet's services did this session,
 * newest first. Backed by the tiny pub/sub in `events.ts`.
 */

import { useSyncExternalStore } from "react";
import { inspect } from "./events";
import { JsonTree } from "./JsonTree";

/**
 * Proof operations get a restrained gold tick — key derivation, sealing,
 * signing, proving. Housekeeping (locks, deletes, fallbacks) stays plain.
 */
const CRYPTO_MOMENT =
  /(derived|decrypted|encrypted at rest|signed|proof|commitment created|keypair generated|prf evaluated)/i;

function formatTime(t: number): string {
  const date = new Date(t);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function EventLog() {
  const events = useSyncExternalStore(inspect.subscribe, inspect.snapshot);

  if (events.length === 0) {
    return (
      <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">
        Nothing yet. Unlock the wallet or add a credential and the services
        will narrate their work here.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] text-muted">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => inspect.clear()}
          className="rounded px-2 py-1 text-[11px] text-muted transition-colors hover:text-ink"
        >
          Clear
        </button>
      </div>
      <ol className="space-y-1.5">
        {[...events].reverse().map((event) => (
          <li key={event.id} className="rounded-lg bg-surface px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[10px] text-muted">
                {formatTime(event.t)}
              </span>
              {CRYPTO_MOMENT.test(event.label) && (
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rotate-45 self-center bg-gold"
                />
              )}
              <span className="text-xs text-ink">{event.label}</span>
            </div>
            {event.data !== undefined && (
              <details className="mt-1">
                <summary className="cursor-pointer select-none text-[11px] text-muted hover:text-ink-dim">
                  data
                </summary>
                <div className="mt-1">
                  <JsonTree value={event.data} />
                </div>
              </details>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
