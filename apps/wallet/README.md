# @vgw/wallet

VeryGoodWallet — **your passkey is your wallet.** A passkey-native identity
wallet: the passkey's PRF output derives the entire key hierarchy
(`@vgw/keys`), credentials are W3C VC 2.0 with `bbs-2023` selective
disclosure (`@vgw/vc-kit`), and everything is encrypted at rest.

React 19 + react-router 7 (declarative) + Tailwind 4 (CSS-first) + idb.
Fully static and client-side; nothing leaves the device.

## Layout

| Path | What |
|------|------|
| `src/services/webauthn.ts` | Passkey register/login, **PRF-only** (largeBlob dropped). Falls back to a clearly-labeled simulated master secret when the authenticator lacks PRF. |
| `src/services/db.ts` | `idb` database `vgw` v1: `accounts` + `credentials` stores. Full VC always encrypted (`encryptJson` under the vault key); only small `meta` is plaintext for list rendering. |
| `src/services/issuance.ts` | OID4VCI credential-offer client: fetches the issuer metadata, redeems the one-time code, creates the holder-binding proof, verifies the issued credential, and stores it encrypted. |
| `src/session.tsx` | Session context. Master secret + vault key are memory-only — refresh locks the wallet. localStorage holds only the last-used account id. |
| `src/inspector/` | Inspector drawer: live key-derivation tree (`describeHierarchy`, hashed previews), session event log (tiny pub/sub in `events.ts`), dependency-free collapsible JSON viewers. |
| `src/pages/` | `/welcome` (onboarding), `/` (lock screen / card stack), `/credentials/:id` (detail + Verify/Raw JSON/Delete), `/settings` (PRF badge, danger zone). |

## Commands

```sh
pnpm dev        # vite dev server (localhost is a secure context — PRF works)
pnpm build      # vite build
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run (pure-logic unit tests, Node env)
```

## Notes

- **PRF decision is made at login time** from actual assertion results, not
  the provisional `prf.enabled` flag at registration. Once an account is
  simulated it stays simulated, and a PRF-backed account (or one that already
  owns credentials) refuses to unlock when an assertion returns no PRF output
  — switching sources in either direction would orphan the vault. The
  simulated fallback only engages on genuine first use.
- Secrets are never logged or rendered raw; the inspector shows
  `previewSecret()` hashes only.
- Verify on the detail page derives a minimal disclosure (only
  `birthDateCommitment`) and verifies it against the issuer DID, with timing.
- `vitest.config.ts` intentionally shadows `vite.config.ts` for tests so the
  React/Tailwind plugins are not loaded in Node.
- The single JS bundle is ~1.3 MB minified (the jsonld/BBS stack); fine for
  the demo, code-splitting is a later polish item.
