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

/**
 * A W3C VC Data Model 2.0 presentation (unsigned or signed). Open-world like
 * {@link VerifiableCredential}.
 */
export interface VerifiablePresentation {
  '@context': JsonLdContextEntry | JsonLdContextEntry[];
  type: string | string[];
  /** The presenter's DID — the VP proof's verification method must belong to it. */
  holder?: string;
  verifiableCredential?: VerifiableCredential | VerifiableCredential[];
  proof?: Record<string, unknown> | Record<string, unknown>[];
  [key: string]: unknown;
}

/** Signer interface exposed by an Ed25519 key pair (consumed by DataIntegrityProof). */
export interface Ed25519Signer {
  algorithm: string;
  id?: string;
  sign(options: { data: Uint8Array }): Promise<Uint8Array>;
}

/**
 * An Ed25519 Multikey pair with `did:key` identifiers, as produced by
 * {@link generateEd25519KeyPair}. Wraps a `@digitalbazaar/ed25519-multikey`
 * key pair interface.
 */
export interface Ed25519KeyPair {
  /** Multikey context URL. */
  '@context': string;
  /** Verification method id: `did:key:<mb>#<mb>`. */
  id: string;
  /** Controller DID: `did:key:<mb>`. */
  controller: string;
  /** Multibase-encoded (z6Mk…) Ed25519 public key. */
  publicKeyMultibase: string;
  /** Multibase-encoded secret key (present for locally generated keys). */
  secretKeyMultibase?: string;
  /** Returns a signer usable with DataIntegrityProof (eddsa-rdfc-2022). */
  signer(): Ed25519Signer;
  [key: string]: unknown;
}

/** Per-credential outcome inside {@link VerifyPresentationResult}. */
export interface PresentedCredentialResult {
  credential: VerifiableCredential;
  verified: boolean;
  error?: string;
}

/** Result of {@link verifyPresentation}. */
export interface VerifyPresentationResult {
  /** True only when the VP proof AND every embedded credential verified. */
  verified: boolean;
  /** The presenter DID the VP proof is bound to (present when the VP proof verified). */
  holder?: string;
  /** One entry per embedded credential, in presentation order. */
  credentials: PresentedCredentialResult[];
  error?: string;
}
