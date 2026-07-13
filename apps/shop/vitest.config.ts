import { defineConfig } from "vitest/config";

// Standalone vitest config (takes precedence over vite.config.ts) so the
// Worker tests run in plain Node without the React/Tailwind/Cloudflare
// plugins. The Durable Object namespace is stubbed in-memory by the tests —
// the stub drives the REAL VerificationSessions class against a Map-backed
// storage, so the session logic itself is what's under test.
export default defineConfig({
  test: {
    environment: "node",
    include: ["worker/**/*.test.ts"],
  },
});
