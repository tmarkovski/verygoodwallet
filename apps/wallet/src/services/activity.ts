/**
 * The presentation log behind the cross-verifier exhibit.
 *
 * The wallet is the only party that ever sees both sides of the
 * unlinkability story — each verifier sees exactly one presentation — so
 * the wallet keeps an encrypted record of what each verifier was shown and
 * renders the comparison: no holder identifier anywhere, re-randomized
 * proofs, and (honestly) whichever disclosed VALUES would let two verifiers
 * join their records if they compared notes. Since the credkit migration
 * the disclosed values are the ONLY candidates — the proofs themselves
 * contribute nothing joinable.
 *
 * Entries are encrypted under the vault key like credentials are; a
 * best-effort write failure must never fail the presentation ceremony
 * itself (the verifier already has its answer).
 */

import { decryptJson, encryptJson } from "@vgw/keys";
import {
  addPresentation,
  listPresentations,
  type PresentationLogPayload,
} from "./db";

export type { PresentationLogPayload } from "./db";

/** A decrypted log entry plus its storage id (stable ordering tiebreaker). */
export interface PresentationLogEntry extends PresentationLogPayload {
  id: number;
}

export async function recordPresentation(options: {
  accountId: number;
  vaultKey: CryptoKey;
  entry: PresentationLogPayload;
}): Promise<void> {
  const payload = await encryptJson(options.vaultKey, options.entry);
  await addPresentation({ accountId: options.accountId, payload });
}

/** All of an account's log entries, newest first. */
export async function loadPresentations(
  accountId: number,
  vaultKey: CryptoKey,
): Promise<PresentationLogEntry[]> {
  const records = await listPresentations(accountId);
  const entries = await Promise.all(
    records.map(async (record) => ({
      id: record.id,
      ...(await decryptJson<PresentationLogPayload>(vaultKey, record.payload)),
    })),
  );
  return entries.sort((a, b) => b.at - a.at || b.id - a.id);
}

/** The latest entry per verifier origin, most recently visited first. */
export function latestPerVerifier(
  entries: PresentationLogEntry[],
): PresentationLogEntry[] {
  const byOrigin = new Map<string, PresentationLogEntry>();
  for (const entry of entries) {
    if (!byOrigin.has(entry.verifierOrigin)) {
      byOrigin.set(entry.verifierOrigin, entry);
    }
  }
  return [...byOrigin.values()];
}

/**
 * The disclosed claim/value pairs two visits have in common — the only
 * correlation handles the cryptography leaves standing. Two exclusions keep
 * the comparison honest:
 * - booleans (a one-bit flag like `age_over_18: true` is shared with half
 *   the population — it identifies nobody), and
 * - the tier-2 "proven, not shown" narration, which is wallet UI text, not
 *   a value any verifier received (the range proof bytes themselves are
 *   re-randomized per presentation — nothing joinable). The legacy
 *   "proven in zero knowledge" prefix covers pre-credkit log entries.
 */
export function sharedDisclosedValues(
  a: PresentationLogEntry,
  b: PresentationLogEntry,
): { claim: string; value: unknown }[] {
  const shared: { claim: string; value: unknown }[] = [];
  for (const [claim, value] of Object.entries(a.disclosed)) {
    if (typeof value === "boolean") continue;
    if (
      typeof value === "string" &&
      (value.startsWith("proven, not shown") ||
        value.startsWith("proven in zero knowledge"))
    ) {
      continue;
    }
    if (
      claim in b.disclosed &&
      JSON.stringify(b.disclosed[claim]) === JSON.stringify(value)
    ) {
      shared.push({ claim, value });
    }
  }
  return shared;
}
