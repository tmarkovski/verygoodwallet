/**
 * Strictly-typed public types for @vgw/vc-kit.
 */

/** A JSON-LD context entry: either a URL or an inline context object. */
export type JsonLdContextEntry = string | Record<string, unknown>;

/**
 * A W3C VC Data Model 2.0 credential (unsigned or signed).
 *
 * Deliberately loose beyond the well-known fields — credentials are open-world
 * JSON-LD documents and the underlying libraries operate on plain objects.
 */
export interface VerifiableCredential {
  '@context': JsonLdContextEntry | JsonLdContextEntry[];
  id?: string;
  type: string | string[];
  issuer?: string | { id: string; [key: string]: unknown };
  validFrom?: string;
  validUntil?: string;
  credentialSubject?: Record<string, unknown> | Record<string, unknown>[];
  proof?: Record<string, unknown> | Record<string, unknown>[];
  [key: string]: unknown;
}

/** Signer interface exposed by a BBS key pair (consumed by DataIntegrityProof). */
export interface BbsSigner {
  algorithm: string;
  id?: string;
  sign(options: { data: Uint8Array }): Promise<Uint8Array>;
  multisign?(options: {
    header: Uint8Array;
    messages: Uint8Array[];
  }): Promise<Uint8Array>;
}

/**
 * A BLS12-381 BBS key pair with `did:key` identifiers, as produced by
 * {@link generateBbsKeyPair}. Wraps a `@digitalbazaar/bls12-381-multikey`
 * key pair interface.
 */
export interface BbsKeyPair {
  /** Multikey context URL. */
  '@context': string;
  /** Verification method id: `did:key:<mb>#<mb>`. */
  id: string;
  /** Controller DID: `did:key:<mb>`. */
  controller: string;
  /** Multibase-encoded (zUC7…) BLS12-381 G2 public key. */
  publicKeyMultibase: string;
  /** Multibase-encoded secret key (present for locally generated keys). */
  secretKeyMultibase?: string;
  /** Returns a signer usable with DataIntegrityProof (bbs-2023). */
  signer(): BbsSigner;
  /** Exports the key pair as a Multikey document. */
  export(options?: {
    publicKey?: boolean;
    secretKey?: boolean;
    includeContext?: boolean;
  }): Promise<Record<string, unknown>>;
  [key: string]: unknown;
}

/** Result of {@link verifyCredential}. */
export interface VerifyCredentialResult {
  verified: boolean;
  error?: string;
}
