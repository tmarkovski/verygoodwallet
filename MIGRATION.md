# VeryGoodWallet — Migration to `@credkit/cryptosuite`

A design record, written before the code (the house convention: `credkit/docs/FINDINGS.md`
§14, §16 were written the same way — if the implementation disagrees with this document,
amend this document, don't silently drift).

Drafted 2026-07-16. This plan supersedes the ZK tier of [PLAN.md](PLAN.md) (milestone M4,
the Noir/UltraHonk circuit) and the "future work" holder-binding caveats it and
[README.md](README.md) confess. Status facts (which files are mid-flight in credkit) will
rot; re-verify before relying on them.

---

## 0. Thesis

credkit is the **successor stack** this repo's own documents keep pointing at. Three things
the current demo *confesses as limitations* are the exact three properties credkit was built
to deliver:

| Today's confession (README/PLAN) | credkit fix |
|---|---|
| The ZK-tier Poseidon `birthDateCommitment` is "a stable value colluding verifiers could match" | Numeric **twin block** — always hidden, per-presentation randomized, no correlation handle (FINDINGS §14) |
| Unlinkable cryptographic holder binding is "documented future work, not faked" | **Global link secret** — one secret for life, blind-committed per issuer (FINDINGS §8) |
| ZK verify "cannot run on Cloudflare Workers"; it splits to the client and returns `zk_pending` | **no-WASM** noble stack verifies **server-side in the Worker**; the split "stops existing" (FINDINGS §9) |

So this is not a lateral rewrite. With the **same age story and the same cast**, it turns
three apologies into three wins — and then unlocks capabilities the current
single-credential / single-predicate stack structurally cannot express: composite proofs,
cross-credential link secret, and set-membership residency.

---

## 1. What we keep, and what we drop — precisely

We are **not** leaving BBS, and we are **not** leaving JSON-LD Data Integrity. The confusion to
pre-empt: `bbs-2023` names a *cryptosuite*, not the signature scheme.

- **KEEP — IETF BBS** (`draft-irtf-cfrg-bbs-signatures` + the blind-signature draft). credkit's
  `@credkit/bbs` is a faithful, fixture-verified implementation built from the draft's `main`
  (FINDINGS §1, §3, §10 — 131 tests green on both ciphersuites, every trace intermediate
  asserted; 371 across the credkit workspace). The core signature scheme is unchanged; if anything we are *more* faithful to the
  draft than the incumbent, which vendors an academic BBS+ lineage.
- **KEEP — JSON-LD Data Integrity + VCDM 2.0 + `ldp_vc`.** Credentials stay W3C VCs; the
  document pipeline (RDF Dataset Canonicalization, HMAC-shuffled blank-node labels, mandatory
  pointers, JSON-pointer selection) is adopted **wholesale** from bbs-2023 (FINDINGS §14). The
  OID4VCI/OID4VP `format: "ldp_vc"` identifier and the DCQL pointer plumbing survive.
- **DROP — the `bbs-2023` Data Integrity cryptosuite** (`@digitalbazaar/bbs-2023-cryptosuite`).
  It is a Candidate-Recommendation suite that does disclose-or-hide at whole-statement
  granularity: no predicates, no proofs about undisclosed values, no multi-credential
  presentation, no cross-credential equality. "The missing middle is still missing" (FINDINGS
  §14). We keep its document pipeline and replace its proof layer.
- **ADOPT — `credkit-bbs-*`**, our own Data Integrity LD cryptosuite over the same IETF BBS, whose
  derived proofs are composite `CREDKIT-PROOFS` presentations. Disjoint cryptosuite id, `@context`,
  and envelope prefixes so a credkit proof can never be mistaken for a bbs-2023 one (FINDINGS §14,
  §15). A **second** suite `credkit-bbs-presentation-*` secures the multi-credential VP (FINDINGS §16).

One-liner for the writeup: *we replaced one Data Integrity cryptosuite with another over the
same BBS core, because the standard suite's disclose-or-hide model has no room for predicates,
link secrets, or multi-credential proofs — and ours does.*

---

## 2. Capability delta

| Property | VGW today | credkit |
|---|---|---|
| Selective disclosure | `bbs-2023` derived proof | credkit derived proof (`deriveProof`, the N=1 projection of the VP envelope) |
| Age predicate | Noir/UltraHonk over a Poseidon commitment (BN254) | CCS range proof over a hidden `date1900` **twin** (BLS12-381) — no disclosed commitment |
| Holder binding | EdDSA PoP JWT to a per-issuer key (not unlinkable) | **Global link secret**, blind-committed at issuance |
| Cross-credential "same person" | impossible | `WitnessEquality` on the link secret across statements |
| Multi-credential presentation | impossible | `presentGraph` — N credentials, one merged challenge |
| Set membership (residency) | impossible | CCS set proof over a hidden `stateFips` / ZIP |
| Where verify runs | Worker checks bindings; **client runs bb.js**; verdict `zk_pending` | **whole verify in the Worker** (noble, no WASM) |
| Any-cutoff age | ✔ | ✔ |

---

## 3. Decisions (recorded as settled)

Every decision below has a reason; to overturn one, overturn the reason.

1. **Drop `bbs-2023` entirely; do not run it live alongside credkit.** Dual live suites means two
   base proofs (or two credentials) doubling the surface for a teaching point a writeup makes
   better. credkit's plain selective disclosure *is* the tier-1 mechanism (uniform-N=1, FINDINGS
   §11). The bbs-2023-vs-credkit comparison lives in `/writeup/`, not in live dual-issuance. The
   standards narrative reframes to §1's one-liner, which is stronger and honest.
2. **The DMV issues a second credential** (Utopia Resident Registration) rather than promoting a
   verifier to issuer for the base showcases. It reuses existing issuer infrastructure and unlocks
   *both* the residency (set-membership) and cross-credential (link-secret) demos. Cross-issuer
   linking — the strongest form of FINDINGS §8 — is the stretch act D (Nightcap becomes an issuer).
3. **Holder binding is the credkit commitment-with-proof, carried as an OID4VCI credential-request
   extension — not a proprietary `proof_type`.** The commitment proves *knowledge* of the link
   secret, and blind issuance binds the credential to it (the issuer never sees the secret). It does
   **not** carry the issuer's `c_nonce`: credkit's `Commit` follows the IETF blind-BBS draft, whose
   proof absorbs only the blind generators and the commitment points, no external nonce (verified in
   `credkit/packages/bbs/src/blind.ts`, `blindChallenge`). So **binding and freshness are separate
   concerns**, and only binding is settled here. Request freshness/anti-replay is decided at N2:
   either **(a)** lean on the pre-authorized access token and send no PoP — a replayed commitment
   buys nothing, since the credential it yields is bound to a secret only the holder knows — or
   **(c)** keep the standard OID4VCI `proof_type: jwt` PoP on top. Because the commitment rides as an
   extension field, **(c) is purely additive to (a)**: the binding handshake is byte-identical, (c)
   only layers the standard PoP for real request liveness — and keeping the commitment *out* of the
   `proof_type` slot is what preserves that (a proprietary proof_type would fork the wire shape and
   foreclose (c)). Option **(b)** — threading a nonce into `blindChallenge` — is rejected: it breaks
   the IETF `Commit` fixture fidelity that is a core credkit value (FINDINGS §1–3). **Recommended
   lean: (c), confirmed at N2.** The demo's thesis is that the protocols are real, and (c) keeps the
   credential request on standard rails — `proof_type: jwt`, not a bespoke type — while naming two
   distinct jobs: the PoP proves liveness, the commitment proves binding. One condition keeps that honest rather than decorative: the credential
   is bound to the link secret and carries no `cnf` key, so a bare PoP would attest a key bound to
   nothing — the PoP JWT MUST also sign the commitment digest, binding the proof to *this* request and
   attesting liveness of a party *holding* the commitment — a VGW-defined claim inside an
   otherwise-standard PoP JWT, a payload extension, not a new proof type. Be precise about the claim:
   it is *possession* of the commitment, not fresh *knowledge* of the link secret. The commitment is a
   public, transferable value whose own proof-of-knowledge carries no nonce, so an intercepted commitment
   could be signed over by another party. Request/session-binding can prevent cross-request injection, but
   freshly proving knowledge would require a new link-secret PoK whose transcript binds the session and,
   under (c), the PoP key — effectively reopening the rejected nonce/challenge change in option (b). Keep the PoP key
   **pairwise per issuer** — as the current issuance flow does by deriving
   `deriveHolderSeed(master, issuerOrigin)` before passing its seed to the seed-agnostic `popJwt.ts`.
   Its `kid` is exposed to each issuer, so one reused key is a cross-issuer correlation handle, and
   scoping still buys issuer↔issuer unlinkability even though the key is freshness-only now. (An earlier draft said "single
   device-bound key"; that conflated this with the *presentation*-side per-verifier key —
   `derivePresenterSeed`, §7 — which does become vestigial because the VP carries no holder key. That
   retirement does not transfer to the issuance PoP key.) (a) stays the
   fallback — dropping the PoP collapses (c)→(a) with no rework.
4. **Land the core migration (N0–N4) before the new showcases (N5–N6).** N0–N4 are a strict upgrade
   of the existing age story; the new capabilities build on a stable base.
5. **Consume credkit as published, versioned packages** (credkit becomes a **public repo**). VGW deps
   `@credkit/*` like any dependency and pins one version; the monorepo-merge alternative (§11) is
   rejected — it couples two release cadences. Source-publish is viable (Vite/esbuild compile
   credkit's TS `main`), subject to the `.js`→`.ts` bundler note in Appendix C.

---

## 4. Target architecture — the three call sequences

Signatures below are verified against `credkit/packages/cryptosuite/src`. The VP-envelope entry
points (`presentGraph`/`verifyGraph`, `statement.ts`) are **built and committed** (credkit
`b3c6bed`, 92 cryptosuite tests) — no longer mid-flight. They also handle N=1 (tested), so VGW can
target `presentGraph`/`verifyGraph` from N2 onward and treat a single-credential presentation as a
one-statement VP — one API for both arities, and challenge/domain folding for free (see below). The
`issueCredential`/`deriveProof`/`verifyProof` N=1 path stays available for a plain-VC output shape.

**Issue** (DMV Worker + wallet — replaces the PoP-JWT + Poseidon dance):
```ts
// wallet: the ONE master-derived link secret, committed blindly — the SAME secret at every issuance,
// or credentials won't link. Bare createHolderBinding() mints a FRESH random secret (issue.ts) — don't.
const binding = createHolderBinding({ linkSecret: deriveLinkSecret(master) }); // { linkSecret, commitmentWithProof, secretProverBlind }
// → send binding.commitmentWithProof as an OID4VCI credential-request extension (§3.3; freshness a/c at N2)

// DMV Worker: blind-sign; the issuer never sees the secret
const { verifiableCredential } = await issueCredential({
  document: buildUtopiaDriversLicense({ /* no birthDateCommitment */ }),
  keyPair, verificationMethod,                   // @credkit/bbs keyGen; one ciphersuite forever
  cryptosuite: "credkit-bbs-sha-2026",
  mandatoryPointers: ["/issuer", "/validFrom", "/validUntil"],
  numericDeclarations: [{ pointer: "/credentialSubject/driversLicense/birth_date", encoder: "date1900" }],
  holderCommitment: binding.commitmentWithProof,
});
// wallet persists { verifiableCredential, secretProverBlind } in the vault; secretProverBlind is
// per-credential (random, not re-derivable). The link secret is re-derived from the PRF, not stored.
```

**Present** (wallet — the three tiers collapse into one API; the N-credential path is new):
```ts
// Tier 2 age predicate, single credential — the birth_date twin stays HIDDEN
const { verifiablePresentation } = await deriveProof({
  verifiableCredential,
  selectivePointers: [],                          // or [".../age_over_18"] for the tier-1 rung
  rangeClaims: [{ pointer: "/credentialSubject/driversLicense/birth_date",
                  kind: "lessOrEqual",            // older = smaller number ⇒ "18+" is birthDate <= cutoff
                  bound: daysSince1900(cutoff18), digits: 4, params }],
  presentationHeader, holderBinding: binding,
});

// NEW (N5): two credentials, prove same holder, reveal neither identity
const vp = await presentGraph({
  credentials: [{ verifiableCredential: dl,         rangeClaims: [/* over-25 */], holderBinding },
                { verifiableCredential: residentId, membershipClaims: [/* coastal ZIP */], holderBinding }],
  equalities: [[{ statement: 0, linkSecret: true }, { statement: 1, linkSecret: true }]],
  challenge, domain,
});
```

**Verify** (shop/rentals Worker — now the *whole* check, server-side):
```ts
const r = await verifyProof({                       // or verifyGraph for N credentials
  verifiablePresentation,
  publicKey,                                        // the verifier's OWN trust anchor, never the wire
  presentationHeader,
  expectedRangeClaims: [{ pointer: ".../birth_date", kind: "lessOrEqual", bound: daysSince1900(cutoff18), digits: 4 }],
});
// r.verified === true → one verdict, no zk_pending, no client-side bb.js
```

Three credkit invariants VGW must honor. First, the verifier **restates the claim list — and the
equalities — in the same order** the proof carries them (a mismatch is a loud typed failure, not a
silent pass — FINDINGS §11/§15; `verifyGraph` takes `expectedEqualities` beside
`expectedRangeClaims`/`expectedMembershipClaims`, and a link-secret linkage the verifier did not
demand fails closed). Second, **one ciphersuite across a whole presentation** (the link-secret
scalar is suite-dependent — a `sha` credential and a `shake` credential can never share an equality,
FINDINGS §16); VGW pins `credkit-bbs-sha-2026` everywhere, forever. Third, on the N=1
`deriveProof`/`verifyProof` path only, VGW itself encodes `challenge`+`domain` into the opaque
`presentationHeader` (credkit exports `encodePresentationHeader`) — the native folding lives in
`presentGraph`/`verifyGraph`, one more reason to prefer them.

---

## 5. Credential redesign

**Utopia Driver's License** — minimal *visible* change, large *capability* change
(`packages/vc-kit/src/credentials/utopia-dl.ts`):

- **Remove** `birthDateCommitment` (the Poseidon handle) and, from `vgw-v1.json`, the
  `birthDateCommitment` and `zkAgeProof` terms.
- **Add** a numeric declaration for `/credentialSubject/driversLicense/birth_date` (`date1900`) —
  invisible metadata bound into the base proof's third header segment, not a document field, so the
  revealed credential is still valid JSON-LD (FINDINGS §14).
- **Keep** the `age_over_{18,21,25}` flags. They are ordinary disclosable claims and stay as the
  **tier-1 rung and the teaching contrast** ("frozen at issuance; staleness is the point — the
  predicate proves any cutoff live"). Their staleness argument survives intact.
- **Gate to verify early (N2):** `birth_date` must be typed `xsd:date` by the vDL context and issued
  in XSD-canonical lexical form, or the credkit pipeline fail-closes at issuance (FINDINGS §14). It
  must stay non-mandatory (it already is) so the twin is hideable.
- **Unchanged residual:** `validFrom`/`validUntil` remain mandatory-disclosed and date-granular — a
  small correlation vector credkit does not (and cannot) remove; the DL already documents this.

**NEW — Utopia Resident Registration** (issued by the *same* DMV): carries `stateFips` (`uint64`,
set-membership) and `postalCode` (`uint64`, two-sided range), both numeric-declared. This one
addition powers *both* new showcases (residency set-membership **and** cross-credential link secret)
and can reuse the `citizenship-v1/v3` contexts already sitting in `vc-kit/src/contexts`.

---

## 6. Key hierarchy: the link secret is the one real architectural departure

`@vgw/keys` already has the master secret (`PRF_EVAL_INPUT = "vgw/v1/master-secret"`) and HKDF
branching — the machinery exists. The shift:

- **Add** `deriveLinkSecret(master)` under a new, deliberately **non-origin-scoped** info label
  (`vgw/v1/link-secret`). This is *not* pairwise: it is one secret across all issuers (FINDINGS §8).
  Verifier-unlinkability is preserved regardless — the secret is never disclosed and proofs are
  re-randomized per presentation; only *holder-elected* linking ever reveals "same holder."
- **Replace** `deriveHolderSeed(master, issuerOrigin)`: credkit's global link secret takes over the old
  holder-binding job; under freshness option (c), add
  `deriveIssuancePopSeed(master, issuerOrigin)` under an explicitly origin-scoped
  `vgw/v1/issuance-pop:<issuer-origin>` label for the remaining Ed25519 request PoP. Remove
  `commitment.ts` wholesale (Poseidon2/BN254 `createCommitment`/`verifyCommitment`/`daysSinceEpoch`/
  `BN254_SCALAR_FIELD` — all superseded by credkit `createHolderBinding`/`commit` on BLS12-381).
- **`derivePresenterSeed`** (per-verifier Ed25519) becomes vestigial: the credkit VP carries no
  holder/presenter key and no `holder` property (unrepresentable, actively rejected — FINDINGS §16),
  so there is no presenter signature and no per-verifier DID. The "each verifier sees a different DID"
  exhibit *upgrades* to "the verifier sees no identifier at all." Retire the branch, or keep it only
  for transport-level plumbing.
- **Issuance-PoP key (under the §3.3 (c) lean):** VGW keeps a lightweight Ed25519 key for the
  OID4VCI request PoP — *not* the removed binding key. Derive it with
  `deriveIssuancePopSeed(master, issuerOrigin)`, preserving the current issuance flow's **pairwise-per-issuer**
  scope after `deriveHolderSeed` is removed. (`popJwt.ts` itself is seed-agnostic.) Its `kid` reaches each
  issuer, so a single reused key would be a cross-issuer correlation handle. At issuance it signs
  `c_nonce` + the commitment digest and attests liveness of a party *holding* the commitment
  (possession, not fresh knowledge of the link secret —
  §3.3), and never appears at presentation, so it adds no *presentation*-side handle. Under fallback (a)
  it goes away entirely.
- **Threading & vault:** `deriveLinkSecret(master)` returns the **same** secret every session, and
  VGW must feed *that* into every issuance (`createHolderBinding({ linkSecret })`). The bare
  `createHolderBinding()` mints a fresh random secret per call (`issue.ts:48,57`) — which passes the
  single-credential age demo but silently breaks cross-credential equality (showcase C) and the
  one-secret-for-life property. So the link secret is re-derived from the PRF, never stored; the
  per-credential must-persist item is `secretProverBlind` (random at each `commit`, not re-derivable —
  losing it bricks that credential). Recovery needs its own mechanism: passkey/PRF sync regenerates the
  **master** on a new device (so the vault key and the re-derived link secret come back), but it does
  **not** move IndexedDB — the credentials and their non-derivable blinds live there and do not ride the
  passkey. So a blind survives device loss only via an explicit **encrypted export/backup/sync of the
  credential store**; encrypted-IndexedDB alone is at-rest protection on one device, not a cross-device
  recovery channel. That export mechanism is unspecified here — an N2 design point (§13).

---

## 7. OIDC protocol changes (`@vgw/protocols` + the seams it declares)

`@vgw/protocols` produces no proof material — it is wire types + a matcher + a PoP JWT. `ldp_vc`
stays; `claimPathToPointer` (RFC-6901) stays. Concrete edits:

- **`oid4vci.ts`** — the credential request gains a **holder-commitment extension field** carrying the
  credkit commitment-with-proof (§3.3); binding leaves the standard `proof` slot untouched. Whether
  that slot still carries a `proof_type: jwt` PoP (freshness) or is dropped is the N2 decision (§3.3,
  a vs c). Remove `CommitmentOpeningLike` and `vgw_commitment_opening` from `CredentialResponse` — no
  opening travels; the secret is the holder's, blind-signed.
- **`popJwt.ts`** — kept under (c) (the lean, §3.3), removed under (a) — the N2 decision. Under (c) it
  signs the commitment digest alongside `c_nonce`, so it proves liveness of a party holding the
  commitment (possession, not fresh knowledge — §3.3), not of a key bound to nothing. Pass the
  issuer-scoped `deriveIssuancePopSeed` result so its `kid` stays **pairwise per issuer**; do not collapse
  it to one device-wide key.
  The commitment's builder/verifier (holder `commit` / issuer `blindSign`-verify) is added regardless:
  it is the binding, orthogonal to the PoP.
- **`oid4vp.ts`** — the predicate extension generalizes. `DcqlZkAgePredicate { predicate:"age_over",
  years, claim_id }` → a credkit predicate descriptor carrying range claims (`pointer, kind, bound,
  digits`), membership claims (`pointer`), equalities, and a **params reference** (hash + fetch URL).
  The `age_over` runtime enforcement (`oid4vp.ts:364`) widens accordingly. `challenge=nonce` /
  `domain=client_id` map onto credkit's presentation header — folded *natively* by
  `presentGraph`/`verifyGraph`, or via `encodePresentationHeader` on the N=1 path (§4).
- **`dcql.ts`, `dcApi.ts`** — unchanged in shape (`claimPathToPointer` already emits the JSON pointers
  credkit consumes; the DC API carries the same DCQL).
- **vc-kit** — `bbs.ts` (sign/derive/verify) and `presentation.ts` (eddsa-rdfc-2022 VP wrapper) are
  replaced by credkit's `issueCredential` / `deriveProof`+`presentGraph` / `verifyProof`+`verifyGraph`.
  `keys.ts` swaps `@digitalbazaar/bls12-381-multikey` for `@credkit/bbs` `keyGen`; the `zUC7…` did:key
  encoding for BLS12-381-G2 and the `loader.ts` driver stay.

---

## 8. Verifier infrastructure: published params + server-side verify

Two new obligations on the verifier Workers:

1. **Publish range/set alphabets at a stable, per-verifier-single location** (e.g.
   `/.well-known/credkit-params`). Two reasons, not one. Tracking: a verifier that hands each prover
   a distinct well-formed alphabet has an undetectable tag (FINDINGS §12). Correctness:
   `createRangeParams`/`createSetParams` are **randomized** (a fresh signing scalar per call), so the
   alphabet is not reproducible — the prover must consume the *published bytes*
   (`octetsToRangeParams`/`octetsToSetParams`, validated with `verifyRangeParams`/`verifySetParams`),
   never regenerate locally, or the `paramsHash` the verifier checks will not match and every proof
   fails closed. One artifact, minted once, fetched by holder and verifier alike. `createRangeParams`
   (age digits) and `createSetParams` (residency) come from `@credkit/range`.
2. **Verify entirely in the Worker.** `verifyProof`/`verifyGraph` run server-side (pure JS, no WASM).
   Delete the client-side `verifyAgeProof` in `AgeGate.tsx`/`RentalGate.tsx`, the `zk_pending` verdict,
   and the two-runtime split exhibit. The Worker returns one verdict. This is safe by precedent: the
   shop/rentals Workers already run `jsonld` + `rdf-canonize` + bbs-2023 verify in workerd via
   `@vgw/vc-kit`; credkit's runtime graph is a lighter subset of that, minus bb.js.

---

## 9. Showcases mapped to the four properties (reusing the cast)

Personas stay: **Jamie Voss** (1996-03-14, passes), **Noa Lindqvist** (2009-11-02, fails 18+),
**Marisol Deng** (1958-06-21, senior). Noa becomes sharper: credkit's prover *throws*
("value does not fit in base^digits digits") rather than emitting a bad proof — fail-closed observed
live (FINDINGS §15).

| # | Showcase | Actors (all existing) | Properties | New credential? |
|---|---|---|---|---|
| A | **Age, any cutoff, zero correlation** — Nightcap 18+, Wheels 25+, same license, different cutoffs, no shared handle | DMV → Wallet → Nightcap, Wheels | range predicate, unlinkability, server-side verify | no (DL upgraded) |
| B | **Local-resident discount** — Wheels proves the license/registration ZIP is in Utopia's coastal block (two-sided range) or `stateFips ∈ {coastal set}` (membership), city hidden | DMV → Wallet → Wheels | set membership + range | Resident Registration |
| C | **Same person, no name** — at Wheels, present DL (over-25) **+** Resident Registration, prove one holder holds both via link-secret equality | DMV → Wallet → Wheels | composite proof + link secret | reuses B's credential |
| D *(stretch)* | **Cross-issuer link** — Nightcap *also issues* a "Regular" loyalty credential (`retail-coupon` context); later prove "over-21 **and** a Regular, same person" across two issuers | DMV + Nightcap → Wallet → Nightcap | link secret **across issuers** | Nightcap issuance (new OID4VCI Worker) |
| E *(stretch)* | **Verifiable agent delegation** — an AI agent presents a scoped delegation credential linked to the human's license by the shared secret: "I act for an over-25 licensed human," human unnamed | DMV → Wallet → Wheels | composite + link secret + predicate | delegation credential |

A–C reuse only the DMV's existing issuer. The **cross-verifier exhibit flips meaning**: today it
*confesses* the shared commitment is matchable; post-migration it demonstrates genuine
non-correlation, and C reframes linking as a *holder-elected* opt-in — the honest catch becomes a
feature toggle. FINDINGS §13 already ships the residency use cases (coastal discount, ZIP-inside-a-
state) as passing tests; B is largely a matter of pointing those at Utopia geography.

---

## 10. The rip-out

**Deleted outright:**
- `packages/zk/` entirely — Noir circuit, bb.js prove/verify wrappers, `age_check.json`/
  `age_check.vk.json` artifacts, `proveAgePredicate`/`verifyAgeProof`/`AgeProofBundle`/`warmAge*`/
  `ageCutoffDays`/`fieldHex`.
- `@vgw/keys/commitment.ts` (Poseidon2/BN254) and its `index.ts` re-exports.
- `birthDateCommitment` + `zkAgeProof` from the `vgw-v1` context; the wallet's `@vgw/zk/prove` call
  (`presentation.ts:477`) and `warmAgeProver` lazy-load.
- Shop/rentals: `assertAgeProofBundle`, client `verifyAgeProof`, the `zk_pending` verdict, the
  split-runtime exhibit (`ZkExhibit`).

**Flips meaning (keep, reframe):** cross-verifier correlation exhibit (confession → genuine
unlinkability + opt-in linking); "each verifier sees a different DID" (→ "sees no identifier"); the
`age_over` flags (→ tier-1 rung + staleness contrast).

**Replaced:** vc-kit `bbs.ts`/`presentation.ts`/`keys.ts` crypto bodies; `popJwt.ts` (retired under
freshness-option a, kept under c — §3.3); `deriveHolderSeed`/`derivePresenterSeed`; the
`vgw_commitment_opening` issuance path.

---

## 11. Consuming credkit: publish (DECIDED)

**Decision: credkit is published as versioned packages from a public repo; VGW deps `@credkit/*`
normally and pins one version.** (The monorepo-merge alternative is rejected — §3.5.)

Today credkit is a source-only, private workspace: every package is `private: true`,
`version: 0.0.0`, `main: ./src/index.ts`, wired to siblings by `workspace:*` (which resolves only
inside credkit's own workspace — so VGW cannot `file:`-link one package). Publishing therefore has
credkit-side prerequisites, done once before N2:

- Drop `private: true`; adopt real semver on every `@credkit/*` package; keep `main: src/index.ts`
  (source-publish) so consumers bundle the TS, **or** add a build step emitting `dist/*.js` + `.d.ts`
  and point `exports`/`main`/`types` at it. Source-publish is simpler and Vite/esbuild handle it; a
  built `dist` removes the `.js`→`.ts` bundler note (Appendix C) for all consumers, so lean to `dist`
  if credkit gains non-Vite consumers.
- Pin **one ciphersuite era** (`credkit-bbs-sha-2026` vs `-shake-2026`) in the release line before any
  credential is issued — it is forever for cross-credential equality (§4, FINDINGS §16).
- Publish `@credkit/{bbs,range,proofs,cryptosuite}` together at a lockstep version; VGW pins that exact
  version and bumps deliberately (the golden-vector discipline: layout changes bump the version, never
  edit hex — FINDINGS §12).

The **public repo** also simplifies §8's verifier params story: the range/set alphabets and any shared
encoder registry can be referenced/published openly rather than embedded per deployment.

---

## 12. Sequencing and risks

| Stage | Deliverable |
|---|---|
| **N0** | ✅ Worker-viability proven under workerd (spike result below); consumption **decided** — publish credkit as public packages (§11). Remaining: credkit publish prerequisites, then VGW pins a version. Full `issueCredential`/`verifyProof` under workerd deferred to N2/N3 (needs a document loader + the pinned VP envelope) |
| **N1** | Link secret in `@vgw/keys` (`deriveLinkSecret`); issuer key via `@credkit/bbs` `keyGen` |
| **N2** | DMV reissues the DL with credkit + the `date1900` twin; OID4VCI request carries the commitment-with-proof as an extension (freshness a-vs-c decided here, §3.3); drop Poseidon + opening; wallet threads the master-derived link secret and persists per-credential `secretProverBlind` |
| **N3** | Wallet `deriveProof`; shop/rentals **server-side** `verifyProof`; generalize the DCQL predicate extension; publish range params; delete client bb.js |
| **N4** | Rip out `packages/zk` + `commitment.ts`; retire the bbs-2023 / eddsa wrappers; reframe the exhibits |
| **N5** | Resident Registration credential → residency set-membership (B) and cross-credential link secret (C) via `presentGraph`/`verifyGraph` |
| **N6** | Stretch: cross-issuer loyalty (D) and/or agent delegation (E) |

N0–N4 are a strict upgrade of the *existing* age story and should land before the new showcases.
The VP-envelope work in credkit is **done** (`presentGraph`/`verifyGraph`/`statement.ts`, committed
`b3c6bed`), so N5 is unblocked — and since those entry points handle N=1 too, N2 onward can target
them directly rather than the separate `deriveProof`/`verifyProof` path (§4).

**Top risks:** (1) Worker bundle size/CPU for credkit verify — retired, see the N0 spike result
below; (2) `birth_date` XSD-canonical typing in the vDL context — fail-closed at issuance if wrong,
caught in N2; (3) credkit is a fast-moving workspace — pin a version and do not chase `main` (the
VP-envelope API is now committed and stable, but the hygiene still holds).

### N0 spike — result (run 2026-07-16)

Worker-viability is no longer a risk to retire; it is retired by direct execution. A single esbuild
bundle of the credkit runtime primitives ran unmodified under workerd (miniflare):

- `@credkit/bbs` keyGen + sign + verify + proofGen + proofVerify — the noble EC/pairing path that
  replaces bb.js: **147 KiB, workerd HTTP 200, ~146 ms**.
- The same plus `jsonld` URDNA2015 canonicalization (the other workerd-risky primitive):
  **436 KiB, workerd HTTP 200, ~168 ms**.

Both are an order of magnitude under the 3 MiB Worker script cap. `@digitalbazaar/di-sd-primitives`
(the only remaining cryptosuite runtime dependency, used for the HMAC label shuffle) already runs in
the shop Worker today via bbs-2023, so the full runtime surface is accounted for. The
predicate/composite/link-secret layer is green on the current tree — `@credkit/proofs`: 100 tests,
including the residency, ZIP-inside-a-state, age-range, and cross-issuer link-secret cases that back
showcases A–C.

Two facts the spike nailed down for whoever executes N1+: (a) credkit is consumed as **TS source
with `.js` import specifiers** (it ships no built JS), so the bundler must remap `.js`→`.ts` — a
~15-line esbuild resolve plugin does it, and Vite/the Cloudflare plugin will need the equivalent;
(b) the remaining N0 item — running the full `issueCredential`/`verifyProof` orchestration under
workerd — needs a document loader and the pinned VP envelope, i.e. it is N2/N3 work, not an open
risk. Spike harness kept under the session scratchpad (`credkit-spike/`), not committed.

---

## 13. Not settled here

- The exact wire shape of the generalized DCQL predicate extension (a `vgw_predicates` object vs.
  reusing OID4VP's evolving predicate proposals) — an N3 design pass.
- Whether the `/.well-known/credkit-params` alphabet is served static or minted-then-cached, and how
  the holder pins it against the tracking-tag risk in practice.
- Whether `credkit-bbs-sha-2026` or `-shake-2026` is the pinned era (once chosen, it is forever for
  cross-credential equality) — decided at credkit publish time (§11).
- Whether credkit source-publishes (`main: src/index.ts`) or ships a built `dist` (§11).
- OID4VCI request freshness (§3.3): **leaning (c)** — keep the standard `proof_type: jwt` PoP and have
  it sign the commitment digest, so it attests liveness of a party holding the commitment (a bare PoP
  binds a key to nothing in credkit's link-secret model). The PoP key stays **pairwise per issuer** (its
  `kid` is issuer-visible, so a reused key is a cross-issuer handle). Neither (a) nor (c) proves fresh
  *knowledge* of the link secret — the commitment is public and its PoK carries no nonce. (a) —
  token-only, no PoP — is the fallback. Confirmed at N2; the commitment-as-extension framing keeps (c)
  additive, so nothing before N2 depends on the choice.
- Whether to session/authorization-bind the holder commitment (e.g. to the OID4VCI authorization code or
  PKCE verifier), so an intercepted or replayed commitment cannot be injected into a different request.
  That strengthens anti-replay but does **not** by itself upgrade possession of the public commitment to
  fresh knowledge of the link secret. That stronger claim requires a fresh link-secret PoK whose transcript
  binds the session and, under (c), the PoP key, which may require reopening option (b)'s rejected
  `blindChallenge` change and its fixture-fidelity cost. It applies under both (a) and (c); unspecified
  here — an N2 design point.
- Credential-store backup / recovery (§6). `secretProverBlind` is random per `commit` and not
  re-derivable, so losing it bricks the credential — and passkey/PRF sync moves the master, not
  IndexedDB. A real cross-device story needs an explicit **encrypted export/backup/sync of the
  credential store** (the blind travels inside it, scalar-encoded per §7). Mechanism, cadence, and its
  correlation surface are unspecified here — an N2 design point.
- Credential status / revocation — unaddressed, and out of scope for the showcase as written. If it
  becomes needed, a status-list entry is an ordinary disclosable claim and can ride along as
  mandatory-disclosed content, but the mechanism (and its own correlation surface) is unspecified here.

---

# Appendix A — Target credkit API

Verified against `credkit/packages/*/src` on 2026-07-16. Symbols are stable; line hints drift.
Import credentials/presentations from `@credkit/cryptosuite`, alphabets from `@credkit/range`,
keys from `@credkit/bbs`.

**Keys / suites / encoders**
- `keyGen(suite, keyMaterial: Uint8Array≥32, keyInfo?) → { secretKey, publicKey }` — `@credkit/bbs`
- `getCiphersuite(SUITE_BY_FIXTURE_DIR["bls12-381-sha-256"])` — `@credkit/bbs`
- Credential suite ids `credkit-bbs-{sha,shake}-2026`; presentation suite `credkit-bbs-presentation-{sha,shake}-2026`. Pin ONE era forever (link-secret scalar is suite-dependent).
- Encoders: `date1900` (xsd:date → days since 1900-01-01), `uint64` ([0, 2⁶⁴)).

**Issue**
- `createHolderBinding(options?) → HolderBinding { linkSecret, commitmentWithProof, secretProverBlind }` — holder-side. **Pass `{ linkSecret: deriveLinkSecret(master) }`**: the default mints a *fresh random* secret per call (`issue.ts:48,57`), which breaks cross-credential linking. `secretProverBlind` is per-credential and must be persisted (losing it bricks the credential) — it is a **bigint scalar**, so scalar-encode it before `encryptJson` (§7 vault note); the link secret is re-derived from the PRF, not stored.
- `issueCredential(IssueOptions) → { verifiableCredential }`, where `IssueOptions = { document, keyPair, verificationMethod, cryptosuite?, proofPurpose?, mandatoryPointers?, numericDeclarations?: {pointer, encoder}[], holderCommitment?: commitmentWithProof, documentLoader?, hmacKey? }`
- `verifyIssuedCredential(ReceiptCheckOptions) → boolean`

**Present**
- `deriveProof(DeriveOptions) → { verifiablePresentation }` (N=1), `DeriveOptions = { verifiableCredential, selectivePointers?: string[], rangeClaims?: RangeClaimRequest[], membershipClaims?: MembershipClaimRequest[], presentationHeader: Uint8Array, holderBinding?, documentLoader?, proveOptions? }`
- `presentGraph(PresentGraphOptions) → { verifiablePresentation }` (N credentials + link secret), `PresentGraphOptions = { credentials: GraphCredentialInput[], equalities?: GraphEquality[], challenge: string, domain?, documentLoader?, proveOptions? }`; `GraphCredentialInput = { verifiableCredential, selectivePointers?, rangeClaims?, membershipClaims?, holderBinding? }`
- `RangeClaimRequest = { pointer: string, kind: "greaterOrEqual"|"lessOrEqual", bound: bigint, digits: number, params: RangeParams }` (`base^digits ≤ 2⁶⁴`)
- `MembershipClaimRequest = { pointer: string, params: SetMembershipParams }`
- `GraphEquality = GraphEqualityRef[]`; `GraphEqualityRef = { statement: number, linkSecret: true } | { statement: number, pointer: string }`

**Verify** — issuer key + nonce are verifier inputs, NEVER the wire; the verifier must restate the claim list in the same order or it fails loudly.
- `verifyProof(VerifyOptions) → { verified, document?, reason? }`, `VerifyOptions = { verifiablePresentation, publicKey: G2Point, presentationHeader: Uint8Array, expectedRangeClaims?, expectedMembershipClaims?, documentLoader? }`
- `verifyGraph(VerifyGraphOptions) → { verified, documents?, reason? }`, `VerifyGraphOptions = { verifiablePresentation, publicKeys: G2Point[], challenge, domain?, expectedRangeClaims?, expectedMembershipClaims?, expectedEqualities?, documentLoader? }`

**Alphabets** (verifier publishes, holder fetches the same copy) — `@credkit/range`
- `createRangeParams(suite, base, opts?) → RangeParams` (base 2..65536; age uses base 16, digits 4)
- `createSetParams(suite, members: bigint[], opts?) → SetMembershipParams`; `verifyRangeParams`/`verifySetParams` validate imported params.

**Age predicate**: declare `birth_date` as `date1900`; claim `{ pointer: "/credentialSubject/driversLicense/birth_date", kind: "lessOrEqual", bound: daysSince1900(today − N years), digits: 4, params }` — older = smaller number, so "N or older" is `birth_date <= cutoff`. Compute the cutoff with real calendar arithmetic (`Date.UTC(y − N, m, d)`), never day-count year approximations. `@credkit/range` throws at the prover for an underage holder (negative difference wraps past the ceiling) — the fail-closed teaching moment.

---

# Appendix B — VGW edit map (symbols stable; ~lines as of 2026-07-16)

**Delete outright**
- `packages/zk/**` — Noir `circuit/age_check/`, artifacts `artifacts/age_check.{json,vk.json}`, wrappers `prove.ts`/`verify.ts`/`bundle.ts`/`cutoff.ts`/`encoding.ts` (package `@vgw/zk`).
- `packages/keys/src/commitment.ts` (Poseidon2/BN254: `BN254_SCALAR_FIELD`, `daysSinceEpoch`, `createCommitment`, `verifyCommitment`) + its `index.ts` re-exports.
- `"@vgw/zk"` dep in `apps/{wallet,shop,rentals}/package.json`.

**Rip-out consumers (touch points)**
- Wallet prover — `apps/wallet/src/services/presentation.ts`: the ONLY `proveAgePredicate` site (~477); `ageCutoffDays` (~50), `normalizeFieldHex` (~51); `apps/wallet/src/App.tsx` `warmAgeProver` (~45).
- Shop verifier — `apps/shop/worker/policy.ts` `assertAgeProofBundle`/`ageCutoffDays`/`normalizeFieldHex` (~18), `evaluateZkAgePolicy`/`zk_pending` (~84); `apps/shop/src/components/AgeGate.tsx` client `verifyAgeProof` (~78), `allowed` gate (~585), `ZkExhibit` (~282).
- Rentals verifier — `apps/rentals/worker/policy.ts` (~26; `evaluateZkRoute` ~187; years 25); `apps/rentals/src/components/RentalGate.tsx` client verify (~74), `ZkExhibit` (~301), correlation caveat (~282).
- Issuance commitment — `apps/dmv/worker/index.ts` `createCommitment` (~435), `vgw_commitment_opening` (~457); wallet `services/issuance.ts` opening store/validate (~307, ~519), `services/demo.ts` (~80).

**Replace (crypto bodies → credkit)**
- `packages/vc-kit/src/bbs.ts` — `signCredential`(~66)/`deriveCredential`(~102)/`verifyCredential`(~148), `DEFAULT_MANDATORY_POINTERS=['/issuer','/validFrom','/validUntil']`(~40) → `issueCredential` / `deriveProof`+`presentGraph` / `verifyProof`+`verifyGraph`.
- `packages/vc-kit/src/presentation.ts` — eddsa-rdfc-2022 `signPresentation`(~55; `properties` hook carries `zkAgeProof` ~83)/`verifyPresentation`(~117) → credkit VP proof; no presenter signature (deleted).
- `packages/vc-kit/src/keys.ts` — `generateBbsKeyPair` (@digitalbazaar/bls12-381-multikey) → `keyGen` (@credkit/bbs); did:key `zUC7` + `loader.ts` driver (~38) stay.
- `packages/vc-kit/src/credentials/utopia-dl.ts` — drop `birthDateCommitment`(~124); add a numeric declaration for `/credentialSubject/driversLicense/birth_date`; keep `AGE_OVER_FLAGS=[18,21,25]`(~58) as the tier-1 rung (§5). DL subject shape: `credentialSubject.driversLicense = { document_number, given_name, family_name, birth_date, age_over_{18,21,25}, issuing_authority, issuing_country, un_distinguishing_sign, issue_date, expiry_date }`.
- `packages/vc-kit/src/contexts/vgw-v1.json` — remove `birthDateCommitment` + `zkAgeProof` terms.

**Protocol edits — hardcoded strings (grep targets)**

| String | File (~line) | Change |
|---|---|---|
| `"ldp_vc"` | oid4vci.ts:43; oid4vp.ts:71, :301 | keep (credkit is still ldp_vc) |
| `proof_type:"jwt"` | oid4vci.ts:88 | keep (freshness, option c) or drop (option a); binding rides a separate request extension — §3.3 |
| `CommitmentOpeningLike`, `vgw_commitment_opening` | oid4vci.ts:97, :116 | remove |
| `"openid4vci-proof+jwt"` / `"EdDSA"` | popJwt.ts:17, :131 | keep (option c) or remove (option a); add commit/blindSign verify for binding regardless — §3.3 |
| `"age_over"` | oid4vp.ts:58, :364 | generalize `DcqlZkAgePredicate` → range/membership/equality + params ref |
| `claimPathToPointer` | dcql.ts:35 | keep (same RFC-6901 pointers) |
| `"openid4vp-v1-unsigned"` | dcApi.ts:19 | keep |

**Keys edits**
- `packages/keys/src/hierarchy.ts` — keep `PRF_EVAL_INPUT="vgw/v1/master-secret"`(~21); ADD `deriveLinkSecret(master)` under a new **non-origin-scoped** info `vgw/v1/link-secret`; REPLACE `deriveHolderSeed`(~76) with `deriveIssuancePopSeed(master, issuerOrigin)` under pairwise info `vgw/v1/issuance-pop:<issuer-origin>` when option (c) is selected; `derivePresenterSeed`(~87) is vestigial.
- `packages/keys/src/vault.ts` — the persisted per-credential envelope is `{ verifiableCredential, secretProverBlind }` (**not** `linkSecret` — it is re-derived from the PRF, §6). Watch the encoding: `secretProverBlind` is a **bigint scalar** (`Scalar = bigint`, `credkit/packages/bbs/src/core.ts:18`), and `encryptJson` calls `JSON.stringify`, which *throws* on a bigint. Encode it at the persistence boundary — `i2osp(secretProverBlind, 32)` → base64url, reusing `@credkit/bbs`'s `i2osp`/`os2ip` (`utils.ts:25,38`) rather than a hand-rolled encoder — and `os2ip` + range-check (`< r`) on read. `encryptJson`/`decryptJson` themselves stay JSON-only; scalars never reach them raw.
- `apps/wallet/src/services/db.ts` — credential-store **schema migration** (v2→v3): the stored payload today is the `encryptJson` output of `{ vc, commitmentOpening? }`; drop the Poseidon-era `commitmentOpening` and add the encoded `secretProverBlind`. Bump the `idb` version and add the upgrade path; decode/validate blinds on retrieval.

**New (N5)**
- `packages/vc-kit/src/credentials/utopia-resident.ts` — Utopia Resident Registration, DMV-issued, numeric declarations `stateFips` (uint64, set-membership) + `postalCode` (uint64, range); reuse `citizenship-v1/v3` contexts.
- `/.well-known/credkit-params` on shop + rentals serving `createRangeParams` (age) / `createSetParams` (residency); server-side `verifyProof`/`verifyGraph` in the Worker; delete client-side verify.

---

# Appendix C — N0 spike (Worker-viability, done 2026-07-16)

**Result.** `@credkit/bbs` keyGen+sign+verify+proofGen+proofVerify (the noble EC/pairing path that
replaces bb.js) = **147 KiB, workerd HTTP 200, ~146 ms**; the same plus `jsonld` URDNA2015 =
**436 KiB, workerd HTTP 200, ~168 ms** (3 MiB Worker cap). `@credkit/proofs` = **100 tests green** on
the current tree (residency, ZIP-in-state, age-range, cross-issuer link secret). `di-sd-primitives`
already runs in the shop Worker via bbs-2023.

**The one non-obvious requirement** (credkit ships TS source with `.js` import specifiers, no built
JS — until it publishes a `dist`, §11): the bundler must remap `.js`→`.ts`. esbuild resolve plugin:
```js
const tsFromJs = { name: 'ts-from-js', setup(b) { b.onResolve({ filter: /\.js$/ }, (a) => {
  if (a.kind === 'entry-point' || !a.path.startsWith('.')) return;
  const abs = path.resolve(a.resolveDir, a.path);
  if (existsSync(abs)) return;                    // a real .js
  const ts = abs.replace(/\.js$/, '.ts');
  if (existsSync(ts)) return { path: ts };
}); } };
```
Run under workerd via miniflare 4: `new Miniflare({ modules: true, script, compatibilityFlags: ['nodejs_compat'] })` → `dispatchFetch`. VGW's worker build (Vite + `@cloudflare/vite-plugin`) needs the equivalent `.js`→`.ts` resolution for credkit source, **or** credkit publishes a built `dist` and the problem disappears. Repro harness lived in the session scratchpad (`credkit-spike/`), not committed.
