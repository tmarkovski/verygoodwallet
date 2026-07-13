# Deployment Runbook

How the new apps ship to Cloudflare Workers (static assets), and what stays on
GitHub Pages until cutover.

## Current state

| App | Where | Workflow |
|-----|-------|----------|
| Legacy CRA app (`web/`) | GitHub Pages at `verygoodwallet.com` | `.github/workflows/deploy.yml` (push to `main`) — **stays live until M6 cutover** |
| New wallet (`apps/wallet/`) | Cloudflare Worker `vgw-wallet` at `vgw-wallet.<account>.workers.dev` | `.github/workflows/deploy-wallet.yml` (manual `workflow_dispatch`) |
| Utopia DMV issuer (`apps/dmv/`) | Cloudflare Worker `vgw-dmv` at `vgw-dmv.<account>.workers.dev` | `.github/workflows/deploy-dmv.yml` (manual `workflow_dispatch`) |

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

Run the **Deploy wallet** workflow: Repo → Actions → *Deploy wallet* →
*Run workflow* (branch `main`), or:

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

## Custom domain for the wallet

At M6 cutover (not before — the apex still serves the legacy app):

1. Dashboard → Workers & Pages → `vgw-wallet` → Settings → Domains & Routes →
   *Add* → **Custom domain** → `verygoodwallet.com`. Cloudflare creates the
   record and certificate automatically (this replaces the GitHub Pages apex
   records).
2. Delete `.github/workflows/deploy.yml`, the root `CNAME` file, and the
   GitHub Pages site settings; `web/` and `api/` are deleted per PLAN.md M6.
3. Optionally add a push trigger to `deploy-wallet.yml` now that secrets exist.

## Deploying the Utopia DMV issuer

Run the **Deploy DMV** workflow: Repo → Actions → *Deploy DMV* →
*Run workflow* (branch `main`), or:

```sh
gh workflow run deploy-dmv.yml
```

Unlike the assets-only wallet, the DMV is a full Worker (Hono OID4VCI
endpoints) plus static UI, built as one deployable by `@cloudflare/vite-plugin`:
`pnpm --filter @vgw/dmv build` emits `apps/dmv/dist/` including a snapshot
`wrangler.json`, and `wrangler deploy` run in `apps/dmv/` picks that snapshot
up automatically. The first deploy creates the `vgw-dmv` Worker and prints its
`workers.dev` URL.

Local alternative from `apps/dmv/`:

```sh
pnpm --filter @vgw/dmv build
pnpm exec wrangler deploy   # picks up dist/vgw_dmv/wrangler.json; `wrangler login` first
```

(`wrangler` is a devDependency of `apps/dmv`, so `pnpm exec` uses the pinned
version — no `dlx` download needed.)

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

Optional: set a `WALLET_ORIGIN` var (plaintext, not a secret) to control the
wallet origin in server-built `wallet_link`s. Without it the Worker defaults
to `https://verygoodwallet.com` (or a localhost caller's own origin in dev);
the DMV UI also supports a `?wallet=<origin>` override client-side.

### Custom domain

`dmv.verygoodwallet.com` can be attached once DNS is on Cloudflare — this
works **before** the apex cutover, since a subdomain doesn't collide with the
legacy GitHub Pages site: Dashboard → Workers & Pages → `vgw-dmv` → Settings →
Domains & Routes → *Add* → **Custom domain**.

## Future apps (per PLAN.md)

The verifier apps deploy the same way — one Worker each, mapped to a
subdomain custom domain once DNS is on Cloudflare (subdomains can be mapped
before the apex cutover, since they don't collide with GitHub Pages):

| App | Worker (suggested) | Custom domain |
|-----|--------------------|---------------|
| The Nightcap (verifier) | `vgw-shop` | `shop.verygoodwallet.com` |
| Utopia Wheels (verifier) | `vgw-rentals` | `rentals.verygoodwallet.com` |

These carry OID4VP Worker endpoints (not assets-only), so they will follow
the DMV's Worker + assets shape rather than the wallet's assets-only one.
