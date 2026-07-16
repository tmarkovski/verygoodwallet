import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { credkitTsResolver } from "../../tooling/credkit-ts-resolver";

export default defineConfig({
  plugins: [credkitTsResolver(), react(), tailwindcss()],
  optimizeDeps: {
    // @credkit/* is TS source (.js specifiers) served through the resolver
    // plugin pipeline, which dev prebundling would bypass.
    exclude: [
      "@credkit/bbs",
      "@credkit/range",
      "@credkit/proofs",
      "@credkit/cryptosuite",
    ],
  },
});
