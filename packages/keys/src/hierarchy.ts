/**
 * The wallet key hierarchy.
 *
 * ```
 * passkey PRF output ("master", never stored — re-derived per session)
 * └── HKDF-SHA-256 branches (domain-separated by `info`)
 *     ├── "vgw/v1/vault"                        → AES-GCM-256 vault key
 *     ├── "vgw/v1/holder:<issuer-origin>"       → 32-byte holder seed (per-issuer BBS keypair)
 *     └── "vgw/v1/presenter:<verifier-origin>"  → 32-byte presenter seed (per-verifier keypair)
 * ```
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

/** HKDF `info` prefix for holder (per-issuer) branches. */
export const HOLDER_INFO_PREFIX = "vgw/v1/holder:";

/** HKDF `info` prefix for presenter (per-verifier) branches. */
export const PRESENTER_INFO_PREFIX = "vgw/v1/presenter:";

/** Full HKDF `info` string for the holder branch bound to an issuer origin. */
export function holderInfo(issuerOrigin: string): string {
  return HOLDER_INFO_PREFIX + issuerOrigin;
}

/** Full HKDF `info` string for the presenter branch bound to a verifier origin. */
export function presenterInfo(verifierOrigin: string): string {
  return PRESENTER_INFO_PREFIX + verifierOrigin;
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
 * Derive the 32-byte holder seed for an issuer origin. Feeds BBS BLS12-381
 * keypair generation, producing a pairwise `did:key` per issuer.
 */
export async function deriveHolderSeed(
  master: Uint8Array,
  issuerOrigin: string,
): Promise<Uint8Array> {
  return hkdfDerive(master, holderInfo(issuerOrigin), 32);
}

/**
 * Derive the 32-byte presenter seed for a verifier origin. Feeds the
 * per-verifier presentation keypair, so no two verifiers see the same DID.
 */
export async function derivePresenterSeed(
  master: Uint8Array,
  verifierOrigin: string,
): Promise<Uint8Array> {
  return hkdfDerive(master, presenterInfo(verifierOrigin), 32);
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
  verifierOrigins?: string[];
}

/**
 * Build the derivation tree for the wallet inspector. Structure is always
 * returned; secret previews (hashed, never raw) are included only when
 * `master` is provided.
 */
export async function describeHierarchy(
  opts: DescribeHierarchyOptions,
): Promise<DerivationNode> {
  const { master, issuerOrigins = [], verifierOrigins = [] } = opts;

  const vaultNode: DerivationNode = {
    label: "vault key (AES-GCM-256)",
    info: VAULT_INFO,
    children: [],
  };
  const holderNodes: DerivationNode[] = issuerOrigins.map((origin) => ({
    label: `holder seed (${origin})`,
    info: holderInfo(origin),
    children: [],
  }));
  const presenterNodes: DerivationNode[] = verifierOrigins.map((origin) => ({
    label: `presenter seed (${origin})`,
    info: presenterInfo(origin),
    children: [],
  }));

  const root: DerivationNode = {
    label: "master secret (passkey PRF)",
    info: PRF_EVAL_INPUT,
    children: [vaultNode, ...holderNodes, ...presenterNodes],
  };

  if (master !== undefined) {
    root.preview = await previewSecret(master);
    for (const node of root.children) {
      node.preview = await previewSecret(await hkdfDerive(master, node.info, 32));
    }
  }

  return root;
}
