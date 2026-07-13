# @vgw/vc-kit

W3C Verifiable Credentials 2.0 with Data Integrity `bbs-2023` proofs
(BLS12-381 BBS selective disclosure), wrapping the `@digitalbazaar` stack.
Consumed as TypeScript source (no build step).

## Proof lifecycle

| Step | Actor | API | Output |
|------|-------|-----|--------|
| 1. Sign | Issuer | `signCredential` | **Base proof** — holder-only material (embeds the HMAC key and mandatory-pointer metadata needed to derive disclosures). Never present it to a relying party. |
| 2. Derive | Holder | `deriveCredential` | **Derived proof** — reveals only the selected + mandatory claims; unlinkable across derivations. |
| 3. Verify | Relying party | `verifyCredential` | Verifies *derived* proofs only; a base-proof credential yields `verified: false` by design. |

## API

```ts
import {
  generateBbsKeyPair,   // (seed: Uint8Array) => Promise<BbsKeyPair>, deterministic, did:key ids
  signCredential,       // ({ credential, keyPair, mandatoryPointers? }) => Promise<VerifiableCredential>
  deriveCredential,     // ({ verifiableCredential, selectivePointers }) => Promise<VerifiableCredential>
  verifyCredential,     // ({ credential, expectedIssuer?, now? }) => Promise<{ verified, error? }>
  documentLoader,       // shared JSON-LD document loader (offline: static contexts + did:key)
  registerContext,      // (url, doc) => void — add your own static context
  resolveDid,           // (did) => Promise<object> — did:key resolution (zUC7 BBS + z6Mk Ed25519)
  buildUtopiaDriversLicense, // demo VC 2.0 credential template (ISO 18013 vDL + AAMVA + VGW)
} from '@vgw/vc-kit';
```

`mandatoryPointers` defaults to `['/issuer', '/validFrom', '/validUntil']`
(filtered to fields present on the credential). Mandatory values are disclosed
byte-identically in every derived proof, so keep them coarse — a
millisecond-precision timestamp would fingerprint the credential across
verifiers (the Utopia DL template defaults its validity to midnight UTC for
this reason). Selective pointers are JSON pointers, e.g.
`'/credentialSubject/driversLicense/birth_date'`.

`verifyCredential` always binds the proof's verification method to an issuer:
`expectedIssuer` when given, otherwise the credential's own `issuer` (failing
closed if none is disclosed) — a credential cannot name one issuer while
carrying a proof from another's key. It also checks the disclosed validity
period (`validFrom <= now <= validUntil`), reporting expired / not-yet-valid
credentials distinctly from cryptographic failure. Relying parties should
still pass `expectedIssuer`: without it, verification proves the credential
was signed by the issuer it *claims*, not by an issuer you *trust*.

## Contexts

All JSON-LD contexts are bundled and served statically — sign/derive/verify
never touch the network. Bundled: VC 2.0 (via `securityLoader`), vDL v1,
vDL/AAMVA v1, citizenship v1/v3, data-integrity v2, multikey v1, open badges
v3, retail coupon v1, and the custom VGW context
(`https://verygoodwallet.com/contexts/vgw/v1`) which defines
`birthDateCommitment` — the Poseidon birth-date commitment claim used by the
ZK age-predicate tier. Extend with `registerContext(url, doc)`.

## Example

```ts
const keyPair = await generateBbsKeyPair(seed); // e.g. HKDF output from passkey PRF
const credential = buildUtopiaDriversLicense({
  givenName: 'JOHN', familyName: 'SMITH',
  birthDate: '1988-04-19', documentNumber: 'F987654321',
  birthDateCommitment: 'z…',
  issuer: { id: keyPair.controller, name: 'Utopia DMV' },
});
const signed = await signCredential({ credential, keyPair });        // wallet-side storage
const presentation = await deriveCredential({                        // per-verifier
  verifiableCredential: signed,
  selectivePointers: ['/credentialSubject/driversLicense/birth_date'],
});
const { verified } = await verifyCredential({
  credential: presentation,
  expectedIssuer: keyPair.controller,
});
```

## Development

```sh
pnpm exec tsc --noEmit   # typecheck
pnpm exec vitest run     # tests
```

The `@digitalbazaar` packages ship no types; `src/shims.d.ts` declares loose
ambient modules for them while the kit's own exports stay strictly typed.
