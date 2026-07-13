import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The cloudflare plugin reads wrangler.jsonc: `vite dev` runs the Worker and
// the React UI together on one origin; `vite build` emits a deployable
// Worker + assets bundle under dist/.
//
// Port 5175 (strict) so the wallet (5173), the DMV (5174) and the shop run
// side by side.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  environments: {
    // Same workerd startup workaround as apps/dmv: pin import.meta.url for
    // @digitalbazaar/credentials-context's module-scope `new URL(...)`, which
    // otherwise throws under workerd and kills the Worker at script startup.
    // Guarded by scripts/smoke.mjs.
    vgw_shop: {
      define: {
        "import.meta.url": JSON.stringify("file:///worker/index.js"),
      },
    },
  },
  server: {
    port: 5175,
    strictPort: true,
  },
});
