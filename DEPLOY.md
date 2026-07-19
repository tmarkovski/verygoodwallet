# Deployment Runbook

How the apps ship to Cloudflare Workers (static assets).

## Current state

| App | Where | Workflow |
|-----|-------|----------|
| Landing site (`apps/landing/`) | Cloudflare Worker `vgw-landing` at `verygoodwallet.com` (`www` redirects to the apex) | `.github/workflows/deploy-landing.yml` (push to `main`, or manual `workflow_dispatch`) |
| New wallet (`apps/wallet/`) | Cloudflare Worker `vgw-wallet` at `wallet.verygoodwallet.com` | `.github/workflows/deploy-wallet.yml` (push to `main`, or manual `workflow_dispatch`) |
| Utopia DMV issuer (`apps/dmv/`) | Cloudflare Worker `vgw-dmv` at `dmv.verygoodwallet.com` | `.github/workflows/deploy-dmv.yml` (push to `main`, or manual `workflow_dispatch`) |
| The Nightcap verifier (`apps/shop/`) | Cloudflare Worker `vgw-shop` at `shop.verygoodwallet.com` | `.github/workflows/deploy-shop.yml` (push to `main`, or manual `workflow_dispatch`) |
| Utopia Wheels verifier (`apps/rentals/`) | Cloudflare Worker `vgw-rentals` at `rentals.verygoodwallet.com` | `.github/workflows/deploy-rentals.yml` (push to `main`, or manual `workflow_dispatch`) |

The M6 cutover happened on 2026-07-14: the apex serves the landing site and
each app its custom domain. The `vgw-*.<account>.workers.dev` hostnames still
serve as aliases, but nothing links to them anymore.

## One-time Cloudflare setup

1. **Create a Cloudflare account** (free tier is enough) and note the
   **Account ID** (Dashboard → Workers & Pages → right sidebar, or any zone
   overview page).

2. **Create an API token**: Dashboard → My Profile → API Tokens →
   *Create Token* → *Create Custom Token* with permission
   **Account → Workers Scripts → Edit**, scoped to your account.
   Copy the token — it is shown once.

3. **Add GitHub repository secrets**
   (Repo → Settings → Secrets and variables → Actions), or via CLI:

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

## Deploying the wallet

Every push to `main` deploys automatically (so the live Worker never lags
the repo). To redeploy without a commit, run the **Deploy wallet** workflow:
Repo → Actions → *Deploy wallet* → *Run workflow* (branch `main`), or:

```sh
gh workflow run deploy-wallet.yml
```

It builds `@vgw/wallet` and runs `wrangler deploy` in `apps/wallet/`
(config: `apps/wallet/wrangler.jsonc`, assets-only Worker named `vgw-wallet`
serving `dist/` with SPA fallback). First deploy creates the Worker and prints
its `workers.dev` URL.

Local alternative from `apps/wallet/`:

```sh
pnpm --filter @vgw/wallet build
pnpm dlx wrangler deploy   # uses wrangler.jsonc; `wrangler login` first
```

## DNS migration (prerequisite for custom domains)

Subdomains and the eventual apex cutover require `verygoodwallet.com` DNS to be
hosted on Cloudflare:

1. Add `verygoodwallet.com` as a zone in the Cloudflare dashboard.
2. Change the nameservers at the registrar to the pair Cloudflare assigns.
3. Wait for the zone to go Active. (Done 2026-07-14.)

## Custom domains (M6 cutover, done 2026-07-14)

The apex went to the **landing site**, and every app got a subdomain:

| Worker | Custom domain |
|--------|---------------|
| `vgw-landing` | `verygoodwallet.com` (`www` 301s to the apex via a dashboard redirect rule) |
| `vgw-wallet` | `wallet.verygoodwallet.com` |
| `vgw-dmv` | `dmv.verygoodwallet.com` |
| `vgw-shop` | `shop.verygoodwallet.com` |
| `vgw-rentals` | `rentals.verygoodwallet.com` |

1. The domains are declared in each app's `wrangler.jsonc` as
   `routes: [{ "pattern": "<hostname>", "custom_domain": true }]`, so every
   deploy (re)asserts them — Cloudflare creates the DNS records and
   certificates; no per-deploy dashboard steps. One asymmetry learned at
   cutover: the CI token (Workers Scripts → Edit only) can *create* a
   custom-domain record on a free hostname (the four subdomains attached
   from CI), but overriding *existing* DNS records — the imported GitHub
   Pages records on the apex — fails; that one attach was done from the
   dashboard. `workers_dev: true` is set explicitly, because declaring
   routes otherwise disables the `workers.dev` alias on deploy.
2. The legacy GitHub Pages era is fully retired: `web/`, `api/`,
   `.github/workflows/deploy.yml`, the root `CNAME` file, and the repo's
   Pages site settings were all deleted after the apex was verified serving
   `vgw-landing`.
3. Flip the origin constants baked into the builds, then redeploy everything:
   - `wallet_origin` / `dmv_origin` defaults (inputs **and** job-level
     fallbacks) in `deploy-dmv.yml`, `deploy-shop.yml`, `deploy-rentals.yml` →
     `https://wallet.verygoodwallet.com` / `https://dmv.verygoodwallet.com`.
   - the `PROD_ORIGINS` tables in `apps/wallet/src/services/demoSites.ts` and
     `apps/landing/src/origins.ts`, and `PROD_RENTALS_ORIGIN` in
     `apps/shop/src/rentalsOrigin.ts`.
4. Existing passkeys are bound to the old `workers.dev` wallet origin — the
   domain move is a fresh start for wallets, by WebAuthn design.
5. Custom domains route worker-to-worker (unlike `*.workers.dev`), so the
   verifiers' deploy-time `TRUSTED_ISSUER_DID` pinning could become runtime
   discovery again after the cutover.

## Deploying the landing site

Every push to `main` deploys automatically; to redeploy without a commit run
the **Deploy Landing** workflow (`gh workflow run deploy-landing.yml`). It
builds `@vgw/landing` and runs `wrangler deploy` in `apps/landing/` (config:
`apps/landing/wrangler.jsonc`, assets-only Worker named `vgw-landing` — two
static pages, no SPA fallback, no secrets). The links to the other sites come
from build-time defaults in `apps/landing/src/origins.ts` (the custom
domains); override with `VITE_WALLET_ORIGIN` / `VITE_DMV_ORIGIN` /
`VITE_SHOP_ORIGIN` / `VITE_RENTALS_ORIGIN` at build time if needed.

## Deploying the Utopia DMV issuer

Every push to `main` deploys automatically using the workflow's default
`wallet_origin` — the wallet's custom domain. To deploy with a different
wallet origin, run the **Deploy DMV** workflow manually:
Repo → Actions → *Deploy DMV* → *Run workflow* (branch `main`), or:

```sh
gh workflow run deploy-dmv.yml -f wallet_origin=https://wallet.verygoodwallet.com
```

The workflow bakes the origin into the client bundle (`VITE_WALLET_ORIGIN`,
used for the UI's link and QR) and sets the `WALLET_ORIGIN` Worker var (used
for the server-built `wallet_link` fallback).

Unlike the assets-only wallet, the DMV is a full Worker (Hono OID4VCI
endpoints) plus static UI, built as one deployable by `@cloudflare/vite-plugin`:
`pnpm --filter @vgw/dmv build` emits `apps/dmv/dist/` including a snapshot
`wrangler.json`, and `wrangler deploy` run in `apps/dmv/` picks that snapshot
up automatically. The first deploy creates the `vgw-dmv` Worker and prints its
`workers.dev` URL.

Local alternative from `apps/dmv/` (set the wallet origin in both steps, for
the same two reasons as above):

```sh
VITE_WALLET_ORIGIN=https://wallet.verygoodwallet.com pnpm --filter @vgw/dmv build
pnpm exec wrangler deploy --var WALLET_ORIGIN:https://wallet.verygoodwallet.com
# picks up dist/vgw_dmv/wrangler.json; `wrangler login` first
```

(`wrangler` is a devDependency of `apps/dmv`, so `pnpm exec` uses the pinned
version — no `dlx` download needed.)

To sanity-check a built bundle before deploying, `pnpm --filter @vgw/dmv smoke`
boots `dist/` under workerd and fetches the issuer metadata — the same check
CI runs, catching bundles that would fail Cloudflare's script-startup
validation.

### Worker secrets (set after the first deploy)

The issuer signs credentials with a BBS key derived from `ISSUER_SEED` and
signs its stateless OAuth codes/tokens with `TOKEN_SECRET`. Both have
hardcoded dev fallbacks (public in the repo) so local dev needs zero setup —
the Worker logs a `console.warn` whenever a fallback is in use. **Production
must not rely on them**: anything signed under the dev seed is worthless.

From `apps/dmv/` (or via Dashboard → `vgw-dmv` → Settings → Variables):

```sh
openssl rand -hex 32 | pnpm exec wrangler secret put ISSUER_SEED
openssl rand -hex 32 | pnpm exec wrangler secret put TOKEN_SECRET
```

Note: rotating `ISSUER_SEED` changes the issuer DID, invalidating previously
issued credentials for verifiers pinned to the old DID — and it also rotates
the revocation registry's trapdoor and seeded initial accumulator (both
derive from the same seed under their own DSTs), orphaning every issued
witness.

The DMV also carries the `RevocationRegistry` **Durable Object**
(SQLite-backed, Workers Free plan): one instance holding the accumulator
value, epoch counter, published update log, and the issued-credential rows
the "Records & revocation" desk lists. The first deploy runs the `v1`
migration from `wrangler.jsonc` automatically. The registry's public state
serves at `GET /api/registry` (advertised as `vgw_revocation_registry` in the
issuer metadata); verifiers fetch it at verification time, so the DMV origin
must be reachable from the verifier Workers (custom domains — see the
worker-to-worker caveat below).

### Wallet origin

The wallet origin must point at a host that actually serves the wallet app —
a wrong value produces offer links and QR codes that dead-end, and delivers
the PII-bearing offer code to the wrong host. Two settings, both handled by
the Deploy DMV workflow's `wallet_origin` input (default:
`https://wallet.verygoodwallet.com`):

- `VITE_WALLET_ORIGIN` (build-time) — baked into the client bundle; the UI
  builds the visible link and QR from it. Without it the UI shows a
  "no wallet configured" notice instead of a link (a `?wallet=<origin>`
  query param overrides it per visit).
- `WALLET_ORIGIN` (Worker var, plaintext) — used for the server-built
  `wallet_link`; when unset the Worker omits `wallet_link` from `/api/offers`
  responses (and logs a warning) rather than emitting a wrong link. In dev, a
  localhost caller's own origin is used instead.

Both values are normalized to a bare origin; a value that isn't an absolute
URL makes the Worker fail `/api/offers` loudly instead of falling back.

### Custom domain

`dmv.verygoodwallet.com` is declared in `apps/dmv/wrangler.jsonc`
(`routes`, `custom_domain: true`) and attaches on every deploy.

## Deploying The Nightcap verifier (shop)

Every push to `main` deploys automatically using the workflow's defaults —
the wallet and DMV custom domains. To deploy with different origins, run
the **Deploy Shop** workflow manually:

```sh
gh workflow run deploy-shop.yml \
  -f wallet_origin=https://wallet.verygoodwallet.com \
  -f dmv_origin=https://dmv.verygoodwallet.com
```

Same Worker + assets shape as the DMV (Hono OID4VP endpoints + static UI via
`@cloudflare/vite-plugin`), plus one extra piece: the `VerificationSessions`
**Durable Object** (SQLite-backed, available on the Workers Free plan) that
holds each verification session's outcome so cross-device polls read their
writes. The first deploy runs the `v1` migration from `wrangler.jsonc`
automatically.

Configuration, all handled by the workflow:

- `VITE_WALLET_ORIGIN` (build-time) / `WALLET_ORIGIN` (Worker var) — same
  two-channel wallet-origin story as the DMV, but for `/present` links.
- `TRUSTED_ISSUER_DID` (Worker var) — the issuer DID verification pins. The
  workflow discovers it at deploy time from the DMV's issuer metadata
  (`vgw_issuer_did`), because worker-to-worker fetches between
  `*.workers.dev` hosts on the same account don't route to the target
  Worker. Consequence: **rotating the DMV's `ISSUER_SEED` requires
  redeploying the shop.**
- `DMV_ORIGIN` (Worker var) — the runtime-discovery fallback used when no
  DID is pinned; works in dev (localhost) and, post-M6, across custom
  domains.

### Worker secret (set after the first deploy)

The shop signs its stateless OID4VP `state` values with `TOKEN_SECRET`
(public dev fallback until set). From `apps/shop/`:

```sh
openssl rand -hex 32 | pnpm exec wrangler secret put TOKEN_SECRET
```

Note: rotating the DMV's `ISSUER_SEED` changes the issuer DID; redeploy the
shop afterwards so its pinned `TRUSTED_ISSUER_DID` follows. Credentials
issued under the old seed stop verifying either way.

### Live end-to-end check

With both dev servers running (`pnpm dev:dmv`, `pnpm dev:shop`):

```sh
VGW_E2E=1 pnpm --filter @vgw/shop test
```

runs `apps/shop/worker/e2e.test.ts` — the BUILT DMV Worker blind-issues a
credkit DL, the suite runs the wallet-side crypto (holder binding, receipt
check, params pinning, `presentGraph`) in-process, and the BUILT shop Worker
verifies the WHOLE presentation server-side: tier-1 disclosure, the under-18
prover fail-closed throw, a replay rejection against the live Durable
Object, and the tier-2 range-proof round trip ending in one Worker verdict —
no client-side verification step exists anymore. (Skipped without
`VGW_E2E=1`.)

## Deploying the Utopia Wheels verifier (rentals)

Identical shape to the shop — one Hono OID4VP Worker + static UI +
`VerificationSessions` Durable Object — deployed by **Deploy Rentals**
(`deploy-rentals.yml`) on every push to `main`, with the same
`wallet_origin`/`dmv_origin` inputs and the same deploy-time
`TRUSTED_ISSUER_DID` discovery. What differs is only the policy: the rentals
DCQL profile requires `given_name` + `family_name` + `document_number` in
every claim_set alternative, and gates on **over-25** (age_over_25 flag /
birth_date fallback / `vgw_predicates` range proof over the hidden
birth-date twin with a 25-year cutoff).

The same consequences follow: rotating the DMV's `ISSUER_SEED` requires
redeploying the rentals Worker too (its issuer pin is discovered at deploy
time), and the `TOKEN_SECRET` Worker secret should be set after the first
deploy, from `apps/rentals/`:

```sh
openssl rand -hex 32 | pnpm exec wrangler secret put TOKEN_SECRET
```

### Live end-to-end check (rentals)

With all three dev servers running (`pnpm dev:dmv`, `pnpm dev:shop`,
`pnpm dev:rentals` — the shop is needed for the cross-verifier test):

```sh
VGW_E2E=1 pnpm --filter @vgw/rentals test
```

runs `apps/rentals/worker/e2e.test.ts` — the over-25 clearance with identity
disclosed, the 22-year-old denial (over 18 is not over 25), a replay
rejection, the tier-2 over-25 range-proof round trip, the live cutoff-policy
rejection, and the unlinkability exhibit end to end: one credential
presented to both live verifiers, asserting NEITHER recorded any holder
identifier (the credkit presentation carries none) and that no disclosed
value appears in both records.

(The pre-credkit "ZK circuit artifacts" section is gone with `packages/zk`:
there is no circuit to compile, no verification key to pin, and no
client-side verification step — credkit range proofs are pure JS and the
whole verdict is computed in each verifier's Worker.)
