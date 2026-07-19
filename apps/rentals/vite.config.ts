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
//
// (The pre-N4 `define: { "import.meta.url": ... }` workaround is gone: it
// pinned import.meta.url for @digitalbazaar/credentials-context's
// module-scope `new URL(...)`, which workerd rejects at script startup —
// and that package left the Worker bundle with the bbs-2023 rip-out. The
// smoke script still boots the built bundle under workerd to prove it.)
export default defineConfig({
  plugins: [credkitTsResolver(), react(), tailwindcss(), cloudflare()],
  optimizeDeps: {
    // @credkit/* is TS source (.js specifiers) served through the resolver
    // plugin pipeline, which dev prebundling would bypass.
    exclude: ["@credkit/bbs", "@credkit/range", "@credkit/proofs", "@credkit/cryptosuite", "@credkit/accumulator"],
  },
  server: {
    port: 5176,
    strictPort: true,
  },
});
