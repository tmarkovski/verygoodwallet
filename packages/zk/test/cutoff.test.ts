import { describe, expect, it } from "vitest";
import { ageCutoffDays } from "../src/cutoff.js";
import { daysSinceEpoch } from "@vgw/keys";

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("ageCutoffDays", () => {
  it("is the latest qualifying birth date: 18 years before 2026-07-13", () => {
    expect(ageCutoffDays(18, utc("2026-07-13"))).toBe(daysSinceEpoch("2008-07-13"));
  });

  it("borderline: born exactly on the cutoff qualifies, one day later does not", () => {
    const cutoff = ageCutoffDays(21, utc("2026-07-13"));
    expect(cutoff).toBe(daysSinceEpoch("2005-07-13"));
    // The circuit's predicate is dob_days <= cutoff_days: the person born on
    // 2005-07-13 turns 21 exactly on 2026-07-13 and qualifies.
    expect(daysSinceEpoch("2005-07-13")).toBeLessThanOrEqual(cutoff);
    expect(daysSinceEpoch("2005-07-14")).toBeGreaterThan(cutoff);
  });

  it("Feb 29 verification date with a non-leap target year clamps to Feb 28", () => {
    // 2048 is a leap year; 2048-18 = 2030 is not. A Mar 1 2030 birth turns 18
    // on 2048-03-01 (after Feb 29), so the latest qualifying date is Feb 28.
    expect(ageCutoffDays(18, utc("2048-02-29"))).toBe(daysSinceEpoch("2030-02-28"));
  });

  it("Feb 29 verification date with a leap target year keeps Feb 29", () => {
    // 2048-28 = 2020 is a leap year: Feb 29 2020 exists and qualifies.
    expect(ageCutoffDays(28, utc("2048-02-29"))).toBe(daysSinceEpoch("2020-02-29"));
  });

  it("rejects non-positive or fractional years", () => {
    expect(() => ageCutoffDays(0)).toThrow(/positive integer/);
    expect(() => ageCutoffDays(-3)).toThrow(/positive integer/);
    expect(() => ageCutoffDays(18.5)).toThrow(/positive integer/);
  });

  it("rejects cutoffs before the Unix epoch (u32 range)", () => {
    expect(() => ageCutoffDays(80, utc("2026-07-13"))).toThrow(/u32 range/);
  });
});
