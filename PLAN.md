# VeryGoodWallet — Re-imagined: Plan

## Thesis

**Your passkey is your wallet.** No seed phrase, no server-side key custody: a passkey's PRF
output deterministically derives the wallet's entire key hierarchy, and passkey sync
(iCloud Keychain / Google Password Manager / 1Password) provides backup and multi-device
recovery for free.

The re-imagined demo builds the **full trust triangle** around that thesis — issuer, wallet,
and verifiers, all live in this repo — and tells one crisp story: **privacy-preserving age
verification**, demonstrated as a three-tier privacy ladder:

| Tier | Mechanism | What the verifier learns |
|------|-----------|--------------------------|
| 0 — Full disclosure | Present the entire credential | Everything (today's status quo) |
| 1 — Selective disclosure | BBS derived proof (`bbs-2023`) of chosen claims | Only disclosed claims, e.g. `age_over_18` flag; presentations unlinkable across verifiers |
| 2 — ZK predicate | Noir circuit over a BBS-signed birthdate commitment | Only the predicate ("born before 2008-07-13"), for *any* cutoff — nothing else |

A deliberate teaching point at tier 1 vs 2: precomputed `age_over_NN` flags (the mdoc
approach) require the issuer to anticipate every cutoff; the ZK tier proves any cutoff from
a single committed birthdate.

## Decisions made

- **Backend**: real OID4VCI / OID4VP endpoints on **Cloudflare Workers** (free tier). The
  wallet itself stays fully static and client-side.
- **ZK**: real **Noir circuit** (birthdate commitment opening + range check), proven in the
  browser via bb.js WASM. In scope as milestone M4.
- **Demo scope**: issuer + **two** verifiers, so pairwise-DID/unlinkability is shown, not told.
- **Monorepo**: everything in this repo; greenfield Vite apps, legacy `web/` (CRA) retired at
  cutover; vestigial .NET `api/` removed.

## Cast & domains

All sites are subdomains of `verygoodwallet.com` (DNS on Cloudflare; distinct origins matter
for passkey RP ID, DC API origin display, and pairwise DIDs):

| Site | Origin | Role |
|------|--------|------|
| **Wallet** | `verygoodwallet.com` | Static PWA; passkeys + PRF; credential storage |
| **Utopia DMV** | `dmv.verygoodwallet.com` | Issuer portal — issues the Utopia Driver's License (reuses existing Utopia credential art) |
| **The Nightcap** (bottle shop) | `shop.verygoodwallet.com` | Flagship verifier — age gate (over 18/21) |
| **Utopia Wheels** (car rental) | `rentals.verygoodwallet.com` | Second verifier — name + license number + over 25 |

## Repo layout

```
verygoodwallet/
├── apps/
│   ├── wallet/            # Vite + React 19 + TS 5 + Tailwind 4 (static)
│   ├── dmv/               # issuer site (static UI) + workers/ (OID4VCI endpoints, Hono)
│   ├── shop/              # verifier 1 site + workers/ (OID4VP request + response endpoints)
│   └── rentals/           # verifier 2 site + workers/
├── packages/
│   ├── vc-kit/            # VC 2.0 + bbs-2023 sign/derive/verify, did:key, document loader
│   │                      #   (ported from web/src/services/bbs.ts + security.ts)
│   ├── keys/              # PRF → HKDF key hierarchy, pairwise DID derivation, vault crypto
│   ├── zk/                # Noir circuit + prover/verifier wrappers (lazy-loaded WASM)
│   ├── protocols/         # OID4VCI/OID4VP/DCQL message types + DC API adapter
│   └── ui/                # shared components: credential cards, JSON inspector, consent UI
├── web/                   # legacy CRA app — untouched until cutover, then deleted
└── PLAN.md
```

pnpm workspaces; GitHub Actions deploys each app to Cloudflare (Workers with static assets).

## Identity & key design

```
passkey PRF output (never stored, re-derived per session)
└── HKDF branches
    ├── "vault"                → AES-GCM key for encrypted IndexedDB storage
    ├── "holder:<issuer-origin>"  → BLS12-381 BBS keypair → pairwise did:key (issuance binding)
    └── "presenter:<verifier-origin>" → per-verifier keypair → signs presentations
```

- **PRF only.** largeBlob is dropped — PRF won the extension war. The existing simulated-key
  fallback stays for browsers without PRF support (clearly labeled in the UI).
- **Unlinkability story**: credential subject identifier is *not disclosed* by default; BBS
  derived proofs are unlinkable across presentations; each verifier sees a different
  presenter DID. Honest caveat documented in-app: cryptographic holder binding that is
  itself unlinkable (BBS blind binding / per-verifier pseudonyms, draft-irtf-cfrg-bbs) is
  called out as future work, not faked.
- **Credential format**: W3C VC Data Model 2.0, Data Integrity `bbs-2023` proofs. The Utopia
  DL gains a `birthDateCommitment` claim: Poseidon(dob, blinding) with the opening stored
  privately in the wallet vault.

## ZK design (tier 2)

Noir circuit, deliberately small:

- **Private inputs**: `dob` (days since epoch), blinding `r`
- **Public inputs**: commitment `C`, cutoff date
- **Proves**: `C == Poseidon(dob, r)` ∧ `dob ≤ cutoff`

Presentation bundle = BBS derived proof disclosing *only* `birthDateCommitment` (issuer-signed,
so the commitment is authentic) + UltraHonk proof over that commitment, embedded in the signed
VP as the VGW `zkAgeProof` JSON-literal term. Verifier checks both and learns exactly one bit.
Proving happens in-browser (bb.js WASM, lazy-loaded). Verification splits honestly across two
runtimes (as built in M4): the shop **Worker** verifies the BBS layer, the VP wrapper, and the
proof's public-input bindings (commitment = the signed claim, cutoff = today's policy), but
**cannot** run bb.js — Cloudflare Workers prohibit runtime WASM compilation and the free plan's
3 MiB script cap wouldn't fit it anyway — so the UltraHonk check itself runs in the shop's own
client (lazy bb.js against the checked-in verification key), with the e2e suite running the
identical call in Node, exactly as a self-hosted verifier would server-side.

Stretch (not in scope): longfellow-style ZK over ECDSA-signed mdocs.

## Flows

1. **Onboard** — create passkey (PRF required), derive hierarchy, vault ready. Inspector
   shows the live derivation tree.
2. **Issuance** — DMV site → OID4VCI pre-authorized code flow (same-device link + QR for
   cross-device) → wallet authenticates (passkey → PRF), sends proof-of-possession with the
   issuer-pairwise DID → DMV Worker signs the VC (issuer BBS key held in Worker secret) →
   wallet stores encrypted.
3. **Flagship presentation (shop age gate)** — verifier first attempts the **Digital
   Credentials API** (`navigator.credentials.get({digital})` with a DCQL query); since web
   wallets can't register as DC API providers yet, it gracefully falls back to an OID4VP
   link/QR targeting the wallet. Wallet consent screen offers the **three-tier picker**;
   response via `direct_post` to the shop Worker; result page shows a
   "what did the verifier actually learn" diff per tier.
4. **Second presentation (rentals)** — different disclosure set (name, license number,
   over-25 via ZK with a different cutoff — same commitment). A cross-verifier exhibit shows
   the two verifiers' views side by side: nothing correlates.
5. **DC API exhibit** — the shop also offers the native-wallet path (works against e.g. a
   Google Wallet test mdoc on Android) with an explainer of the web-wallet gap. DC API call
   isolated behind an adapter in `packages/protocols` (protocol strings still churn pre-CR).

## Pedagogy is the product

- **Inspector drawer** on every app: raw protocol messages (offer, token request, VC, VP,
  DCQL), key derivation tree, PRF output (hashed preview), ZK public inputs.
- **Tier comparison screen** at the shop: same request answered three ways.
- **Guided demo mode**: a scripted 90-second walkthrough across the four sites.
- Landing page states the thesis and links a technical writeup.

## Milestones

| # | Deliverable | Notes |
|---|-------------|-------|
| **M0** | Monorepo scaffold + wallet skeleton + CI/CD to Cloudflare | pnpm workspaces, Vite, Tailwind 4; port passkey/PRF onboarding + encrypted vault from `web/` |
| **M1** | `vc-kit` + `keys` packages | VC 2.0 upgrade, bbs-2023 sign/derive/verify, pairwise derivation, Utopia DL modernized (art reused) |
| **M2** | Utopia DMV issuer live | OID4VCI pre-auth flow end-to-end into the wallet; credential card UI |
| **M3** | Shop verifier live (tiers 0–1) | OID4VP + DCQL + direct_post; DC API attempt + fallback; consent UI; inspector |
| **M4** | ZK tier | Noir circuit, browser proving, verifier-side verification, tier picker complete |
| **M5** | Rentals verifier + unlinkability exhibit | second disclosure profile, cross-verifier comparison |
| **M6** | Polish + cutover | guided demo mode, landing page, writeup; delete `web/` + `api/`, retire GitHub Pages deploy |

## Risks & mitigations

- **PRF support matrix** — Safari/iCloud, Chrome/GPM, 1Password, Bitwarden are fine; keep the
  labeled simulated fallback so the demo never dead-ends.
- **DC API churn** — pre-Candidate-Recommendation; adapter isolates it; fallback path is the
  primary path anyway.
- **bb.js WASM size** — lazy-load; ZK tier is progressive enhancement.
- **BBS holder-binding nuance** — documented honestly in-app (see Identity & key design).
- **DNS migration** — subdomains require moving `verygoodwallet.com` DNS to Cloudflare;
  GitHub Pages deploy stays live until M6 cutover.

## Open items (non-blocking)

- Verifier brand names/art (placeholders above: The Nightcap, Utopia Wheels).
- Keep or drop PostHog/GA in the new apps.
- Possible act 3 later: **verifiable agent delegation** (scoped delegation VC presented by an
  AI agent) — designed to slot in as a third verifier without rearchitecting.
