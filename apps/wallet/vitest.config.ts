import { defineConfig } from "vitest/config";
import { credkitTsResolver } from "../../tooling/credkit-ts-resolver";

// Standalone vitest config (takes precedence over vite.config.ts) so unit
// tests of pure logic run in Node without loading the React/Tailwind plugins.
export default defineConfig({
  plugins: [credkitTsResolver()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        // @credkit/* ships TS source; inline it so imports go through the
        // vite pipeline (and the resolver plugin) instead of raw Node.
        inline: [/@credkit\//],
      },
    },
  },
});
