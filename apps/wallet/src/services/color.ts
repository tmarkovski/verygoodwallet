/**
 * Deterministic card faces: a credential's `meta.colorSeed` selects the
 * plate, engraving geometry, and line-work ink of its guilloché face (see
 * `.guilloche` in index.css). The two document series the Utopia DMV
 * prints get distinct, curated faces — petrol plate with corner rosettes
 * for the driver's license, navy plate with tide-line arcs for the
 * resident registration — the way one national printer gives each document
 * family its own plate. Unknown kinds fall back to a hashed engraving tint
 * on the license plate.
 *
 * Pure module — no DOM, unit-tested in Node.
 */

/** FNV-1a 32-bit hash of a string. Stable across sessions and platforms. */
export function seedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type EngravingTint = "cream" | "gold" | "verdigris" | "faded-red";

/** Engraving geometry: corner rosettes (license) or tide-line arcs (registry). */
export type EngravingPattern = "rosette" | "tide";

export interface CardTheme {
  tint: EngravingTint;
  /** Ink of the top-right line field (`--guilloche-line-a`). */
  lineA: string;
  /** Ink of the bottom-left line field (`--guilloche-line-b`). */
  lineB: string;
  /** Plate gradient stops — dark and literal in both UI themes. */
  plateA: string;
  plateB: string;
  pattern: EngravingPattern;
}

/** The license plate: deep petrol, shared by the hash fallback. */
const PETROL = { plateA: "#143134", plateB: "#0f2629" } as const;

/**
 * The four fallback engraving inks. Opacities are tuned per tint so each
 * reads as the same faint line-work against the petrol plate.
 */
const TINTS: readonly CardTheme[] = [
  {
    tint: "cream",
    lineA: "rgb(236 231 211 / 0.05)",
    lineB: "rgb(236 231 211 / 0.038)",
    ...PETROL,
    pattern: "rosette",
  },
  {
    tint: "gold",
    lineA: "rgb(201 168 106 / 0.062)",
    lineB: "rgb(201 168 106 / 0.048)",
    ...PETROL,
    pattern: "rosette",
  },
  {
    tint: "verdigris",
    lineA: "rgb(127 199 168 / 0.055)",
    lineB: "rgb(127 199 168 / 0.042)",
    ...PETROL,
    pattern: "rosette",
  },
  {
    tint: "faded-red",
    lineA: "rgb(224 126 126 / 0.05)",
    lineB: "rgb(224 126 126 / 0.038)",
    ...PETROL,
    pattern: "rosette",
  },
];

/** Curated faces for the DMV's two document series (seed = credential kind). */
const KIND_THEMES: Record<string, CardTheme> = {
  Iso18013DriversLicenseCredential: {
    tint: "gold",
    lineA: "rgb(201 168 106 / 0.062)",
    lineB: "rgb(201 168 106 / 0.048)",
    ...PETROL,
    pattern: "rosette",
  },
  UtopiaResidentRegistrationCredential: {
    tint: "verdigris",
    lineA: "rgb(127 199 168 / 0.07)",
    lineB: "rgb(236 231 211 / 0.045)",
    plateA: "#1c2742",
    plateB: "#131c33",
    pattern: "tide",
  },
};

/** Card face theme (plate, pattern, guilloché line inks) for a color seed. */
export function cardTheme(seed: string): CardTheme {
  return KIND_THEMES[seed] ?? (TINTS[seedHash(seed) % TINTS.length] as CardTheme);
}
