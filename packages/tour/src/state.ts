/**
 * Where the tour stands on THIS origin. sessionStorage, not the URL, is the
 * source of truth within an origin — the wallet's internal navigations drop
 * query params — while the `?tour=` param seeds it on every cross-origin
 * arrival (sessionStorage is per-tab, so the param re-seeds new tabs too).
 */

import { TOUR_PARAM, nextTourStop, tourStop } from "./script";

const STORAGE_KEY = "vgw:tour:stop";

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
  try {
    const id = window.sessionStorage.getItem(STORAGE_KEY);
    return id !== null && tourStop(id) !== null ? id : null;
  } catch {
    return null; // storage unavailable (privacy mode) — no tour, no error
  }
}

export function setTourStop(id: string): void {
  if (typeof window === "undefined" || tourStop(id) === null) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
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
