import { defineConfig } from "vitest/config";

// Standalone vitest config (takes precedence over vite.config.ts) so unit
// tests of pure logic run in Node without loading the React/Tailwind plugins.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
