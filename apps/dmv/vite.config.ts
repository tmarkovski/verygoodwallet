import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The cloudflare plugin reads wrangler.jsonc: `vite dev` runs the Worker and
// the React UI together on one origin; `vite build` emits a deployable
// Worker + assets bundle under dist/.
//
// Port 5174 (strict) so the wallet (5173) and the DMV run side by side.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: {
    port: 5174,
    strictPort: true,
  },
});
