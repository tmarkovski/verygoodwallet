import { defineConfig } from "vitest/config";

// Standalone vitest config (takes precedence over vite.config.ts) so the
// Worker tests run in plain Node without the React/Tailwind/Cloudflare
// plugins — the Worker is WebCrypto + pure JS, no CF-only APIs.
export default defineConfig({
  test: {
    environment: "node",
    include: ["worker/**/*.test.ts"],
  },
});
