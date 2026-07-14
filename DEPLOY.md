# Deployment Runbook

How the new apps ship to Cloudflare Workers (static assets), and what stays on
GitHub Pages until cutover.

## Current state

| App | Where | Workflow |
|-----|-------|----------|
| Legacy CRA app (`web/`) | GitHub Pages at `verygoodwallet.com` | `.github/workflows/deploy.yml` (push to `main`) — **stays live until M6 cutover** |
| New wallet (`apps/wallet/`) | Cloudflare Worker `vgw-wallet` at `vgw-wallet.<account>.workers.dev` | `.github/workflows/deploy-wallet.yml` (push to `main`, or manual `workflow_dispatch`) |
| Utopia DMV issuer (`apps/dmv/`) | Cloudflare Worker `vgw-dmv` at `vgw-dmv.<account>.workers.dev` | `.github/workflows/deploy-dmv.yml` (push to `main`, or manual `workflow_dispatch`) |
| The Nightcap verifier (`apps/shop/`) | Cloudflare Worker `vgw-shop` at `vgw-shop.<account>.workers.dev` | `.github/workflows/deploy-shop.yml` (push to `main`, or manual `workflow_dispatch`) |
| Utopia Wheels verifier (`apps/rentals/`) | Cloudflare Worker `vgw-rentals` at `vgw-rentals.<account>.workers.dev` | `.github/workflows/deploy-rentals.yml` (push to `main`, or manual `workflow_dispatch`) |
| Landing site (`apps/landing/`) | Cloudflare Worker `vgw-landing` at `vgw-landing.<account>.workers.dev` | `.github/workflows/deploy-landing.yml` (push to `main`, or manual `workflow_dispatch`) |

Until DNS moves and M6 cutover happens, the new wallet is only reachable on its
`workers.dev` URL. The apex domain keeps pointing at GitHub Pages.

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

1. Add `verygoodwallet.com` as a zone in the Cloudflare dashboard. Cloudflare
   imports existing records — verify the GitHub Pages records (apex A/AAAA to
   GitHub Pages IPs, plus the `www`/CNAME setup if present) survive the import
   so the legacy site stays up.
2. Change the nameservers at the registrar to the pair Cloudflare assigns.
3. Wait for the zone to go Active. The legacy GitHub Pages site continues to
   serve the apex — nothing about it changes at this step. If Pages HTTPS
   breaks after migration, set the imported apex/`www` records to **DNS only**
   (grey cloud) so GitHub can renew its certificate.

## Custom domains (M6 cutover)

At M6 cutover (not before — the apex still serves the legacy app). The apex
goes to the **landing site**, and every app gets a subdomain:

| Worker | Custom domain |
|--------|---------------|
| `vgw-landing` | `verygoodwallet.com` (and `www.verygoodwallet.com`) |
| `vgw-wallet` | `wallet.verygoodwallet.com` |
| `vgw-dmv` | `dmv.verygoodwallet.com` |
| `vgw-shop` | `shop.verygoodwallet.com` |
| `vgw-rentals` | `rentals.verygoodwallet.com` |

1. For each Worker: Dashboard → Workers & Pages → *Settings* → Domains &
   Routes → *Add* → **Custom domain**. Cloudflare creates the record and
   certificate automatically (the apex assignment replaces the GitHub Pages
   records).
2. Delete `.github/workflows/deploy.yml`, the root `CNAME` file, and the
   GitHub Pages site settings; `web/` and `api/` are deleted per PLAN.md M6.
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
from build-time defaults in `apps/landing/src/origins.ts` (live Worker
origins until the cutover flips them); override with `VITE_WALLET_ORIGIN` /
`VITE_DMV_ORIGIN` / `VITE_SHOP_ORIGIN` / `VITE_RENTALS_ORIGIN` at build time
if needed.

## Deploying the Utopia DMV issuer

Every push to `main` deploys automatically using the workflow's default
`wallet_origin` — the live wallet Worker URL (until the M6 apex cutover, the
apex still serves the legacy app, which cannot handle offers). To deploy
with a different wallet origin, run the **Deploy DMV** workflow manually:
Repo → Actions → *Deploy DMV* → *Run workflow* (branch `main`), or:

```sh
gh workflow run deploy-dmv.yml -f wallet_origin=https://vgw-wallet.<account>.workers.dev
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
VITE_WALLET_ORIGIN=https://vgw-wallet.<account>.workers.dev pnpm --filter @vgw/dmv build
pnpm exec wrangler deploy --var WALLET_ORIGIN:https://vgw-wallet.<account>.workers.dev
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
issued credentials for verifiers pinned to the old DID.

### Wallet origin (required until the M6 apex cutover)

There is **no production default** wallet origin: pre-cutover the apex serves
the legacy GitHub Pages app, which has no `/offer` route, so any guessed
default would produce offer links and QR codes that dead-end — and deliver
the PII-bearing offer code to the wrong host. Two settings, both handled by
the Deploy DMV workflow's `wallet_origin` input:

- `VITE_WALLET_ORIGIN` (build-time) — baked into the client bundle; the UI
  builds the visible link and QR from it. Without it the UI shows a
  "no wallet configured" notice instead of a link (a `?wallet=<origin>`
  query param overrides it per visit).
- `WALLET_ORIGIN` (Worker var, plaintext) — used for the server-built
  `wallet_link`; when unset the Worker omits `wallet_link` from `/api/offers`
  responses (and logs a warning) rather than emitting a wrong link. In dev, a
  localhost caller's own origin is used instead.

Both values are normalized to a bare origin; a value that isn't an absolute
URL makes the Worker fail `/api/offers` loudly instead of falling back. After
M6 puts the new wallet on the apex, `https://verygoodwallet.com` becomes the
value to set (or a default can be reinstated then).

### Custom domain

`dmv.verygoodwallet.com` can be attached once DNS is on Cloudflare — this
works **before** the apex cutover, since a subdomain doesn't collide with the
legacy GitHub Pages site: Dashboard → Workers & Pages → `vgw-dmv` → Settings →
Domains & Routes → *Add* → **Custom domain**.

## Deploying The Nightcap verifier (shop)

Every push to `main` deploys automatically using the workflow's defaults —
the live wallet and DMV Worker URLs. To deploy with different origins, run
the **Deploy Shop** workflow manually:

```sh
gh workflow run deploy-shop.yml \
  -f wallet_origin=https://vgw-wallet.<account>.workers.dev \
  -f dmv_origin=https://vgw-dmv.<account>.workers.dev
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

runs `apps/shop/worker/e2e.test.ts` — real issuance at the dev DMV, a real
tier-1 presentation into the dev shop, the under-18 denial, a replay
rejection against the live Durable Object, and the tier-2 flow: a real
UltraHonk proof round-trips, the Worker records it, and the suite verifies
the stored payload with the same `@vgw/zk` call the shop client makes.
(Skipped without `VGW_E2E=1`.)

## Deploying the Utopia Wheels verifier (rentals)

Identical shape to the shop — one Hono OID4VP Worker + static UI +
`VerificationSessions` Durable Object — deployed by **Deploy Rentals**
(`deploy-rentals.yml`) on every push to `main`, with the same
`wallet_origin`/`dmv_origin` inputs and the same deploy-time
`TRUSTED_ISSUER_DID` discovery. What differs is only the policy: the rentals
DCQL profile requires `given_name` + `family_name` + `document_number` in
every claim_set alternative, and gates on **over-25** (age_over_25 flag /
birth_date fallback / ZK predicate over the same birthdate commitment with
`vgw_zk.years: 25`).

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
rejection, the tier-2 over-25 proof round trip, the live cutoff-policy
rejection, and the M5 unlinkability exhibit end to end: one credential
presented to both live verifiers, asserting each recorded a different
pairwise presenter DID and that no disclosed value appears in both records.

### ZK circuit artifacts (packages/zk)

The tier-2 circuit ships as checked-in artifacts (`packages/zk/artifacts/`):
the compiled Noir program and the UltraHonk verification key. After editing
`packages/zk/circuit/` or bumping the pinned `@noir-lang/*`/`@aztec/bb.js`
versions, regenerate with:

```sh
pnpm --filter @vgw/zk compile
```

A test recompiles the circuit and fails CI if the checked-in artifact is
stale. Note the trust split baked into the design: the verifier Workers
validate everything about a tier-2 presentation EXCEPT the UltraHonk proof
(Workers cannot instantiate WASM from bytes, and bb.js wouldn't fit the free
plan's 3 MiB script cap); the proof itself is verified by each verifier's
client against the verification key bundled into its build. Redeploying the
shop and rentals Workers after regenerating artifacts keeps prover and
verifiers in agreement.
