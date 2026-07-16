import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { credkitTsResolver } from "../../tooling/credkit-ts-resolver";

// The cloudflare plugin reads wrangler.jsonc: `vite dev` runs the Worker and
// the React UI together on one origin; `vite build` emits a deployable
// Worker + assets bundle under dist/.
//
// Port 5174 (strict) so the wallet (5173) and the DMV run side by side.
export default defineConfig({
  plugins: [credkitTsResolver(), react(), tailwindcss(), cloudflare()],
  optimizeDeps: {
    // @credkit/* is TS source (.js specifiers); dev prebundling runs its own
    // esbuild without the resolver plugin, so serve it through the plugin
    // pipeline instead.
    exclude: ["@credkit/bbs", "@credkit/range", "@credkit/proofs", "@credkit/cryptosuite"],
  },
  environments: {
    // The Worker bundle pulls in @digitalbazaar/credentials-context, whose
    // module scope runs `new URL(..., import.meta.url)` for context metadata
    // that is never dereferenced (vc-kit's loader serves the bundled JSON
    // contexts). workerd gives bundled modules no valid base URL, so that
    // throws during script startup — the deployed Worker would be dead on
    // arrival. Pin import.meta.url to a fixed file: URL in the Worker
    // environment only; the client build keeps the real thing. Guarded by
    // scripts/smoke.mjs, which boots the built bundle under workerd.
    vgw_dmv: {
      define: {
        "import.meta.url": JSON.stringify("file:///worker/index.js"),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
