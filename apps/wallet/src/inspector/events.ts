/**
 * Tiny pub/sub event log for the Inspector drawer.
 *
 * Services emit small, human-readable events (`inspect.emit`) as they work —
 * PRF evaluated, vault key derived, VC signed, VC encrypted… The drawer
 * subscribes via `useSyncExternalStore(inspect.subscribe, inspect.snapshot)`.
 *
 * NEVER put raw secrets in event data — use `previewSecret()` hashes.
 * Pure module — no DOM, unit-tested in Node.
 */

export interface InspectorEvent {
  /** Monotonic id, unique within the session. */
  id: number;
  /** Epoch milliseconds. */
  t: number;
  label: string;
  data?: Record<string, unknown>;
}

/** Ring-buffer capacity; oldest events are dropped beyond this. */
export const MAX_EVENTS = 250;

type Listener = () => void;

let buffer: readonly InspectorEvent[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export const inspect = {
  emit(event: { label: string; data?: Record<string, unknown> }): InspectorEvent {
    const entry: InspectorEvent = {
      id: nextId++,
      t: Date.now(),
      label: event.label,
      ...(event.data !== undefined ? { data: event.data } : {}),
    };
    const next = [...buffer, entry];
    buffer = next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    notify();
    return entry;
  },

  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Current event list (stable reference between emits). */
  snapshot(): readonly InspectorEvent[] {
    return buffer;
  },

  clear(): void {
    buffer = [];
    notify();
  },
};
