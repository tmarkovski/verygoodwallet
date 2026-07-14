/**
 * The public cutoff for an age predicate: the LATEST birth date (as days
 * since the Unix epoch) that satisfies "has turned `years` on date `on`".
 * The circuit proves `dob_days <= cutoff_days`, so wallet and verifier must
 * compute this identically — and the verifier tolerates a ±1 day difference
 * for clock skew across the proving/verifying midnight boundary.
 *
 * Calendar arithmetic matches @vgw/vc-kit's `hasReachedAge`: someone born on
 * Feb 29 has their NNth birthday on Mar 1 in a non-leap year.
 */

const MS_PER_DAY = 86_400_000;

export function ageCutoffDays(years: number, on: Date = new Date()): number {
  if (!Number.isInteger(years) || years <= 0) {
    throw new RangeError(`ageCutoffDays: years must be a positive integer, got ${years}`);
  }
  const day = on.getUTCDate();
  let ms = Date.UTC(on.getUTCFullYear() - years, on.getUTCMonth(), day);
  if (new Date(ms).getUTCDate() !== day) {
    // Feb 29 minus a non-leap-year span rolled over to Mar 1: the latest
    // qualifying birth date is Feb 28 (a Mar 1 birth turns NN a year late).
    ms -= MS_PER_DAY;
  }
  const days = ms / MS_PER_DAY;
  if (days < 0) {
    throw new RangeError(
      `ageCutoffDays: cutoff before the Unix epoch (years=${years}, on=${on.toISOString()}) is outside the circuit's u32 range`,
    );
  }
  return days;
}
