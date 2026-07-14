import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5177, strictPort: true },
  preview: { port: 5177, strictPort: true },
  build: {
    rollupOptions: {
      // Two real pages, no client router: the cover (with the stamped-visa
      // finale behind ?tour=stamped) and the long-form writeup.
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        writeup: fileURLToPath(new URL("writeup/index.html", import.meta.url)),
      },
    },
  },
});
