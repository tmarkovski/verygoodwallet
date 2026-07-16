import { defineConfig } from "vitest/config";
import { credkitTsResolver } from "../../tooling/credkit-ts-resolver";

export default defineConfig({
  plugins: [credkitTsResolver()],
  test: {
    server: {
      deps: {
        // @credkit/* ships TS source; inline it so imports go through the
        // vite pipeline (and the resolver plugin) instead of raw Node.
        inline: [/@credkit\//],
      },
    },
  },
});
