# @vgw/keys

Key derivation and vault crypto for VeryGoodWallet: the passkey PRF output
becomes the wallet's entire key hierarchy via HKDF, plus authenticated JSON
encryption for at-rest storage and Poseidon commitments for the ZK tier.

**Runtime-agnostic.** Uses `globalThis.crypto` (WebCrypto) exclusively — no
Node built-ins — so it runs identically in browsers and Node 22+.

## Key hierarchy

```
passkey PRF output ("master", never stored — re-derived per session)
└── HKDF-SHA-256 (32-byte zero salt; domain separation via `info`)
    ├── "vgw/v1/vault"                        → AES-GCM-256 vault key (non-extractable)
    ├── "vgw/v1/holder:<issuer-origin>"       → 32-byte seed → per-issuer BBS keypair / pairwise did:key
    └── "vgw/v1/presenter:<verifier-origin>"  → 32-byte seed → per-verifier presentation keypair
```

The wallet feeds `PRF_EVAL_INPUT` (`"vgw/v1/master-secret"`) to the WebAuthn
PRF extension (`prf.eval.first`); every app must use this exported constant so
the same passkey always yields the same master secret.

## Modules

| Module | Exports |
|--------|---------|
| `encoding` | `toBase64Url`, `fromBase64Url`, `toHex`, `fromHex`, `utf8` |
| `hkdf` | `hkdfDerive(ikm, info, length = 32)` — native SubtleCrypto HKDF-SHA-256, 32-byte zero salt |
| `hierarchy` | `PRF_EVAL_INPUT`, `VAULT_INFO`, `HOLDER_INFO_PREFIX`, `PRESENTER_INFO_PREFIX`, `holderInfo`, `presenterInfo`, `deriveVaultKey`, `deriveHolderSeed`, `derivePresenterSeed`, `previewSecret`, `describeHierarchy` |
| `vault` | `encryptJson`, `decryptJson` — AES-GCM, payload = `base64url(iv ‖ ciphertext)`, throws on tamper |
| `commitment` | `daysSinceEpoch`, `createCommitment`, `verifyCommitment`, `BN254_SCALAR_FIELD` |

### Vault format

`encryptJson` serializes the value as JSON, encrypts under AES-GCM with a
fresh random 12-byte IV, and returns `base64url(iv || ciphertext)` (the GCM
tag rides inside the ciphertext). `decryptJson` throws on any tampering.

### Inspector support

`describeHierarchy({ master?, issuerOrigins?, verifierOrigins? })` returns a
`DerivationNode` tree (`{ label, info, preview?, children }`) for the wallet
inspector. Secret previews — `previewSecret`: the first 8 hex chars of the
SHA-256 digest — appear only when a master secret is supplied; raw secret
bytes are never exposed.

### Birthdate commitment (ZK tier, M4)

`createCommitment(value, blinding?)` computes
`poseidon2([value, blinding])` over the **BN254 scalar field** using
[`poseidon-lite`](https://github.com/vimwitch/poseidon-lite), whose constants
are **circomlib-compatible**. The blinding is 31 random bytes when omitted
(2^248 − 1 < p, so it can never exceed the field modulus).

> **M4 requirement:** the Noir circuit must use a circomlib-compatible
> Poseidon implementation (e.g. Noir's `poseidon::bn254` from the
> `poseidon` crate, which matches circomlib's constants) — otherwise circuit
> hashes will not match commitments produced here. The canonical
> cross-check: `poseidon2([1, 2])` must equal
> `0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a`.

`daysSinceEpoch('YYYY-MM-DD')` converts a birthdate to whole days since the
Unix epoch (UTC). Dates before 1970 yield negative values, which
`createCommitment` canonicalizes into the field (`value mod p`); the Noir
circuit must apply identical semantics, and the demo's range checks assume
non-negative day counts.

## Development

```sh
pnpm exec tsc --noEmit   # typecheck
pnpm exec vitest run     # tests
```
