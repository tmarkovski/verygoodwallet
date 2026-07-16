import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { credkitTsResolver } from "../../tooling/credkit-ts-resolver";

// The cloudflare plugin reads wrangler.jsonc: `vite dev` runs the Worker and
// the React UI together on one origin; `vite build` emits a deployable
// Worker + assets bundle under dist/.
//
// Port 5176 (strict) so the wallet (5173), the DMV (5174), the shop (5175)
// and the rentals site run side by side.
export default defineConfig({
  plugins: [credkitTsResolver(), react(), tailwindcss(), cloudflare()],
  environments: {
    // Same workerd startup workaround as apps/dmv and apps/shop: pin
    // import.meta.url for @digitalbazaar/credentials-context's module-scope
    // `new URL(...)`, which otherwise throws under workerd and kills the
    // Worker at script startup. Guarded by scripts/smoke.mjs.
    vgw_rentals: {
      define: {
        "import.meta.url": JSON.stringify("file:///worker/index.js"),
      },
    },
  },
  optimizeDeps: {
    // The rentals client lazy-loads bb.js for UltraHonk verification;
    // esbuild prebundling would relocate its JS away from the WASM it
    // fetches relative to import.meta.url (dev-mode only issue). @credkit/*
    // is TS source (.js specifiers) served through the resolver plugin
    // pipeline, which dev prebundling would bypass.
    exclude: ["@aztec/bb.js", "@credkit/bbs", "@credkit/range", "@credkit/proofs", "@credkit/cryptosuite"],
  },
  server: {
    port: 5176,
    strictPort: true,
    // Mirror the deployed public/_headers: crossOriginIsolated unlocks
    // multithreaded bb.js in dev too (single-threaded verify is ~6x slower).
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
