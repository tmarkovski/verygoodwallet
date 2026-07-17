/**
 * Tour-only key stash — DEMO CONVENIENCE, NOT PRODUCTION PRACTICE.
 *
 * The wallet's rule is that the master secret lives in memory only, so every
 * cross-origin hop of the guided tour (wallet → DMV → shop → rentals) reloads
 * the app, locks the wallet, and costs another passkey prompt. With the
 * user's explicit consent the wallet stashes the master secret in this tab's
 * sessionStorage so the tour flows without repeat prompts.
 *
 * The stash is deliberately narrow:
 * - it exists only after the user accepts the offer dialog;
 * - it restores only while a tour stop is active on this tab, and only
 *   within `TOUR_KEY_TTL_MS` of being stashed (never re-stamped);
 * - it is cleared on lock, on wallet reset, when the tour ends, and on any
 *   failed validation.
 *
 * A real wallet would never persist key material like this — the offer
 * dialog says so in as many words.
 */

import { currentTourStopId } from "@vgw/tour";
import type { MasterSecretSource } from "./webauthn";

const STORAGE_KEY = "vgw:tour:key";
const DECLINED_KEY = "vgw:tour:key-declined";

/** How long a stashed key stays usable. Fixed from the moment of stashing —
    unlike the tour's own 30-minute abandonment clock, this is never
    re-stamped, so consent is bounded no matter how long the tour runs. */
export const TOUR_KEY_TTL_MS = 15 * 60 * 1000;

/** What STORAGE_KEY holds: the key, whose account it unlocks, and when. */
interface StoredTourKey {
  accountId: number;
  /** Master secret, base64. */
  secret: string;
  source: MasterSecretSource;
  at: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null; // storage unavailable (privacy mode) — feature is just off
  }
}

export interface TourKey {
  accountId: number;
  masterSecret: Uint8Array;
  source: MasterSecretSource;
}

/**
 * Stash the unlocked session's key for the tour. Only callable while a tour
 * stop is active — outside a tour there is nothing to consent to.
 */
export function stashTourKey(
  accountId: number,
  masterSecret: Uint8Array,
  source: MasterSecretSource,
): boolean {
  const store = storage();
  if (store === null || currentTourStopId() === null) return false;
  const stored: StoredTourKey = {
    accountId,
    secret: toBase64(masterSecret),
    source,
    at: Date.now(),
  };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    return false;
  }
  return true;
}

/**
 * The stashed key, or null — requiring an active tour stop and a fresh TTL,
 * and clearing the stash whenever it fails validation.
 */
export function takeTourKey(): TourKey | null {
  const store = storage();
  if (store === null) return null;
  const raw = store.getItem(STORAGE_KEY);
  if (raw === null) return null;
  let stored: Partial<StoredTourKey>;
  try {
    stored = JSON.parse(raw) as Partial<StoredTourKey>;
  } catch {
    stored = {};
  }
  const secret =
    typeof stored.secret === "string" ? fromBase64(stored.secret) : null;
  const valid =
    typeof stored.accountId === "number" &&
    secret !== null &&
    secret.length > 0 &&
    (stored.source === "prf" || stored.source === "simulated") &&
    typeof stored.at === "number" &&
    Date.now() - stored.at <= TOUR_KEY_TTL_MS &&
    currentTourStopId() !== null;
  if (!valid) {
    clearTourKey();
    return null;
  }
  return {
    accountId: stored.accountId as number,
    masterSecret: secret as Uint8Array,
    source: stored.source as MasterSecretSource,
  };
}

/** True when a currently-usable stash exists (same checks as `takeTourKey`). */
export function hasTourKey(): boolean {
  return takeTourKey() !== null;
}

export function clearTourKey(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Removal is tidiness — an unreadable entry already fails validation.
  }
}

/** Remember "no thanks" for this tab so the dialog asks once, not per stop. */
export function declineTourKey(): void {
  try {
    storage()?.setItem(DECLINED_KEY, "1");
  } catch {
    // Without storage the dialog can't persist the answer; it will re-ask.
  }
}

export function tourKeyDeclined(): boolean {
  try {
    return storage()?.getItem(DECLINED_KEY) === "1";
  } catch {
    return false;
  }
}
