import { defineConfig } from "vitest/config";
import { credkitTsResolver } from "../../tooling/credkit-ts-resolver";

// Standalone vitest config (takes precedence over vite.config.ts) so the
// Worker tests run in plain Node without the React/Tailwind/Cloudflare
// plugins — the Worker is WebCrypto + pure JS, no CF-only APIs.
export default defineConfig({
  plugins: [credkitTsResolver()],
  test: {
    environment: "node",
    include: ["worker/**/*.test.ts"],
    server: {
      deps: {
        // @credkit/* ships TS source; inline it so imports go through the
        // vite pipeline (and the resolver plugin) instead of raw Node.
        inline: [/@credkit\//],
      },
    },
  },
});
