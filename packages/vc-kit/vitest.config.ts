import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // BBS + JSON-LD canonicalization are CPU-heavy; allow slow CI machines.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
