import { defineConfig } from 'vitest/config';
import { credkitTsResolver } from '../../tooling/credkit-ts-resolver';

export default defineConfig({
  plugins: [credkitTsResolver()],
  test: {
    // BBS + JSON-LD canonicalization are CPU-heavy; allow slow CI machines.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: {
      deps: {
        // @credkit/* ships TS source; inline it so imports go through the
        // vite pipeline (and the resolver plugin) instead of raw Node.
        inline: [/@credkit\//],
      },
    },
  },
});
