import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // The ZK proving stack loads WASM relative to import.meta.url; esbuild
    // prebundling would relocate the JS away from its .wasm files and break
    // `vite dev` (production builds are unaffected). Standard NoirJS setup.
    exclude: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/noirc_abi", "@noir-lang/acvm_js"],
  },
  server: {
    // Mirror the deployed public/_headers: crossOriginIsolated unlocks
    // multithreaded bb.js in dev too (single-threaded proving is ~10x slower).
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
