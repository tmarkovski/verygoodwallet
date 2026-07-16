/**
 * The wallet key hierarchy.
 *
 * ```
 * passkey PRF output ("master", never stored — re-derived per session)
 * └── HKDF-SHA-256 branches (domain-separated by `info`)
 *     ├── "vgw/v1/vault"                            → AES-GCM-256 vault key
 *     ├── "vgw/v1/link-secret"                      → 32-byte credkit link secret (ONE for all issuers)
 *     └── "vgw/v1/issuance-pop:<issuer-origin>"     → 32-byte issuance-PoP seed (per-issuer Ed25519 key)
 * ```
 *
 * There is deliberately NO per-verifier branch: the credkit presentation
 * carries no holder key or DID of any kind, so no presentation-side key
 * exists to derive. The pre-credkit `vgw/v1/presenter:<verifier-origin>`
 * branch was retired at N4 — not rotated, removed (MIGRATION §6).
 */

import { toHex, utf8 } from "./encoding.js";
import { hkdfDerive } from "./hkdf.js";

/**
 * The string the wallet feeds to the WebAuthn PRF extension (`prf.eval.first`).
 * Every app must use this exact value so the same passkey always yields the
 * same master secret.
 */
export const PRF_EVAL_INPUT = "vgw/v1/master-secret";

/** HKDF `info` for the vault (at-rest encryption) branch. */
export const VAULT_INFO = "vgw/v1/vault";

/**
 * HKDF `info` for the credkit link-secret branch. Deliberately NOT
 * origin-scoped: one secret across all issuers, for life (MIGRATION §6,
 * credkit FINDINGS §8).
 */
export const LINK_SECRET_INFO = "vgw/v1/link-secret";

/**
 * HKDF `info` prefix for issuance-PoP (per-issuer) branches. Replaced the
 * pre-credkit `vgw/v1/holder:` branch at N2 (MIGRATION §6): holder BINDING is
 * now the blind-committed link secret; this branch keeps only the Ed25519 key
 * that signs the OID4VCI request PoP JWT. It stays deliberately
 * origin-scoped — the PoP `kid` is issuer-visible, so one reused key would be
 * a cross-issuer correlation handle.
 */
export const ISSUANCE_POP_INFO_PREFIX = "vgw/v1/issuance-pop:";

/** Full HKDF `info` string for the issuance-PoP branch bound to an issuer origin. */
export function issuancePopInfo(issuerOrigin: string): string {
  return ISSUANCE_POP_INFO_PREFIX + issuerOrigin;
}

/**
 * Derive the vault key: a non-extractable AES-GCM-256 `CryptoKey` for
 * encrypting wallet state at rest (IndexedDB).
 *
 * Uses `deriveKey` so the raw key bytes never surface to JavaScript. The key
 * material is identical to `hkdfDerive(master, VAULT_INFO, 32)` (same HKDF
 * parameters), which is what the inspector previews.
 */
export async function deriveVaultKey(master: Uint8Array): Promise<CryptoKey> {
  const ikm = await globalThis.crypto.subtle.importKey(
    "raw",
    master as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: utf8(VAULT_INFO) as BufferSource,
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Derive the 32-byte issuance-PoP seed for an issuer origin. Feeds the
 * Ed25519 key that signs the OID4VCI request proof-of-possession JWT
 * (freshness option (c), MIGRATION §3.3): the PoP proves request liveness of
 * a party holding the commitment; holder BINDING is the separately-committed
 * link secret ({@link deriveLinkSecret}). Pairwise per issuer so the
 * issuer-visible `kid` never correlates two issuers.
 */
export async function deriveIssuancePopSeed(
  master: Uint8Array,
  issuerOrigin: string,
): Promise<Uint8Array> {
  return hkdfDerive(master, issuancePopInfo(issuerOrigin), 32);
}

/**
 * Derive the credkit link secret: 32 bytes, the SAME value at every call for
 * a given master — deliberately not scoped to any issuer or verifier origin.
 * One secret is blind-committed into every credential (the issuer never sees
 * it), which is what makes cross-credential "same holder" equality provable.
 * Verifier-unlinkability survives regardless: the secret itself is never
 * disclosed and proofs are re-randomized per presentation; only
 * holder-elected linking ever reveals "same holder".
 *
 * Feed the returned bytes to credkit as
 * `createHolderBinding({ linkSecret: deriveLinkSecret(master) })` — a bare
 * `createHolderBinding()` mints a fresh random secret per call, which passes
 * single-credential demos but silently breaks cross-credential equality and
 * the one-secret-for-life property. The secret is re-derived from the PRF
 * whenever needed, never stored.
 */
export async function deriveLinkSecret(master: Uint8Array): Promise<Uint8Array> {
  return hkdfDerive(master, LINK_SECRET_INFO, 32);
}

/**
 * Safe display form of a secret for the inspector: the first 8 hex characters
 * of its SHA-256 digest. Never show raw secret bytes in any UI.
 */
export async function previewSecret(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as BufferSource,
  );
  return toHex(new Uint8Array(digest)).slice(0, 8);
}

/** A node in the derivation tree rendered by the wallet inspector. */
export interface DerivationNode {
  /** Human-readable name, e.g. `"vault key (AES-GCM-256)"`. */
  label: string;
  /** The HKDF `info` string (or `PRF_EVAL_INPUT` for the root). */
  info: string;
  /** Hashed preview of the secret at this node; present only when a master secret was provided. */
  preview?: string;
  children: DerivationNode[];
}

export interface DescribeHierarchyOptions {
  /** When provided, each node gets a hashed `preview` of its derived secret. */
  master?: Uint8Array;
  issuerOrigins?: string[];
}

/**
 * Build the derivation tree for the wallet inspector. Structure is always
 * returned; secret previews (hashed, never raw) are included only when
 * `master` is provided.
 *
 * Note what the tree does NOT contain: any per-verifier branch. Since the
 * credkit migration a presentation carries no holder key or identifier, so
 * there is no per-verifier key to derive — the absence is the exhibit.
 */
export async function describeHierarchy(
  opts: DescribeHierarchyOptions,
): Promise<DerivationNode> {
  const { master, issuerOrigins = [] } = opts;

  const vaultNode: DerivationNode = {
    label: "vault key (AES-GCM-256)",
    info: VAULT_INFO,
    children: [],
  };
  const linkSecretNode: DerivationNode = {
    label: "link secret (credkit holder binding, all issuers)",
    info: LINK_SECRET_INFO,
    children: [],
  };
  const issuancePopNodes: DerivationNode[] = issuerOrigins.map((origin) => ({
    label: `issuance PoP seed (${origin})`,
    info: issuancePopInfo(origin),
    children: [],
  }));

  const root: DerivationNode = {
    label: "master secret (passkey PRF)",
    info: PRF_EVAL_INPUT,
    children: [vaultNode, linkSecretNode, ...issuancePopNodes],
  };

  if (master !== undefined) {
    root.preview = await previewSecret(master);
    for (const node of root.children) {
      node.preview = await previewSecret(await hkdfDerive(master, node.info, 32));
    }
  }

  return root;
}
