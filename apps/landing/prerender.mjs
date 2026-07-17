// Build-time prerender for /writeup/: renders the static Writeup component
// to HTML and injects it into the built page, so the full article text ships
// in the initial response — search engines and reader modes get the content
// without executing JS. Runs after `vite build` (see the build script); the
// client entry hydrates the markup instead of re-rendering it.
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const ssrOutDir = new URL("node_modules/.vgw-prerender/", import.meta.url);

// A separate config-less build: the entry is plain JSX with no CSS or asset
// imports, so the React/Tailwind plugins from vite.config.ts aren't needed,
// and skipping the config file avoids its two-page rollupOptions.input.
await build({
  root: fileURLToPath(new URL(".", import.meta.url)),
  configFile: false,
  logLevel: "warn",
  build: {
    ssr: "src/writeup/prerender-entry.tsx",
    outDir: fileURLToPath(ssrOutDir),
    emptyOutDir: true,
  },
});

const { render } = await import(new URL("prerender-entry.js", ssrOutDir));
const html = render();

const pagePath = new URL("dist/writeup/index.html", import.meta.url);
const page = await readFile(pagePath, "utf8");
const marker = '<div id="root"></div>';
if (!page.includes(marker)) {
  throw new Error("prerender: dist/writeup/index.html has no empty #root to fill");
}
await writeFile(pagePath, page.replace(marker, `<div id="root">${html}</div>`));
await rm(ssrOutDir, { recursive: true, force: true });

console.log(`prerendered /writeup/ (${(html.length / 1024).toFixed(1)} kB of article HTML)`);
