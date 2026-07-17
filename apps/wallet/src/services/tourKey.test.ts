/**
 * Lifetime rules for the tour-only key stash. The critical invariants: the
 * stash is unusable outside a running tour, unusable after its TTL, and any
 * failed validation clears it — a stale copy of the master secret must never
 * linger.
 */

import { afterEach, describe, expect, it } from "vitest";
import { exitTour, setTourStop } from "@vgw/tour";
import {
  TOUR_KEY_TTL_MS,
  clearTourKey,
  declineTourKey,
  hasTourKey,
  stashTourKey,
  takeTourKey,
  tourKeyDeclined,
} from "./tourKey";

const STORAGE_KEY = "vgw:tour:key";

/** A minimal window with per-test sessionStorage (same shape the tour uses). */
function stubWindow() {
  const store = new Map<string, string>();
  const win = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    location: { href: "https://wallet.example/", search: "" },
    history: { replaceState: () => undefined },
  };
  (globalThis as { window?: unknown }).window = win;
  return win;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const SECRET = new Uint8Array([1, 2, 3, 250, 251, 252]);

describe("tour key stash", () => {
  it("is inert without a window", () => {
    expect(stashTourKey(1, SECRET, "prf")).toBe(false);
    expect(takeTourKey()).toBeNull();
    expect(hasTourKey()).toBe(false);
  });

  it("refuses to stash when no tour is running", () => {
    const win = stubWindow();
    expect(stashTourKey(1, SECRET, "prf")).toBe(false);
    expect(win.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("round-trips the key while the tour is running", () => {
    stubWindow();
    setTourStop("create");
    expect(stashTourKey(7, SECRET, "prf")).toBe(true);
    const taken = takeTourKey();
    expect(taken).not.toBeNull();
    expect(taken?.accountId).toBe(7);
    expect(taken?.source).toBe("prf");
    expect(Array.from(taken?.masterSecret ?? [])).toEqual(Array.from(SECRET));
    // Reading is not consuming: the stash survives for the next reload.
    expect(hasTourKey()).toBe(true);
  });

  it("expires after the TTL and clears the entry", () => {
    const win = stubWindow();
    setTourStop("create");
    expect(stashTourKey(7, SECRET, "prf")).toBe(true);
    const stored = JSON.parse(win.sessionStorage.getItem(STORAGE_KEY) as string) as {
      at: number;
    };
    stored.at = Date.now() - TOUR_KEY_TTL_MS - 1;
    win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    expect(takeTourKey()).toBeNull();
    expect(win.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("becomes unusable (and clears) once the tour ends", () => {
    const win = stubWindow();
    setTourStop("create");
    expect(stashTourKey(7, SECRET, "simulated")).toBe(true);
    exitTour();
    expect(takeTourKey()).toBeNull();
    expect(win.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clears malformed entries instead of returning them", () => {
    const win = stubWindow();
    setTourStop("create");
    win.sessionStorage.setItem(STORAGE_KEY, "{not json");
    expect(takeTourKey()).toBeNull();
    expect(win.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearTourKey removes an existing stash", () => {
    const win = stubWindow();
    setTourStop("create");
    expect(stashTourKey(7, SECRET, "prf")).toBe(true);
    clearTourKey();
    expect(win.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("remembers a per-tab decline", () => {
    stubWindow();
    expect(tourKeyDeclined()).toBe(false);
    declineTourKey();
    expect(tourKeyDeclined()).toBe(true);
  });
});
