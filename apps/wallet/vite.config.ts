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
      // Missing an entry here is not a perf detail: a prebundled @credkit
      // package gets its own inlined @noble/curves, and cross-instance
      // point ops throw — every pairing check quietly returns false in dev.
      "@credkit/accumulator",
    ],
    // CJS deps under the excluded packages still need prebundling — served
    // raw, `import jsonld from "jsonld"` has no default export and module
    // evaluation dies silently (blank page in dev). The chains start at the
    // workspace package so they resolve through pnpm's nested node_modules.
    include: [
      "@vgw/vc-kit > @credkit/cryptosuite > jsonld",
      "@vgw/vc-kit > @credkit/cryptosuite > @digitalbazaar/di-sd-primitives > jsonld",
      "@vgw/vc-kit > @credkit/cryptosuite > @digitalbazaar/di-sd-primitives > rdf-canonize",
    ],
  },
});
