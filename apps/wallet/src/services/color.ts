/**
 * Deterministic card engraving: a credential's `meta.colorSeed` selects the
 * line-work ink of its guilloché face (see `.guilloche` in index.css).
 * Every card shares the same deep-petrol plate — in both UI themes, like
 * physical cards in a wallet — and only the engraving tint varies, the way
 * different denominations of one currency share a printing style.
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

export interface CardTheme {
  tint: EngravingTint;
  /** Ink of the top-right line field (`--guilloche-line-a`). */
  lineA: string;
  /** Ink of the bottom-left line field (`--guilloche-line-b`). */
  lineB: string;
}

/**
 * The four engraving inks. Opacities are tuned per tint so each reads as
 * the same faint line-work against the petrol plate.
 */
const TINTS: readonly CardTheme[] = [
  {
    tint: "cream",
    lineA: "rgb(236 231 211 / 0.05)",
    lineB: "rgb(236 231 211 / 0.038)",
  },
  {
    tint: "gold",
    lineA: "rgb(201 168 106 / 0.062)",
    lineB: "rgb(201 168 106 / 0.048)",
  },
  {
    tint: "verdigris",
    lineA: "rgb(127 199 168 / 0.055)",
    lineB: "rgb(127 199 168 / 0.042)",
  },
  {
    tint: "faded-red",
    lineA: "rgb(224 126 126 / 0.05)",
    lineB: "rgb(224 126 126 / 0.038)",
  },
];

/** Engraving tint (guilloché line inks) for a color seed. */
export function cardTheme(seed: string): CardTheme {
  return TINTS[seedHash(seed) % TINTS.length] as CardTheme;
}
