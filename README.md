# VeryGoodWallet

**Your passkey is the wallet.** A working demo of passkey-native digital identity:
an issuer, a wallet, and two verifiers — real protocols, real cryptography,
free-tier infrastructure.

**Live: [verygoodwallet.com](https://verygoodwallet.com)** — take the
[guided tour](https://verygoodwallet.com) (~3 minutes) or read the
[technical writeup](https://verygoodwallet.com/writeup/).

[![See credkit in action: blind issuance, selective disclosure, and private age proofs.](assets/credkit-demo-banner.webp)](https://verygoodwallet.com)

## Core cryptography: [credkit](https://github.com/tmarkovski/credkit)

The cryptographic engine behind VeryGoodWallet lives in the separate
**[credkit repository](https://github.com/tmarkovski/credkit)**. It provides the
TypeScript implementations of BBS signatures, blind issuance, selective
disclosure, composite zero-knowledge proofs, hidden-value predicates, and
privacy-preserving revocation used throughout this demo. This repository adds
the wallet, issuer, verifier, and protocol integration around that core.

credkit is experimental research software and has not been independently
audited.

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
      ├─ vault key             AES-GCM over everything at rest
      ├─ link secret           ONE secret for life, blind-committed into every
      │                        credential — holder binding no issuer ever sees
      └─ issuance-PoP seed(issuer origin)
                               one keypair per issuer, request freshness only
```

Presentations derive no key at all: a credkit presentation carries no holder
identifier of any kind, so there is no per-verifier branch.

Passkey sync (iCloud Keychain, Google Password Manager) is the recovery story.
The wallet is a static page; locking it is forgetting the derived keys.

## The story: a privacy ladder

The Utopia DMV blind-issues a driver's license as a W3C Verifiable Credential
on the `credkit-bbs-sha-2026` Data Integrity suite — bound to the wallet's
link secret, which the DMV never sees. Two fictional businesses check ages —
and the wallet lets you choose how much they learn:

| Tier | Mechanism | What the verifier learns |
|------|-----------|--------------------------|
| 0 — Full disclosure | Present the whole credential | Everything (today's status quo) |
| 1 — Selective disclosure | BBS derived proof of chosen claims | Only those claims (e.g. an `age_over_18` flag, frozen at issuance); presentations unlinkable across verifiers |
| 2 — Range predicate | credkit range proof over the *hidden* birth-date twin, verified entirely in the verifier's Worker | Only "old enough for *this* cutoff" — any cutoff, live, one credential, never the date |

Present to both verifiers and the wallet's cross-verifier exhibit shows what
they could learn by comparing notes: nothing, unless you disclosed the same
value to both. The presentation carries no holder identifier, and every proof
— the age proof included — is re-randomized per presentation, so the
correlation handle the pre-credkit demo had to confess (a stable, matchable
birthdate commitment) no longer exists. "Same person" across credentials is
something the holder can *elect* to prove with the link secret, never
something verifiers discover.

Utopia Wheels' resident rate cashes that election in. The DMV also issues a
resident registration — district and postal code sealed as hidden numeric
twins — and the discounted rate needs three facts: over 25, coastal resident,
same person holding both documents. The wallet answers with two credentials
in one presentation envelope, proving all three with **zero disclosures**: a
range proof that the license's hidden birth date beats this request's 25+
cutoff, a set-membership proof that the registration's hidden district code
is one of the published coastal districts (which one stays hidden), and an
equality proof that both credentials are bound to the same hidden link
secret. Same person, no name — verified entirely in the Worker.

The license can also stop being true. Every credential the DMV signs is
enrolled in an accumulator-backed revocation registry — the records desk
revokes with two clicks and the registry publishes a new epoch. The wallet
fast-forwards its membership witness from the published update records
(it downloads the registry state whole, so the registry never learns which
credential is asking), and verifiers demand a non-revocation proof in the
same presentation envelope. What they learn is exactly one bit — still
valid — never which registry entry proved it.

## The cast

| Site | Origin | Role |
|------|--------|------|
| Landing | [verygoodwallet.com](https://verygoodwallet.com) | Tour launcher + writeup |
| Wallet | [wallet.verygoodwallet.com](https://wallet.verygoodwallet.com) | Passkey-native wallet (static SPA) |
| Utopia DMV | [dmv.verygoodwallet.com](https://dmv.verygoodwallet.com) | Issuer — OID4VCI, pre-authorized code flow |
| The Nightcap | [shop.verygoodwallet.com](https://shop.verygoodwallet.com) | Verifier — age-gated shop, over-18 |
| Utopia Wheels | [rentals.verygoodwallet.com](https://rentals.verygoodwallet.com) | Verifier — car rental, over-25 + identity; resident rate: two credentials, zero disclosures |

The State of Utopia issues no real licenses, the shop sells nothing, and the
rental fleet is six SVGs. The cryptography, the protocols, and the timings are
real: OID4VCI and OID4VP with DCQL, the `credkit-bbs-sha-2026` Data Integrity
suite over IETF BBS (blind issuance, selective disclosure, range and
set-membership predicates over hidden values, cross-credential same-holder
proofs through the link secret, non-revocation proofs against an accumulator
registry), WebAuthn PRF + HKDF — with the whole verification, pure JS and no
WASM, running inside each verifier's Cloudflare Worker.

## Repository layout

```
apps/
  landing/    static landing site + writeup (vgw-landing)
  wallet/     the wallet SPA (vgw-wallet)
  dmv/        issuer: Hono Worker (OID4VCI) + UI (vgw-dmv)
  shop/       verifier 1: Hono Worker (OID4VP) + UI (vgw-shop)
  rentals/    verifier 2: Hono Worker (OID4VP) + UI (vgw-rentals)
packages/
  vc-kit/     VC 2.0 on the credkit suite: blind issue, present, verify,
              did:key codec, offline document loader (the ONLY @credkit/* door)
  keys/       PRF → HKDF key hierarchy (link secret, issuance keys), vault crypto
  protocols/  OID4VCI/OID4VP/DCQL message types (crypto-free)
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

No audit, issuer trust bootstrapped over TLS, and losing every copy of the
passkey loses the wallet — the
[writeup](https://verygoodwallet.com/writeup/) spells out each limitation.
It's a demonstration of an architecture, not a product. (Revocation, once on
this list, is now in: every DMV credential enrolls in an accumulator-backed
registry, wallets keep membership witnesses current from published update
records, and verifiers demand a non-revocation proof that reveals one bit —
never which registry entry it was.)
