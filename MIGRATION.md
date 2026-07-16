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
5. **Consume credkit as Git dependencies pinned to one commit sha from the public repo**
   (github.com/tmarkovski/credkit) — decided 2026-07-16, validated the same day (§11, Appendix C
   addendum), superseding this decision's earlier npm-publish wording. VGW package.json deps name
   the plain lockstep version; a single `pnpm-workspace.yaml` `overrides` block rewrites every
   `@credkit/*` spec — including the `workspace:*` specs inside credkit's git-dep tarballs, which
   pnpm does not convert at pack time — to `github:tmarkovski/credkit#<sha>&path:/packages/<name>`.
   One sha, one place, bumped deliberately. The monorepo-merge alternative (§11) stays rejected — it
   couples two release cadences; npm publish stays available later without rework (manifests are
   publish-ready since credkit `8fdb3cf`). Source-publish holds (Vite/esbuild compile credkit's TS
   `main`), subject to the `.js`→`.ts` bundler note in Appendix C.

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
  documentLoader,                                // @vgw/vc-kit: every bundled VGW context, offline
});
// wallet persists versioned { vc: verifiableCredential, secretProverBlind: <base64url> } in the vault;
// the blind is per-credential (random, not re-derivable). The link secret is re-derived, not stored.
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
  presentationHeader, holderBinding: binding, documentLoader,
});

// NEW (N5): two credentials, prove same holder, reveal neither identity
const vp = await presentGraph({
  credentials: [{ verifiableCredential: dl,         rangeClaims: [/* over-25 */], holderBinding },
                { verifiableCredential: residentId, membershipClaims: [/* coastal ZIP */], holderBinding }],
  equalities: [[{ statement: 0, linkSecret: true }, { statement: 1, linkSecret: true }]],
  challenge, domain, documentLoader,
});
```

**Verify** (shop/rentals Worker — now the *whole* check, server-side):
```ts
const expectedIssuerDid = await trustedIssuerDid(env); // pin/config or existing TLS metadata discovery
const r = await verifyPresentation({                  // VGW policy facade over credkit verifyGraph
  presentation: verifiablePresentation,
  expectedIssuerDids: [expectedIssuerDid],            // verifier policy, statement order — never the wire
  challenge, domain, documentLoader,
  expectedRangeClaims: [{ statement: 0, pointer: ".../birth_date",
                          kind: "lessOrEqual", bound: daysSince1900(cutoff18), digits: 4 }],
  now: new Date(),
});
// r.verified === true → one verdict, no zk_pending, no client-side bb.js
```

`verifyPresentation` above deliberately remains a VGW policy facade, not a rename of credkit's
`verifyGraph`. For each statement it takes the expected issuer DID from verifier configuration/policy,
decodes that self-certifying `did:key:zUC7…` into the 96-byte compressed BLS12-381 G2 key,
validates the multicodec/length/curve point, and passes the ordered raw keys to credkit. Only after the
cryptographic result is true does it accept the proof-bound input and enforce the policies VGW already
has: the revealed `issuer` must equal the configured DID; that statement's proof
`verificationMethod` must be controlled by the same DID; and `validFrom <= now <= validUntil` for the
disclosed bounds. Any mismatch makes the facade return `verified: false`. For N statements,
`expectedIssuerDids[i]`, `publicKeys[i]`, the input credential proof, and credkit's returned
`documents[i]` stay positionally aligned. Never select a key from an issuer or public-key value carried
by the presentation itself.

Four credkit invariants VGW must honor. First, the verifier **restates the claim list — and the
equalities — in the same order** the proof carries them (a mismatch is a loud typed failure, not a
silent pass — FINDINGS §11/§15; `verifyGraph` takes `expectedEqualities` beside
`expectedRangeClaims`/`expectedMembershipClaims`, and a link-secret linkage the verifier did not
demand fails closed). Second, **one ciphersuite across a whole presentation** (the link-secret
scalar is suite-dependent — a `sha` credential and a `shake` credential can never share an equality,
FINDINGS §16); VGW pins `credkit-bbs-sha-2026` everywhere, forever. Third, on the N=1
`deriveProof`/`verifyProof` path only, VGW itself encodes `challenge`+`domain` into the opaque
`presentationHeader` (credkit exports `encodePresentationHeader`) — the native folding lives in
`presentGraph`/`verifyGraph`, one more reason to prefer them. Fourth, pass VGW's existing strict,
offline `documentLoader` to **every** credkit issue/present/verify call. Credkit's default loader knows
only the VC v2 context and rejects the vDL, AAMVA, VGW, and resident context URLs; relying on the
default makes N2 issuance fail before any proof is produced.

---

## 5. Credential redesign

**Utopia Driver's License** — minimal *visible* change, large *capability* change
(`packages/vc-kit/src/credentials/utopia-dl.ts`):

- **Remove** `birthDateCommitment` (the Poseidon handle) and, from `vgw-v1.json`, the
  `birthDateCommitment` and `zkAgeProof` terms. Staged (N2 status): the DMV and the wallet demo no
  longer emit the field; `buildUtopiaDriversLicense` keeps a deprecated OPTIONAL `birthDateCommitment`
  input and `vgw-v1.json` keeps its terms until N4 — the shop/rentals suites still exercise the old
  flow and need them (harmless while unused by the live issuers).
- **Add** a numeric declaration for `/credentialSubject/driversLicense/birth_date` (`date1900`) —
  invisible metadata bound into the base proof's third header segment, not a document field, so the
  revealed credential is still valid JSON-LD (FINDINGS §14).
- **Keep** the `age_over_{18,21,25}` flags. They are ordinary disclosable claims and stay as the
  **tier-1 rung and the teaching contrast** ("frozen at issuance; staleness is the point — the
  predicate proves any cutoff live"). Their staleness argument survives intact.
- **Change in N2:** `vc-kit/src/contexts/vdl-v1.json` currently types `birth_date` as `xsd:dateTime`,
  while `utopia-dl.ts` emits `YYYY-MM-DD` and credkit's `date1900` encoder accepts only `xsd:date`.
  Change that exact `@type` to `http://www.w3.org/2001/XMLSchema#date` and add an end-to-end
  issue/derive/verify test using VGW's loader. The value must remain XSD-canonical and non-mandatory so
  the twin is hideable; otherwise the credkit pipeline fails closed at issuance (FINDINGS §14).
- **Unchanged residual:** `validFrom`/`validUntil` remain mandatory-disclosed and date-granular — a
  small correlation vector credkit does not (and cannot) remove; the DL already documents this.

**NEW — Utopia Resident Registration** (issued by the *same* DMV): carries `stateFips` (`uint64`,
set-membership) and `postalCode` (`uint64`, two-sided range), both numeric-declared. This one
addition powers *both* new showcases (residency set-membership **and** cross-credential link secret)
but **cannot reuse `citizenship-v1/v3` alone**: neither context defines `stateFips` or `postalCode`
with a datatype accepted by credkit's `uint64` encoder. Add a bundled
`https://verygoodwallet.com/contexts/utopia-resident/v1` context defining the resident credential/type
and both predicate fields as canonical `xsd:unsignedInt` literals; citizenship v3 may still supply its
ordinary person/address vocabulary. Register the new URL in `BUNDLED_CONTEXTS` and pass the same
offline loader through issuance, presentation, and verification.

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
  for transport-level plumbing. *(Retired outright at N4 — no transport use existed; the inspector
  tree now narrates the absence.)*
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

- **`oid4vci.ts`** — done at N2: the credential request gained the **holder-commitment extension
  field `vgw_holder_commitment`** — base64url of the credkit commitment-with-proof bytes (§3.3);
  binding leaves the standard `proof` slot untouched, which still carries the `proof_type: jwt` PoP
  (option (c), decided §13 and implemented at N2). `CommitmentOpeningLike` and
  `vgw_commitment_opening` are removed from `CredentialResponse` — no opening travels; the secret is
  the holder's, blind-signed.
- **`popJwt.ts`** — kept under (c) and implemented at N2: the payload gains the VGW claim
  **`vgw_commitment_digest`** — base64url SHA-256 over the raw `vgw_holder_commitment` bytes
  (`commitmentDigest` in @vgw/protocols, plain WebCrypto) — signed alongside `c_nonce`, so the JWT
  proves liveness of a party holding the commitment (possession, not fresh knowledge — §3.3), not of
  a key bound to nothing; `verifyProofJwt` takes `expectedCommitmentDigest` and fails closed when the
  claim is absent or mismatched. Pass the issuer-scoped `deriveIssuancePopSeed` result so its `kid`
  stays **pairwise per issuer**; do not collapse it to one device-wide key.
  The commitment's builder/verifier (holder `commit` / issuer `blindSign`-verify) rides through the
  vc-kit facade (`createHolderBinding` re-export / `issueCredkitCredential`): it is the binding,
  orthogonal to the PoP.
- **`oid4vp.ts`** — the predicate extension generalizes; wire shape **settled at the N3 design
  pass (Appendix D.1)**. `DcqlZkAgePredicate`/`vgw_zk` is deleted and replaced by a per-query
  `vgw_predicates` object: range claims over hidden twins (`path, kind, bound, digits,
  params_hash`), a `params_uri` pointing at the verifier's published alphabets (D.3), an explicit
  predicate-route `claim_set` (the claims disclosed alongside), and reserved-but-rejected slots for
  `membership` and top-level `vgw_equalities` (N5). `challenge=nonce` / `domain=client_id` map onto
  credkit's presentation header — folded *natively* by `presentGraph`/`verifyGraph`, or via
  `encodePresentationHeader` on the N=1 path (§4).
- **`dcql.ts`, `dcApi.ts`** — unchanged in shape (`claimPathToPointer` already emits the JSON pointers
  credkit consumes; the DC API carries the same DCQL).
- **vc-kit** — remains VGW's facade. `bbs.ts` delegates crypto to credkit's `issueCredential` /
  `deriveProof`+`presentGraph` / `verifyProof`+`verifyGraph`, while `presentation.ts` drops the
  eddsa-rdfc-2022 presenter signature but retains the verifier-facing policy wrapper described in §4.
  Do not replace `verifyCredential`/`verifyPresentation` with bare re-exports: the facade still owns
  expected-issuer, proof-verification-method, and validity-window enforcement. *As executed
  (N2/N3):* the credkit bodies live in **parallel facade modules** (`credkit.ts`,
  `credkitPresentation.ts`, `credkitParams.ts` — Appendix D.4) with those policy semantics ported
  verbatim; `bbs.ts`/`presentation.ts` stay byte-identical with no live callers and die at N4
  (Appendix B Replace note).
- **Issuer key bridge** — `keys.ts` swaps key generation to `@credkit/bbs` `keyGen` and adds inverse,
  tested `bbsDidKeyFromPublicKey(G2Point)` / `bbsPublicKeyFromDidKey(did:key:zUC7…)` helpers. The first
  preserves the issuer DID published as `vgw_issuer_did` — and more than the encoding survives:
  **verified at N1 by a pinned cross-library vector, `@credkit/bbs` `keyGen` and the incumbent
  `@digitalbazaar` generator derive the *same key pair* from the same seed** (both implement the IETF
  BBS KeyGen), so a fixed `ISSUER_SEED` keeps the DMV's DID stable across the N2 issuance swap — no
  verifier re-discovery churn. The second decodes only the BLS12-381-G2
  multicodec, requires exactly 96 compressed key bytes, validates the point, and supplies Credkit's raw
  trust anchor. `TRUSTED_ISSUER_DID` remains the production pin; no raw key is accepted from the VP.
- **JSON-LD loader** — keep `loader.ts`, its offline `BUNDLED_CONTEXTS`, and the `zUC7…` driver. Pass
  its exported `documentLoader` explicitly to every Credkit call; add the resident context in N5.

---

## 8. Verifier infrastructure: published params + trusted server-side verify

Three obligations on the verifier Workers:

1. **Publish range/set alphabets at a stable, per-verifier-single location** (e.g.
   `/.well-known/credkit-params`). Two reasons, not one. Tracking: a verifier that hands each prover
   a distinct well-formed alphabet has an undetectable tag (FINDINGS §12). Correctness:
   `createRangeParams`/`createSetParams` are **randomized** (a fresh signing scalar per call), so the
   alphabet is not reproducible — the prover must consume the *published bytes*
   (`octetsToRangeParams`/`octetsToSetParams`, validated with `verifyRangeParams`/`verifySetParams`),
   never regenerate locally, or the `paramsHash` the verifier checks will not match and every proof
   fails closed. One artifact, minted once, fetched by holder and verifier alike. `createRangeParams`
   (age digits) and `createSetParams` (residency) come from `@credkit/range`. **Settled at N3
   (Appendix D.3): deterministic seed-derived mint** — the alphabet derives from a verifier secret
   via the IETF `seeded_random_scalars` generator, so every isolate serves byte-identical params
   with zero storage, published as JSON at `/.well-known/credkit-params`.
2. **Verify entirely in the Worker.** `verifyProof`/`verifyGraph` run server-side (pure JS, no WASM).
   Delete the client-side `verifyAgeProof` in `AgeGate.tsx`/`RentalGate.tsx`, the `zk_pending` verdict,
   and the two-runtime split exhibit. The Worker returns one verdict. This is safe by precedent: the
   shop/rentals Workers already run `jsonld` + `rdf-canonize` + bbs-2023 verify in workerd via
   `@vgw/vc-kit`; credkit's runtime graph is a lighter subset of that, minus bb.js.
3. **Keep trust and credential policy outside the primitive.** Shop/rentals keep discovering or
   pinning `TRUSTED_ISSUER_DID` exactly as today. The vc-kit facade converts those configured DIDs — in
   statement order for `verifyGraph` — to raw G2 keys, invokes Credkit, then checks the proof-bound
   issuer/verification-method relationship and validity period before returning success. Credkit
   intentionally does none of those application-policy checks; a bare `verified: true` is necessary
   but not sufficient for a VGW acceptance verdict.

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

*Executed at N3 (consumer call sites) + N4 (packages, files, deps, exhibit
reframes) — see the §12 rows for the as-run record. Two files joined the list
during execution: vc-kit's `loader.ts` and `jsigsErrors.ts` turned out to be
legacy-only (nothing but `bbs.ts`/`presentation.ts` imported them — the
credkit facade has its own strict offline loader), so they died with the
stack, which is what let the entire `@digitalbazaar/*`+`jsonld-signatures`
dependency graph and the workerd `import.meta.url` define workaround go.*

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

## 11. Consuming credkit: pinned Git dependencies (DECIDED, validated)

**Decision (2026-07-16, superseding the earlier npm-publish wording): credkit stays a public
source-only repo, and VGW consumes `@credkit/*` as Git dependencies pinned to one commit sha.**
(The monorepo-merge alternative stays rejected — §3.5; npm publish remains available later without
rework.)

Done in credkit `8fdb3cf` (one commit, before N1): every `@credkit/*` manifest dropped
`private: true`, adopted lockstep `0.1.0`, and gained `license` (Unlicense), `files: ["src"]`,
`repository` (+`directory`), `engines`, `sideEffects: false`. `main` still points at `src/index.ts`
— source-publish holds; a built `dist` becomes interesting only if credkit later publishes to npm
for non-Vite consumers.

Mechanics on the VGW side (validated end-to-end — Appendix C addendum):

- **The pin lives in exactly one place**: a `pnpm-workspace.yaml` `overrides` block maps all four
  `@credkit/*` names to `github:tmarkovski/credkit#<sha>&path:/packages/<name>`. Overrides rewrite
  every spec before resolution — including the `workspace:*` specs inside credkit's git-dep tarballs
  (pnpm does not convert those at pack time) and the plain `"0.1.0"` version specs VGW's package.json
  deps carry. Bump the sha there and nowhere else.
- `tooling/credkit-ts-resolver.ts` remaps credkit's `.js` import specifiers to the `.ts` sources; it
  is registered in the four app vite configs and every vitest config whose tests reach credkit,
  alongside vitest `server.deps.inline: [/@credkit\//]` (vitest would otherwise hand the TS source to
  raw Node) and dev-mode `optimizeDeps.exclude` for all four packages (prebundling bypasses resolveId
  plugins).
- **The ciphersuite era is pinned: `credkit-bbs-sha-2026`** (decided 2026-07-16) — forever, for
  cross-credential equality (§4, FINDINGS §16).
- Version bumps follow the golden-vector discipline: layout changes bump the pinned sha/version,
  never edit hex (FINDINGS §12).

The **public repo** also simplifies §8's verifier params story: the range/set alphabets and any shared
encoder registry can be referenced/published openly rather than embedded per deployment.

---

## 12. Sequencing and risks

| Stage | Deliverable |
|---|---|
| **N0** | ✅ Complete. Worker-viability proven under workerd (spike below); consumption decided **and validated** — Git deps pinned by sha via pnpm overrides (§11, Appendix C addendum); credkit `8fdb3cf` is consumable and VGW is wired (resolver plugin, vitest inlining, optimizeDeps excludes) with the full typecheck/test/build/smoke pipeline green. Full `issueCredential`/`verifyProof` under workerd deferred to N2/N3 (needs a document loader + the pinned VP envelope) |
| **N1** | ✅ Complete (additive — live callers flip at N2). `deriveLinkSecret(master)` under the non-origin-scoped `vgw/v1/link-secret` info + a link-secret branch in the inspector tree; vc-kit gains `generateCredkitBbsKeyPair` (era pinned in `credkitCiphersuite()`), `bbsDidKeyFromPublicKey`, `bbsPublicKeyFromDidKey`, with round-trip and rejection vectors (wrong codec, bad length, off-curve, identity). Bonus finding: credkit `keyGen` ≡ digitalbazaar KeyGen from the same seed (pinned cross-library test) — the N2 swap keeps the issuer DID stable |
| **N2** | ✅ Complete — the DMV blind-issues the DL via credkit (`credkit-bbs-sha-2026`, `date1900` twin, offline loader; issuer DID unchanged per the N1 finding), the wallet threads the master-derived link secret, runs the holder receipt check, and persists the v3 envelope `{ version: 3, vc, secretProverBlind }` (IndexedDB DB_VERSION 3 clears pre-credkit credential records — reissuance, per Appendix B). Wire names (§7): request extension `vgw_holder_commitment`, PoP claim `vgw_commitment_digest`; no `vgw_commitment_opening` travels. `deriveHolderSeed` → `deriveIssuancePopSeed` (`vgw/v1/issuance-pop:<origin>`). Full blind issuance also validated under workerd against the built Worker artifact (closing N0's deferred issuance item). **Branch note:** N2 and N3 land on branch `credkit-flip`; between them the wallet stores credkit credentials it cannot yet present — the presentation path (and the DMV-facing e2e suites) still speak the old stack and are rewritten at N3. The wallet presentation/pipeline unit suites stay GREEN meanwhile: they mint their own bbs-2023 fixtures against the deliberately-retained legacy stack (an earlier draft predicted them red; the retained-until-N4 compatibility keeps them alive). **Transitional, die at N4:** the `vgw-v1.json` `birthDateCommitment`/`zkAgeProof` terms, `buildUtopiaDriversLicense`'s deprecated optional `birthDateCommitment` input, and `commitment.ts` (shop/rentals old-flow suites still exercise them). The demo-issuer seed is now `hkdfDerive(master, "vgw/v1/demo-issuer")` (it used to borrow the removed holder branch) |
| **N3** | ✅ Complete — the wallet presents and the verifiers verify via credkit, end to end. **Wire (D.1):** `vgw_zk`/`DcqlZkAgePredicate` deleted; per-query `vgw_predicates` (`params_uri`, `range` claims over hidden twins, explicit `claim_set`) validated in `assertDcqlQuery`, with `membership` and top-level `vgw_equalities` reserved-and-rejected-loudly until N5. **Wallet:** `presentation.ts` rewritten onto the vc-kit facade — `presentGraph` via `createCredkitPresentation` (not the N=1 `deriveProof` this row once named; §4 already preferred the graph path, and challenge/domain fold natively), holder binding re-derived from the master + the v3 envelope's scalar-decoded blind, structural-only tier-2 availability (`credkitNumericDeclarations`), the D.3 pinning ritual before any proof, and the §9 fail-closed prover throw surfaced as a friendly error. The VP carries **no holder identifier** — the presenter-key step (and its pairwise DID) is retired, not rotated. **Verifiers:** shop + rentals verify the WHOLE presentation in the Worker through `verifyCredkitPresentation` (configured DID → `bbsPublicKeyFromDidKey` → validated G2 anchor → `verifyGraph` → issuer equality, verification-method control, validity windows); per-request DCQL offers pinned into the HMAC-signed state token and restated from it (D.2), route-picked by the `summarizeCredkitPresentation` claim-count peek; `/.well-known/credkit-params` served from the deterministic `CREDKIT_PARAMS_SEED` mint (D.3; `run_worker_first` + CORS-open in both wranglers). **Deleted at N3:** client `verifyAgeProof` + the bb.js warm-ups (`AgeGate`/`RentalGate`, both verifier `App.tsx`s), the wallet's `@vgw/zk/prove` call + `warmAgeProver`, the `zk_pending` verdict, `ZkExhibit`, the split-runtime exhibit, and the wallet db's dead `LegacyCredentialPayload`/`CommitmentOpening` types; the DMV↔verifier e2e suites flipped off the old stack (the `LegacyCredentialResponse` shim is gone — they now blind-issue and range-prove under workerd). Package deletions (`packages/zk`, `commitment.ts`, the bbs-2023/eddsa wrappers and their `vgw-v1`/builder residue) remain N4 (Appendix B timing note) |
| **N4** | ✅ Complete — the rip-out and the exhibit reframe. **Deleted:** `packages/zk/**` (package `@vgw/zk` + its `"workspace:*"` entries in the three app manifests), `packages/keys/src/commitment.ts` + its tests/re-exports (and `poseidon-lite` from `@vgw/keys`), `derivePresenterSeed`/`presenterInfo`/`PRESENTER_INFO_PREFIX` + `describeHierarchy`'s `verifierOrigins` presenter branch, and the whole vc-kit legacy stack — `bbs.ts`, `presentation.ts`, `ed25519.ts`, plus the legacy-only `loader.ts`/`jsigsErrors.ts` (nothing but the dead stack imported them; the credkit path has its own strict loader), the legacy `generateBbsKeyPair`, the legacy types (`BbsKeyPair`/`BbsSigner`/`Ed25519*`/`Verify*Result`/`PresentedCredentialResult`), their suites (`vc-kit.test.ts`, `presentation.test.ts`; the builder tests moved to `utopia-dl.test.ts`), the `vgw-v1.json` `birthDateCommitment`/`zkAgeProof` terms (file + URL kept, now term-empty), and `buildUtopiaDriversLicense`'s deprecated `birthDateCommitment` input. The bb.js-era `public/_headers` COOP/COEP files (wallet/shop/rentals) died too — cross-origin isolation served only multithreaded WASM. **Dependency prune (proven by the full gauntlet):** all nine `@digitalbazaar/*` deps + `jsonld-signatures` left `@vgw/vc-kit` (only `@credkit/*` + `@scure/base` remain; the `di-sd-primitives` shim stays — credkit's own runtime dep); lockfile −44 packages. The `shims.d.ts` mirror now declares only `di-sd-primitives`. **Vite-workaround verdict: REMOVED** — with `credentials-context` out of every Worker bundle, the `import.meta.url` `define` left all three worker vite configs, and all three built bundles boot green under workerd (`smoke` scripts; DO round-trips included), exactly as the doc predicted. **Unlisted consumers handled:** `apps/dmv/worker/offers.ts` got a local `birthDateToEpochDays` (same regex + UTC-round-trip idiom, same epoch-days comparisons — offer validation semantics unchanged, still API-tested); the wallet's `CredentialDetail` "Verify" action (the deferred TODO(N3)) rewired from the bbs-2023 derive/verify roundtrip to the credkit **holder receipt check** (`verifyIssuedCredkitCredential` against the re-derived link secret + the envelope's decoded blind). **Reframed (§10):** cross-verifier exhibit (`VerifierViews`, `activity.ts` — confession → genuine non-correlation + holder-elected linking; also fixed the stale tier-2 exclusion prefix, `"proven in zero knowledge"` → `"proven, not shown"`, keeping the legacy prefix for old log entries), the tour script (same 14 stops / 12 numbered, narration now blind-issuance + hidden-twin + server-verdict + no-identifier), `DerivationTree` (the missing presenter branch narrated as the exhibit), Welcome/Home/Offer/CredentialCard/dmv-footer copy (bbs-2023/Poseidon → credkit), the landing page 01/cast/stamped-finale prose + hierarchy line (banner untouched), and the landing writeup teaser reframed as pre-credkit field notes (the writeup itself stays historical — out of scope). README: hierarchy diagram (link secret + issuance-PoP, no presenter branch), tier table (range predicate, server-side verify), the §0 confession paragraph → non-correlation + elective linking, colophon + repo layout. PLAN.md: supersession header + `[superseded]` markers on the four false spots. DEPLOY.md: e2e descriptions rewritten to the credkit flows; the `packages/zk` artifacts section replaced with its obituary. **Cross-library equality test** died with the digitalbazaar generator; the pinned did:key vector in `credkit-keys.test.ts` now carries that guarantee (provenance noted inline). **Counts:** 471+12 → **393 passed + 12 e2e-gated** (zk −27; keys 75→56: commitment −18, hierarchy −3/+2 presenter-branch swap; vc-kit 78→46: legacy suites −38, equality −1, utopia-dl +7); e2e green: shop 33/33, rentals 24/24, dmv 41/41 (`VGW_E2E=1` — the DMV has no gated suite of its own; its Worker is exercised by the shop/rentals e2e boots) |
| **N5** | Two commits (D.5 staging). **N5a ✅ landed — foundation + issuance:** bundled `https://verygoodwallet.com/contexts/utopia-resident/v1` (credential/subject types, `districtName`, `stateFips` + `postalCode` coerced `xsd:unsignedInt`); `buildUtopiaResidentRegistration` + `UTOPIA_RESIDENT_NUMERIC_DECLARATIONS` (`uint64` twins at `/credentialSubject/stateFips` and `/credentialSubject/postalCode`; values serialized as canonical decimal STRINGS whose context typing is pinned by an issuance-fails-closed regression — see the D.5 as-executed note); the shared Utopia geography (six districts, coastal 11/12/13 vs inland 21/22/23, disjoint 5-digit postal blocks; crypto-free `@vgw/vc-kit/geography` subpath so the DMV UI's dropdown pulls no credkit); vc-kit set-params mirror (`mintSeededSetParams`/codec/hash/`verifySetParams`) + `membershipClaims` pass-through on `createCredkitPresentation`; protocols params document gains fail-closed `sets` validation (D.5.5 shape). The DMV issues `utopia_resident_registration` as a second configuration — offer-body discriminator (`credential_configuration_id`, absent = DL for API compat), district/postal validated against the geography, same blind-issuance ritual and issuer DID — **plus a hardening the two-config world forced: the signed pre-auth code and access token now bind the offered configuration id** (pre-N5 they bound nothing — one config made the constant check sufficient; now the credential endpoint refuses a token↔request mismatch and the legacy unbound shape, both pinned by vectors). Wallet: offer→issue path needed ZERO changes (config-agnostic — proven by a resident-offer flow test); rendering gained the resident kind label + flat-subject claims view. Facade-level showcase-B tests land here (membership happy/wrong-set/non-member-throw; two-sided postalCode range), wired to live verifiers at N5b. Counts: 393+12 → **432 passed + 12 e2e-gated** (vc-kit 46→66, protocols 104→106, dmv 41→56, wallet 81→83). **N5b next — showcases live:** rentals publishes `sets` + the coastal policy and the composite "coastal resident rate" flow (D.5.3/6), the wallet's N3 rejections (`membership`, `vgw_equalities`, multi-query) come out (D.5.7), residency set-membership (B) + cross-credential link secret (C) verified end-to-end via `presentGraph`/`verifyGraph` |
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

- ~~The exact wire shape of the generalized DCQL predicate extension~~ — **decided 2026-07-16 (N3
  design pass): a vendor `vgw_predicates` object per credential query**, with a reserved top-level
  `vgw_equalities` slot for N5; OID4VP's upstream predicate proposals remain unsettled and are not
  adopted. Full shape: Appendix D.1; restatement discipline: D.2.
- ~~Whether the `/.well-known/credkit-params` alphabet is served static or minted-then-cached~~ —
  **decided 2026-07-16 (N3): deterministic seed-derived mint, cached per isolate, zero storage**
  (Appendix D.3). Holder pinning in practice: same-origin `params_uri`, the double hash check
  (document `hash` + DCQL `params_hash`), one-time `verifyRangeParams`, and caching by hash — the
  residual honest-but-curious per-session-alphabet risk stays documented rather than solved (D.3).
- ~~Whether `credkit-bbs-sha-2026` or `-shake-2026` is the pinned era~~ — **decided 2026-07-16:
  `credkit-bbs-sha-2026`**, forever (cross-credential equality never crosses eras; §11).
- ~~Whether credkit source-publishes or ships a built `dist`~~ — **resolved by the Git-dependency
  channel (§11): source-publish.** A `dist` build returns to the table only if credkit later
  publishes to npm for non-Vite consumers.
- OID4VCI request freshness (§3.3): **decided (c), 2026-07-16 — ahead of the N2 checkpoint** — keep
  the standard `proof_type: jwt` PoP and have it sign the commitment digest, so it attests liveness
  of a party holding the commitment (a bare PoP binds a key to nothing in credkit's link-secret
  model). The PoP key stays **pairwise per issuer** (its `kid` is issuer-visible, so a reused key is
  a cross-issuer handle). Neither (a) nor (c) proves fresh *knowledge* of the link secret — the
  commitment is public and its PoK carries no nonce. (a) — token-only, no PoP — remains the fallback
  shape ((c) collapses to it with no rework). Implementation lands at N2.
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
keys from `@credkit/bbs`. Although Credkit types `documentLoader` as optional, VGW treats it as
required at every call boundary: Credkit's default knows only the VC v2 context, whereas VGW's loader
also vendors the vDL, AAMVA, VGW, security, and resident contexts.

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
- These are cryptographic primitives, not VGW acceptance policy. Call them only through vc-kit's
  wrapper, which derives ordered raw keys from configured issuer DIDs and, after crypto succeeds,
  enforces issuer equality, proof-verification-method control, and credential validity windows (§4).

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
- **Unlisted consumer (N0 survey):** `apps/dmv/worker/offers.ts:10,74` imports `daysSinceEpoch` to validate offered birth dates. When `commitment.ts` dies (N4), keep a local calendar-date validator (or credkit's `date1900` round-trip) — offer validation must not silently vanish. *Done at N4: local `birthDateToEpochDays`, same regex + UTC-round-trip idiom and the same 1970-epoch day arithmetic (not `date1900` — the existing `todayDays` comparison stays untouched); the malformed/impossible/future/over-120 API tests still pin the behavior.*
- **Second unlisted consumer (found at N4):** the wallet's `CredentialDetail.tsx` "Verify" action still ran the bbs-2023 derive/verify roundtrip (its `TODO(N3)` deferred the rewire). Rewired at N4 to the credkit holder receipt check — `verifyIssuedCredkitCredential` with the re-derived link secret + the envelope's decoded `secretProverBlind` — and its `birthDateCommitment` claim labels/pointers deleted.

**Timing shift, N3 vs N4 (recorded as executed).** The consumer rip-outs above landed at **N3**,
ahead of the package deletions: the wallet's `@vgw/zk/prove` call and `warmAgeProver` warm-up, the
client `verifyAgeProof` in `AgeGate.tsx`/`RentalGate.tsx` **and** the `@vgw/zk/verify` warm-ups in
both verifier `App.tsx`s, `assertAgeProofBundle`/`evaluateZkAgePolicy`/`evaluateZkRoute`, the
`zk_pending` verdict, and `ZkExhibit` are all gone — no live or test code imports `@vgw/zk`
anymore. What remains for **N4** is deletion of the now-orphaned artifacts: `packages/zk/**` itself
(its own suite still runs green), `commitment.ts` + the `@vgw/keys` Poseidon re-exports, the
bbs-2023/eddsa wrapper bodies and their vc-kit suites, the `vgw-v1.json`
`birthDateCommitment`/`zkAgeProof` terms, the deprecated `birthDateCommitment` builder input, and
the `"@vgw/zk"` entries in the three app manifests (kept at N3 so the lockfile only moves for the
`@credkit/range` addition). *All executed at N4 — plus the legacy-only `loader.ts`/`ed25519.ts`/
`jsigsErrors.ts`, the legacy types, the `@digitalbazaar/*`+`jsonld-signatures` dependency prune,
the vite `define` workaround removal (smoke-proven), and the bb.js-era `_headers` files; see the
§12 N4 row.* Wallet vault types: `LegacyCredentialPayload` and `CommitmentOpening`
were **deleted from `apps/wallet/src/services/db.ts` at N3** — their last consumers were the frozen
pre-N3 presentation/pipeline tests, both rewritten against credkit in the same pass (the pipeline
test now pins derive → blind-issue → encrypt → decrypt → present → verify on the live stack). The
presentation log keeps its `presenterDid` field for pre-N3 entries; N3 entries record `""` and the
exhibit renders that honestly as "no identifier" (full exhibit reframe stays N4, §10).

**Replace (crypto bodies → credkit)**

*As executed (N2/N3), the "replacement" is parallel-facade-plus-retirement, not an in-place body
swap:* `credkit.ts` (N2 issuance) and `credkitPresentation.ts`/`credkitParams.ts` (N3
presentation, verification, params — Appendix D.4) carry the credkit bodies with the policy
semantics below ported verbatim, while `bbs.ts`/`presentation.ts` survive untouched — zero live
callers since N3, suites still green — until their N4 deletion. Same end state, reviewable
diffs per milestone.

- `packages/vc-kit/src/bbs.ts` — delegate `signCredential`(~66)/`deriveCredential`(~102) to `issueCredential` / `deriveProof`+`presentGraph`; keep `DEFAULT_MANDATORY_POINTERS=['/issuer','/validFrom','/validUntil']`(~40). `verifyCredential`(~148) becomes a policy adapter over `verifyProof`/`verifyGraph`, retaining exact expected-issuer, verification-method-controller, and `checkValidityPeriod` behavior instead of returning Credkit's cryptographic boolean directly.
- `packages/vc-kit/src/presentation.ts` — remove the eddsa-rdfc-2022 presenter signature from `signPresentation`(~55; `properties` hook carries `zkAgeProof` ~83), but keep `verifyPresentation`(~117) as the verifier-facing facade: accept `expectedIssuerDids` in statement order, obtain raw keys only from those pins, call Credkit, then run the per-document vc-kit policy checks before producing one fail-closed result.
- `packages/vc-kit/src/keys.ts` — replace `generateBbsKeyPair` with `keyGen` and add `bbsDidKeyFromPublicKey` + `bbsPublicKeyFromDidKey`. Decode/encode the BLS12-381-G2 multicodec explicitly, require 96 key bytes, validate with Credkit's `g2FromBytes`, and pin round-trip/rejection vectors for wrong codec, length, and malformed points. The existing `did:key:zUC7…` identity remains the issuer metadata/config contract.
- `packages/vc-kit/src/credentials/utopia-dl.ts` — drop `birthDateCommitment`(~124); add a numeric declaration for `/credentialSubject/driversLicense/birth_date`; keep `AGE_OVER_FLAGS=[18,21,25]`(~58) as the tier-1 rung (§5). DL subject shape: `credentialSubject.driversLicense = { document_number, given_name, family_name, birth_date, age_over_{18,21,25}, issuing_authority, issuing_country, un_distinguishing_sign, issue_date, expiry_date }`.
- `packages/vc-kit/src/contexts/vdl-v1.json` — change only `birth_date.@type` from `xsd:dateTime` to `xsd:date`; keep the emitted `YYYY-MM-DD` lexical form and add a Credkit pipeline regression test.
- `packages/vc-kit/src/contexts/vgw-v1.json` — remove `birthDateCommitment` + `zkAgeProof` terms.
- `packages/vc-kit/src/loader.ts`, `contexts/index.ts` — keep the strict offline loader as the sole VGW loader passed to Credkit; bundle/export the Utopia Resident context URL and document in N5. Unknown contexts remain a hard failure; no runtime network fallback.
- `apps/{shop,rentals}/worker/env.ts` — retain `TRUSTED_ISSUER_DID` and `vgw_issuer_did` discovery. Resolve each policy-selected DID through `bbsPublicKeyFromDidKey`; for graphs build `expectedIssuerDids[]`/`publicKeys[]` in statement order, never from credential-supplied keys.

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
- `packages/keys/src/vault.ts` — the versioned per-credential envelope is `{ version: 3, vc, secretProverBlind: <base64url> }` (**not** `linkSecret` — it is re-derived from the PRF, §6). Watch the encoding: `secretProverBlind` is a **bigint scalar** (`Scalar = bigint`, `credkit/packages/bbs/src/core.ts:18`), and `encryptJson` calls `JSON.stringify`, which *throws* on a bigint. Encode it at the persistence boundary — `i2osp(secretProverBlind, 32)` → base64url, reusing `@credkit/bbs`'s `i2osp`/`os2ip` (`utils.ts:25,38`) rather than a hand-rolled encoder — and `os2ip` + range-check (`< r`) on read. `encryptJson`/`decryptJson` themselves stay JSON-only; scalars never reach them raw. Version-naming note (N0 survey): no versioned envelope exists today — the unversioned `CredentialPayload { vc, commitmentOpening? }` sits in `apps/wallet/src/services/db.ts:46-49`, and the only live version constant is IndexedDB `DB_VERSION = 2` (`db.ts:99`). The envelope's `version: 3` and any DB_VERSION bump are two distinct versions; name both explicitly at N2.
- `apps/wallet/src/services/db.ts` — the stored payload today is opaque AES-GCM ciphertext for `{ vc, commitmentOpening? }`; an IndexedDB `upgrade` callback has no vault key and therefore cannot transform that JSON, and legacy bbs-2023 credentials contain no Credkit blind to add. Treat them as incompatible at the N2 cutover and require reissuance (a v3 upgrade may retire/clear those credential records, but must not pretend to rewrite them). New writes use the versioned encoded-blind envelope above; decode and validate it only after wallet unlock.

**New (N5)**
- `packages/vc-kit/src/credentials/utopia-resident.ts` — Utopia Resident Registration, DMV-issued, numeric declarations `stateFips` (uint64, set-membership) + `postalCode` (uint64, range); use citizenship v3 only for its existing person/address terms.
- `packages/vc-kit/src/contexts/utopia-resident-v1.json` — define the resident credential/subject terms plus `stateFips` and `postalCode` as `xsd:unsignedInt`; register `https://verygoodwallet.com/contexts/utopia-resident/v1` in `BUNDLED_CONTEXTS`. Do not claim citizenship v1/v3 defines these predicate fields.
- `/.well-known/credkit-params` on shop + rentals serving `createRangeParams` (age) / `createSetParams` (residency); server-side `verifyProof`/`verifyGraph` in the Worker; delete client-side verify.

**Required regression tests for N2/N3**
- Full issue → derive/present → verify with VGW's offline loader; an unknown context and the old
  `birth_date` `xsd:dateTime` mapping must fail closed.
- Trusted `did:key:zUC7…` round-trip to the Credkit `G2Point`; wrong multicodec, malformed point, and a
  proof checked under a different configured issuer key must fail.
- Cryptographically valid proofs with the wrong `issuer`, a verification method outside the configured
  issuer DID, `validFrom` in the future, or expired `validUntil` must all return VGW `verified: false`.

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

### N0b addendum — Git-dependency consumption (validated 2026-07-16)

pnpm (≥10) installs a credkit package straight from the public repo:
`github:tmarkovski/credkit#<sha>&path:/packages/<name>`. Two facts the experiment nailed down:

1. **pnpm does NOT convert `workspace:*` at git-dep pack time** — the tarball manifest still says
   `workspace:*`. A `pnpm-workspace.yaml` `overrides` block mapping all four `@credkit/*` names to
   the git specs rewrites those (and any plain version specs) before resolution, so the whole
   dependency chain resolves from GitHub. `pnpm why @credkit/proofs` confirms
   `@credkit/cryptosuite 0.1.0 → @credkit/proofs 0.1.0`.
2. **`files: ["src"]` is honored** — tarballs carry only `src/` + manifest (+README), no test
   fixtures.

The Appendix C esbuild plugin bundled the git-dep source — including the cryptosuite's jsonld graph
and its `with { type: "json" }` import attribute — at **544 KiB**, and the bundle executed
`keyGen` (96-byte G2), `createHolderBinding` (144-byte commitment-with-proof), and
`encodePresentationHeader` under plain Node. In VGW the resolver lives at
`tooling/credkit-ts-resolver.ts` (registered in the four app vite configs and the five affected
vitest configs); vitest additionally needs `server.deps.inline: [/@credkit\//]` so the TS source
rides the vite pipeline instead of a raw Node import, and dev mode needs `optimizeDeps.exclude` for
all four packages (prebundling bypasses resolveId plugins). Harness: session scratchpad
(`gitdep-test/`), not committed.

---

# Appendix D — N3 design pass: predicate wire shapes + published params (settled 2026-07-16)

Resolves the first two §13 open points, written before the N3 code per the house convention.
Implemented at N3; N5 consumes the reserved membership/equality slots.

## D.1 DCQL predicate extension: `vgw_predicates`

`DcqlZkAgePredicate`/`vgw_zk` is deleted at N3 (its only consumers — the two verifier policies and
the wallet — rewrite in the same milestone). Each DCQL credential query may instead carry one
`vgw_predicates` object: claims proven about HIDDEN numeric twins, vendor-prefixed so OID4VP-
compliant consumers ignore it (standard DCQL `values` filters match only disclosed values, and
upstream predicate proposals remain unsettled — §13):

```jsonc
"vgw_predicates": {
  // Where THIS verifier publishes its proof alphabets (D.3). The wallet enforces
  // same-origin with response_uri and fetches the same public artifact every
  // other holder fetches (the §8 / FINDINGS §12 anti-tag discipline).
  "params_uri": "https://shop.example/.well-known/credkit-params",
  // Range claims over declared numeric twins, in presentation order.
  "range": [{
    "path": ["credentialSubject", "driversLicense", "birth_date"], // DCQL path → RFC-6901 via claimPathToPointer
    "kind": "lessOrEqual",                                         // or "greaterOrEqual"
    "bound": "46216",  // inclusive, decimal STRING (bigint-safe for uint64), in the twin's encoder units
    "digits": 4,       // base^digits must cover the honest range (age: base 16, digits 4 ⇒ dates into 2079)
    "params_hash": "<base64url sha256 of the published range-params octets>"
  }],
  // N5 — typed and validated now, rejected by the wallet until implemented:
  "membership": [{ "path": ["..."], "set_id": "coastal", "params_hash": "..." }],
  // Claim ids from `claims` that MUST be disclosed alongside the predicate route —
  // the old tier-2 claim_set made explicit (absent/empty = the predicate route
  // discloses nothing beyond the issuer's mandatory pointers).
  "claim_set": ["given_name", "family_name", "document_number"]
}
```

Cross-credential equalities (N5) ride at the `dcql_query` top level, referencing query ids —
reserved shape, validated now, rejected by the wallet until N5:

```jsonc
"vgw_equalities": [[ { "query": "dl", "link_secret": true }, { "query": "resident", "link_secret": true } ]]
```

Semantics: `bound` is in the target twin's declared encoder units (`date1900` days, `uint64`).
Verifiers compute date bounds with real calendar arithmetic and encode via credkit's own
`getEncoder("date1900")` — never day-count year approximations (Appendix A). The wallet checks each
`path` against the credential's OWN numeric declarations (parsed from the base proof via
`parseBaseProofValue`), renders the consent description from (encoder, kind, bound) — e.g. "born on
or before 2008-07-16 ⇒ at least 18" — and answers with `presentGraph` range claims in the SAME
order. An out-of-range value makes the prover THROW (the §9 fail-closed beat, surfaced in the
wallet UI); nothing is posted.

## D.2 Verifier restatement: the signed state token is the memory

`verifyGraph` demands the verifier restate claims + equalities exactly, from its own policy — never
the wire. The verifier Workers are stateless on the request side, so the concrete offered claims
(pointer, kind, bound, digits) travel INSIDE the HMAC-signed OID4VP `state` token, next to the
nonce; the response endpoint rebuilds `expectedRangeClaims` from that signed memory plus its own
in-memory params object. No re-derivation drift, no clock-skew window: the bound is pinned at
request time, and "18+ as of the request" is the intended semantic. (A seed rotation between
request and response makes the wire `paramsHash` mismatch the verifier's params — fails closed
inside credkit.)

Because the DCQL query offers ALTERNATIVES (flag / dob / predicate), the verifier picks which
expectation set to restate before calling `verifyGraph`: it peeks at the VP envelope's claim
COUNTS (`summarizeCredkitPresentation`, a thin wrapper over credkit's exported
`parsePresentationEnvelope` — counts only, no trust decisions) and selects the predicate-route
expectations (the token's claims) when the count matches the offer, the disclosure-route
expectations (`[]`) when zero, and fails anything else. The choice is always between
verifier-authored sets; the wire never supplies a bound, a param, or an equality.

## D.3 Published params: `/.well-known/credkit-params`

One JSON document per verifier (GET, CORS-open — the wallet fetches cross-origin from the browser;
`run_worker_first` gains the path in both verifier wranglers):

```jsonc
{
  "version": 1,
  "suite": "credkit-bbs-sha-2026",
  "range": { "base": 16, "params": "<base64url rangeParamsToOctets>", "hash": "<base64url sha256(octets)>" }
  // N5: "sets": { "<set_id>": { "params": "…", "hash": "…" } }
}
```

**Deterministic mint, zero storage** (settles §13 static-vs-minted): `createRangeParams` is
randomized, but its `randomScalars` hook accepts the IETF `seeded_random_scalars` generator credkit
exports as `mockRandomScalars` — off-label naming, exactly the right KDF (expand a seed under a
DST, reduce mod r). Each verifier derives its alphabet from a SECRET seed — `CREDKIT_PARAMS_SEED`,
falling back to the resolved token secret — under an app-specific DST, so every isolate and cold
start serves byte-identical params with no KV/DO. The seed must stay secret: the alphabet's signing
scalar x is derivable from it, and x lets anyone BB-sign out-of-alphabet digits (i.e. forge range
proofs against that verifier alone — it only fools itself, but still). Rotating the seed rotates
the alphabet and fails in-flight sessions closed.

**Holder pinning against the per-prover-alphabet tag (FINDINGS §12):** the wallet (a) enforces
`params_uri` same-origin with `response_uri`, (b) fetches the same public artifact every holder
fetches, (c) checks `sha256(octets)` equals BOTH the document's `hash` and the DCQL claim's
`params_hash`, (d) validates the alphabet once via `verifyRangeParams` and caches by hash. An
honest-but-curious verifier could still mint per-session alphabets consistent across (a)–(d) —
the residual risk stays documented rather than solved; in practice the params are cache-stable
public artifacts anyone can compare out of band.

## D.4 New facade surface (N3)

- `packages/vc-kit/src/credkitPresentation.ts` — `createCredkitPresentation` (wraps
  `presentGraph`, loader pinned), `verifyCredkitPresentation` (the §4 policy facade: configured
  DIDs → `bbsPublicKeyFromDidKey` → `g2FromBytes`, `verifyGraph`, then per-statement issuer
  equality, proof-verification-method control, and validity windows, porting `bbs.ts`'s exact
  check semantics; one fail-closed result), `summarizeCredkitPresentation` (envelope claim
  counts), `credkitNumericDeclarations` (a credential's declared twins, from its base proof),
  and — added in the implementation pass — `credkitProofMode` (holder-bound vs baseline, so the
  wallet refuses to present an unbound credential) plus a re-exported `getEncoder` and the
  expectation/claim types, so verifiers and wallet never import `@credkit/*` directly.
- `packages/vc-kit/src/credkitParams.ts` — `mintSeededRangeParams` (suite-pinned
  `createRangeParams` over `mockRandomScalars(seed, dst)`), `rangeParamsToBase64Url` /
  `rangeParamsFromBase64Url` (validated decode), `rangeParamsHashBase64Url`.
- `packages/protocols/src/credkitParams.ts` — the D.3 document type,
  `assertCredkitParamsDocument`, and `CREDKIT_PARAMS_PATH` (crypto-free wire contract, per the §7
  protocols charter).

## D.5 N5 design pass: the resident credential and the composite flow (settled 2026-07-16)

Written before the N5 code. N5 lands as two green commits — **N5a** (foundation + issuance,
additive: the resident credential exists but nothing presents it yet, the same staging shape
N2→N3 used) and **N5b** (showcases live).

1. **Composite `vp_token` convention.** OID4VP's DCQL model is one enveloped presentation per
   credential query; a credkit graph VP deliberately spans queries. VGW extension semantics: when
   `vgw_equalities` is present, the wallet answers ALL linked queries with ONE graph VP, posted
   under the FIRST credential query's id (`vp_token: { [credentials[0].id]: [vp] }`). Statement
   order = the `dcql_query.credentials` order, on both sides — the verifier restates
   per-statement expectations in that order and treats the single VP as answering the whole set.
2. **Showcase B's live mechanism is set membership over `stateFips`** (the coastal-district
   set). Range is already showcased by the age predicate; membership is the new capability. The
   two-sided `postalCode` range (ZIP-in-block) is covered by tests (two range claims over one
   pointer), not by a live UI flow.
3. **Showcase C's live flow is ONE new rentals flow — the "coastal resident rate" eligibility
   check** — and it discloses NOTHING personal: DL statement (over-25 range claim, empty
   claim_set) + Resident statement (coastal `stateFips` membership, empty claim_set) +
   `vgw_equalities` [[dl.link_secret, resident.link_secret]]. "Same person, no name" is the
   exhibit: an `allowed` verdict whose disclosed set is empty beyond the mandatory pointers. The
   existing standard rental flow (identity + age) is untouched; a discounted BOOKING would run
   that flow — eligibility is the anonymous part.
4. **Resident Registration issuance**: a second, separate OID4VCI offer at the same DMV
   (`credential_configuration_id` `utopia_resident_registration`), flowing through the wallet's
   existing single-config offer path. Subject: given/family name via the bundled citizenship v3
   vocabulary, plus district name and the two numeric-declared predicate fields (`stateFips`,
   `postalCode`, both `uint64` over `xsd:unsignedInt` — defined by the new bundled
   `https://verygoodwallet.com/contexts/utopia-resident/v1` context, per §5). The Utopia
   geography fiction (district names → FIPS-like codes, coastal vs inland) lives ONCE in vc-kit
   so the DMV's offer form and the rentals policy share it; the COASTAL SET itself is rentals
   VERIFIER POLICY (a subset of the codes), not credential data.
5. **Params document gains `sets`** (the D.3 reservation): `"sets": { "<set_id>": { "params":
   "<base64url setParamsToOctets>", "hash": "<base64url sha256(octets)>" } }`, minted seeded like
   the range alphabet (distinct DST per set id). The DCQL membership claim pins `set_id` +
   `params_hash`; the wallet's pinning ritual extends verbatim (same-origin, double hash,
   `verifySetParams` once, cache by hash). The hash matches credkit's wire `membershipParamsHash`
   (sha256 of the same octets).
6. **Verifier memory generalizes**: the rentals state token's `predicates` field becomes the full
   offer memory — statement-indexed range claims, membership claims (`{statement, pointer,
   set_id}`), and the offered equalities. The D.2 route peek compares all three envelope counts;
   restatement rebuilds `expectedRangeClaims` + `expectedMembershipClaims` (statement-major) +
   `expectedEqualities` (query refs mapped to statement indices by query order) from the token
   plus the isolate's own params objects.
7. **Wallet scope**: multi-query matching (one candidate per query, every query satisfiable or
   the request fails loudly), membership satisfiability against the credential's declared twins,
   the composite consent screen (per-statement sections + a linkage line), and equality support
   for `link_secret` refs ONLY — pointer-twin equality refs remain typed-but-rejected (a later
   milestone's mechanism; recorded here so the rejection is deliberate). The N3 rejections
   (`membership`, `vgw_equalities`, multi-query) come out.

**As executed at N5a** (no design deviations; three details the code pass nailed down):

- **Citizenship v3's terms are TYPE-SCOPED, not top-level.** The bundled context defines no
  property terms at its top level at all — `givenName`/`familyName`/`birthDate`/… live inside
  scoped contexts on the subject types (`Person`, `PermanentResident`, …), so they only resolve
  on a node carrying such a type. The resident subject is therefore typed
  `['Person', 'UtopiaResident']`: `Person` activates the citizenship person vocabulary,
  `UtopiaResident` activates the resident context's scope (`districtName`, `stateFips`,
  `postalCode`; vocabulary IRIs under `https://verygoodwallet.com/vocab/utopia-resident#`).
  This also confirms §5's "cannot reuse citizenship v3 alone" the hard way: its only
  `postalCode` term sits untyped inside the `PostalAddress` scope — a type this subject does
  not carry — and nothing named `stateFips` exists anywhere in it.
- **The uint64 lexical-form decision: context-typed canonical decimal STRINGS.** The builder
  serializes `stateFips`/`postalCode` as JSON strings in canonical unsigned-decimal form
  (validated integers in `[0, 2³²−1]`, the `xsd:unsignedInt` value space) and the resident
  context's `@type` coercion stamps the datatype — exactly the DL `birth_date` mechanism. A
  JSON string's RDF lexical form is byte-identical to the JSON value; a JSON number would ride
  the serializer's number formatting instead (scientific notation, precision), a second
  spelling credkit's encoder rejects rather than repairs. Pinned through the REAL pipeline:
  issuance fails closed when the coercion is stripped (`does not accept`) and on a
  non-canonical form (`not a canonical unsigned integer`).
- **The offer↔token configuration binding (D.5.4's "single-config offer path", hardened).**
  Pre-N5 the signed code/token carried no configuration id — with one configuration the
  constant check was sufficient. Two configurations make the binding load-bearing: the offer
  body's `credential_configuration_id` discriminator (absent = DL) is validated once, rides
  the signed code into the access token, and the credential endpoint issues ONLY that id —
  mismatches and pre-N5 unbound tokens are rejected (vectored). Set-alphabet DST convention
  established for N5b: one DST per set id, `VGW-<APP>-CREDKIT-SET-PARAMS-<set_id>-V1` shaped
  (e.g. rentals' coastal set → `VGW-RENTALS-CREDKIT-SET-PARAMS-coastal-V1`).
