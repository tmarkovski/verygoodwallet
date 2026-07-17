/**
 * Where the tour stands on THIS origin. sessionStorage, not the URL, is the
 * source of truth within an origin — the wallet's internal navigations drop
 * query params — while the `?tour=` param seeds it on every cross-origin
 * arrival (sessionStorage is per-tab, so the param re-seeds new tabs too).
 */

import { TOUR_PARAM, nextTourStop, tourStop } from "./script";

const STORAGE_KEY = "vgw:tour:stop";

/**
 * How long an untouched stop stays alive. The tour bills itself as the
 * ninety-second version, so a stop that hasn't advanced in 30 minutes is
 * an abandoned tour, not a running one. Without the cutoff, any tab that
 * ever toured resurrects the narrator on every later visit to that origin
 * (sessionStorage survives reloads and even browser tab restore, and the
 * ✕ only clears the origin it's clicked on). Every adopt/advance
 * re-stamps the clock, so a genuinely running tour never expires.
 */
const TOUR_TTL_MS = 30 * 60 * 1000;

/** What STORAGE_KEY holds: the stop plus when it was (re-)stamped. */
interface StoredStop {
  id: string;
  at: number;
}

/**
 * The stored stop, or null — dropping (and clearing) entries that are
 * expired, malformed, unknown, or in the pre-TTL bare-string format.
 */
function readStoredStop(): string | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable (privacy mode) — no tour, no error
  }
  if (raw === null) return null;
  let stored: Partial<StoredStop>;
  try {
    stored = JSON.parse(raw) as Partial<StoredStop>;
  } catch {
    stored = {};
  }
  const fresh =
    typeof stored.id === "string" &&
    tourStop(stored.id) !== null &&
    typeof stored.at === "number" &&
    Date.now() - stored.at <= TOUR_TTL_MS;
  if (!fresh) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Removal is tidiness — the entry already reads as absent.
    }
    return null;
  }
  return stored.id as string;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The active stop id on this origin, or null when no tour is running. */
export function currentTourStopId(): string | null {
  if (typeof window === "undefined") return null;
  return readStoredStop();
}

export function setTourStop(id: string): void {
  if (typeof window === "undefined" || tourStop(id) === null) return;
  const stored: StoredStop = { id, at: Date.now() };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    return;
  }
  notify();
}

/**
 * Advance to the stop after `id` — but only if `id` is still the current
 * one, so completion handlers that fire twice (or late) can't skip ahead.
 */
export function advanceTourFrom(id: string): void {
  if (currentTourStopId() !== id) return;
  const next = nextTourStop(id);
  if (next !== null) setTourStop(next.id);
}

/** Adopt a `?tour=` param into this origin's state. Returns the active id. */
export function adoptTourFromUrl(search?: string): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(search ?? window.location.search);
  const id = params.get(TOUR_PARAM);
  if (id !== null && tourStop(id) !== null && currentTourStopId() !== id) {
    setTourStop(id);
  }
  return currentTourStopId();
}

/** End the tour on this origin: clear the state and strip the URL param. */
export function exitTour(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has(TOUR_PARAM)) {
      url.searchParams.delete(TOUR_PARAM);
      window.history.replaceState(null, "", url.toString());
    }
  } catch {
    // URL cleanup is cosmetic — state is already cleared.
  }
  notify();
}
