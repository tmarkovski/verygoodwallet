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
//
// (The pre-N4 `define: { "import.meta.url": ... }` workaround is gone: it
// pinned import.meta.url for @digitalbazaar/credentials-context's
// module-scope `new URL(...)`, which workerd rejects at script startup —
// and that package left the Worker bundle with the bbs-2023 rip-out. The
// smoke script still boots the built bundle under workerd to prove it.)
export default defineConfig({
  plugins: [credkitTsResolver(), react(), tailwindcss(), cloudflare()],
  optimizeDeps: {
    // @credkit/* is TS source (.js specifiers); dev prebundling runs its own
    // esbuild without the resolver plugin, so serve it through the plugin
    // pipeline instead.
    exclude: ["@credkit/bbs", "@credkit/range", "@credkit/proofs", "@credkit/cryptosuite"],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
