# VeryGoodWallet

**Your passkey is the wallet.** A working demo of passkey-native digital identity:
an issuer, a wallet, and two verifiers — real protocols, real cryptography,
free-tier infrastructure.

**Live: [verygoodwallet.com](https://verygoodwallet.com)** — take the
[guided tour](https://verygoodwallet.com) (~3 minutes) or read the
[technical writeup](https://verygoodwallet.com/writeup/).

## The thesis

Digital identity wallets keep re-inventing enrollment: install an app, write down
a seed phrase, trust a custodian. But the platforms already solved secret
management — the passkey is a synced, hardware-backed, phishing-resistant
credential. So there is no seed phrase and no account: WebAuthn's `prf` extension
returns a deterministic secret during authentication, and everything else is
derivation.

```
passkey PRF output
  └─ HKDF
      ├─ vault key            AES-GCM over everything at rest
      ├─ holder seed(issuer)  one keypair per issuer, for holder binding
      └─ presenter seed(verifier origin)
                              one keypair per verifier — pairwise identities
```

Passkey sync (iCloud Keychain, Google Password Manager) is the recovery story.
The wallet is a static page; locking it is forgetting the derived keys.

## The story: age verification as a privacy ladder

The Utopia DMV issues a driver's license as a W3C Verifiable Credential signed
with `bbs-2023`. Two fictional businesses check ages — and the wallet lets you
choose how much they learn:

| Tier | Mechanism | What the verifier learns |
|------|-----------|--------------------------|
| 0 — Full disclosure | Present the whole credential | Everything (today's status quo) |
| 1 — Selective disclosure | BBS derived proof of chosen claims | Only those claims (e.g. an `age_over_18` flag); presentations unlinkable across verifiers |
| 2 — ZK predicate | Noir/UltraHonk proof over a Poseidon birthdate commitment | Only "old enough for *this* cutoff" — any cutoff, one credential, never the date |

Present to both verifiers and the wallet's cross-verifier exhibit shows what
they could learn by comparing notes — including the honest catch the demo itself
surfaced: take the ZK tier at both counters and each sees the same issuer-signed
commitment, a stable value colluding verifiers could match. The demo reports
this instead of hiding it.

## The cast

| Site | Origin | Role |
|------|--------|------|
| Landing | [verygoodwallet.com](https://verygoodwallet.com) | Tour launcher + writeup |
| Wallet | [wallet.verygoodwallet.com](https://wallet.verygoodwallet.com) | Passkey-native wallet (static SPA) |
| Utopia DMV | [dmv.verygoodwallet.com](https://dmv.verygoodwallet.com) | Issuer — OID4VCI, pre-authorized code flow |
| The Nightcap | [shop.verygoodwallet.com](https://shop.verygoodwallet.com) | Verifier — age-gated shop, over-18 |
| Utopia Wheels | [rentals.verygoodwallet.com](https://rentals.verygoodwallet.com) | Verifier — car rental, over-25 + identity |

The State of Utopia issues no real licenses, the shop sells nothing, and the
rental fleet is six SVGs. The cryptography, the protocols, and the timings are
real: OID4VCI and OID4VP with DCQL, `bbs-2023` + `eddsa-rdfc-2022` data
integrity, WebAuthn PRF + HKDF, and a Noir circuit proven in the browser via
bb.js.

## Repository layout

```
apps/
  landing/    static landing site + writeup (vgw-landing)
  wallet/     the wallet SPA (vgw-wallet)
  dmv/        issuer: Hono Worker (OID4VCI) + UI (vgw-dmv)
  shop/       verifier 1: Hono Worker (OID4VP) + UI (vgw-shop)
  rentals/    verifier 2: Hono Worker (OID4VP) + UI (vgw-rentals)
packages/
  vc-kit/     VC 2.0 + bbs-2023 sign/derive/verify, did:key, document loader
  keys/       PRF → HKDF key hierarchy, pairwise DIDs, vault crypto
  zk/         Noir circuit + prover/verifier wrappers (lazy-loaded WASM)
  protocols/  OID4VCI/OID4VP/DCQL message types
  tour/       the guided tour: script, overlay, cross-origin URL plumbing
```

Each app deploys to a Cloudflare Worker (free tier) on every push to `main`;
verification sessions live in SQLite-backed Durable Objects. See
[DEPLOY.md](DEPLOY.md) for the runbook and [PLAN.md](PLAN.md) for the full
design and milestone history.

## Development

Node ≥ 22 and pnpm (via corepack):

```sh
pnpm install
pnpm dev:wallet    # http://localhost:5173
pnpm dev:dmv       # http://localhost:5174
pnpm dev:shop      # http://localhost:5175
pnpm dev:rentals   # http://localhost:5176
pnpm dev:landing   # http://localhost:5177
```

Run them together to walk the whole flow locally — the sites discover each
other through per-app origin defaults (overridable with `VITE_*_ORIGIN`).

```sh
pnpm typecheck
pnpm test                                # unit + integration
VGW_E2E=1 pnpm --filter @vgw/shop test   # live e2e against running dev servers
VGW_E2E=1 pnpm --filter @vgw/rentals test
pnpm --filter @vgw/dmv smoke             # boot the built Worker under workerd
```

## What this demo doesn't claim

No revocation, no audit, issuer trust bootstrapped over TLS, and losing every
copy of the passkey loses the wallet — the
[writeup](https://verygoodwallet.com/writeup/) spells out each limitation and
the field notes behind the design. It's a demonstration of an architecture,
not a product.
