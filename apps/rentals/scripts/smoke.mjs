#!/usr/bin/env node
/**
 * Smoke-tests the BUILT Worker bundle under workerd.
 *
 * `wrangler dev` follows the .wrangler/deploy redirect to
 * dist/vgw_rentals/wrangler.json — the exact artifact `wrangler deploy`
 * uploads — so this catches script-startup failures that only exist in the
 * Cloudflare runtime (module-scope `new URL(..., import.meta.url)` in a
 * bundled dep, non-handler named exports, a broken Durable Object
 * migration). Beyond booting, it exercises the session lifecycle: create a
 * verification session, then poll its status — which round-trips through
 * the VerificationSessions Durable Object under real workerd.
 *
 * Usage (after `pnpm --filter @vgw/rentals build`):
 *   pnpm --filter @vgw/rentals smoke
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.SMOKE_PORT ?? 8978);
const startupTimeoutMs = 90_000;

if (!existsSync(path.join(appDir, "dist/vgw_rentals/wrangler.json"))) {
  console.error("smoke: dist/vgw_rentals/wrangler.json missing — run `pnpm --filter @vgw/rentals build` first");
  process.exit(1);
}

// The deploy snapshot carries the custom-domain routes, which make
// `wrangler dev` simulate the production hostname instead of localhost.
// Boot a routeless copy (same directory, so relative paths in the config
// resolve identically) — script startup is what's under test, not routing.
const smokeConfig = "dist/vgw_rentals/wrangler.smoke.json";
const { routes: _routes, ...config } = JSON.parse(
  readFileSync(path.join(appDir, "dist/vgw_rentals/wrangler.json"), "utf8"),
);
writeFileSync(path.join(appDir, smokeConfig), JSON.stringify(config, null, 2));

// detached: the child leads its own process group, so killing -pid takes the
// workerd children wrangler spawns down with it.
const wrangler = spawn(
  "pnpm",
  ["exec", "wrangler", "dev", "--config", smokeConfig, "--port", String(port), "--inspector-port", "0"],
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
let session;
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
    const res = await fetch(`http://127.0.0.1:${port}/api/verification`, { method: "POST" });
    if (res.ok) {
      session = await res.json();
      break;
    }
    fail(`session creation returned HTTP ${res.status}`);
  } catch {
    await sleep(500); // not listening yet
  }
}

if (typeof session.session_id !== "string" || session.request?.response_type !== "vp_token") {
  fail(`unexpected session body: ${JSON.stringify(session).slice(0, 300)}`);
}

// Round-trip the Durable Object: an unanswered session must report pending.
const statusRes = await fetch(`http://127.0.0.1:${port}/api/verification/${session.session_id}`);
if (!statusRes.ok) {
  fail(`status endpoint returned HTTP ${statusRes.status}`);
}
const status = await statusRes.json();
if (status.status !== "pending") {
  fail(`expected a pending session, got: ${JSON.stringify(status)}`);
}

console.log("smoke: OK — built Worker bundle boots under workerd, serves sessions, and the Durable Object answers");
cleanup();
