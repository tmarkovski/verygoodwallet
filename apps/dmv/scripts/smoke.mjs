#!/usr/bin/env node
/**
 * Smoke-tests the BUILT Worker bundle under workerd.
 *
 * `wrangler dev` follows the .wrangler/deploy redirect to
 * dist/vgw_dmv/wrangler.json — the exact artifact `wrangler deploy` uploads —
 * so this catches script-startup failures that only exist in the Cloudflare
 * runtime (e.g. module-scope `new URL(..., import.meta.url)` in a bundled
 * dep, or non-handler named exports on the entry module). Nothing else
 * exercises that artifact: vitest runs the Worker in plain Node and
 * `vite dev` serves unbundled modules, so without this check CI stays green
 * while the deployed Worker is dead on arrival.
 *
 * Usage (after `pnpm --filter @vgw/dmv build`):
 *   pnpm --filter @vgw/dmv smoke
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.SMOKE_PORT ?? 8976);
const startupTimeoutMs = 90_000;

if (!existsSync(path.join(appDir, "dist/vgw_dmv/wrangler.json"))) {
  console.error("smoke: dist/vgw_dmv/wrangler.json missing — run `pnpm --filter @vgw/dmv build` first");
  process.exit(1);
}

// detached: the child leads its own process group, so killing -pid takes the
// workerd children wrangler spawns down with it.
const wrangler = spawn(
  "pnpm",
  ["exec", "wrangler", "dev", "--port", String(port), "--inspector-port", "0"],
  { cwd: appDir, detached: true, stdio: ["ignore", "pipe", "pipe"] },
);

let output = "";
wrangler.stdout.on("data", (chunk) => (output += chunk));
wrangler.stderr.on("data", (chunk) => (output += chunk));

let exited = false;
wrangler.on("exit", () => {
  exited = true;
});

function cleanup() {
  if (!exited && wrangler.pid !== undefined) {
    try {
      process.kill(-wrangler.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

function fail(message) {
  console.error(`smoke: FAIL — ${message}`);
  console.error("--- wrangler output ---");
  console.error(output);
  cleanup();
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const deadline = Date.now() + startupTimeoutMs;
let metadata;
for (;;) {
  // "failed to start" is terminal even though wrangler dev keeps running —
  // don't wait out the full timeout on a bundle workerd already rejected.
  if (exited || output.includes("The Workers runtime failed to start")) {
    fail("workerd rejected the built bundle at script startup");
  }
  if (Date.now() > deadline) {
    fail(`no response from workerd within ${startupTimeoutMs / 1000}s`);
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/openid-credential-issuer`);
    if (res.ok) {
      metadata = await res.json();
      break;
    }
    fail(`metadata endpoint returned HTTP ${res.status}`);
  } catch {
    await sleep(500); // not listening yet
  }
}

if (metadata.credential_issuer !== `http://127.0.0.1:${port}`) {
  fail(`unexpected credential_issuer: ${JSON.stringify(metadata.credential_issuer)}`);
}

console.log("smoke: OK — built Worker bundle boots under workerd and serves issuer metadata");
cleanup();
