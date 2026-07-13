import { describe, expect, it } from "vitest";
import { cardTheme, seedHash } from "./color";

describe("seedHash", () => {
  it("is deterministic", () => {
    expect(seedHash("Iso18013DriversLicenseCredential")).toBe(
      seedHash("Iso18013DriversLicenseCredential"),
    );
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const seed of ["", "a", "vgw", "Iso18013DriversLicenseCredential"]) {
      const hash = seedHash(seed);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("differs across nearby seeds", () => {
    expect(seedHash("credential-a")).not.toBe(seedHash("credential-b"));
  });
});

describe("cardTheme", () => {
  it("selects an engraving tint with two line inks", () => {
    const theme = cardTheme("Iso18013DriversLicenseCredential");
    expect(["cream", "gold", "verdigris", "faded-red"]).toContain(theme.tint);
    expect(theme.lineA).toMatch(/^rgb\(\d+ \d+ \d+ \/ 0\.\d+\)$/);
    expect(theme.lineB).toMatch(/^rgb\(\d+ \d+ \d+ \/ 0\.\d+\)$/);
    expect(theme.lineA).not.toBe(theme.lineB);
  });

  it("is stable across calls", () => {
    expect(cardTheme("seed")).toEqual(cardTheme("seed"));
  });

  it("covers every tint across seeds", () => {
    const tints = new Set<string>();
    for (let i = 0; i < 64; i++) tints.add(cardTheme(`seed-${i}`).tint);
    expect(tints.size).toBe(4);
  });
});
