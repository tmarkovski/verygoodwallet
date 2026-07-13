/**
 * Ambient module shims for the untyped @digitalbazaar JavaScript packages.
 *
 * These are intentionally loose (the upstream packages ship no types); the
 * strictly-typed surface of @vgw/vc-kit lives in src/types.ts and src/index.ts.
 */

declare module '@digitalbazaar/bbs-2023-cryptosuite' {
  /** Opaque cryptosuite object consumed by DataIntegrityProof. */
  export interface Bbs2023Cryptosuite {
    name: string;
    requiredAlgorithm: string | string[];
    [key: string]: unknown;
  }

  export function createSignCryptosuite(options?: {
    mandatoryPointers?: string[];
  }): Bbs2023Cryptosuite;

  export function createDiscloseCryptosuite(options?: {
    proofId?: string;
    selectivePointers?: string[];
    presentationHeader?: Uint8Array;
  }): Bbs2023Cryptosuite;

  export function createVerifyCryptosuite(options?: {
    expectedPresentationHeader?: Uint8Array;
  }): Bbs2023Cryptosuite;

  export const requiredAlgorithm: string[];
}

declare module '@digitalbazaar/bls12-381-multikey' {
  export const ALGORITHMS: {
    BBS_BLS12381_SHA256: string;
    BBS_BLS12381_SHAKE256: string;
    [key: string]: string;
  };

  /**
   * Raw key pair interface returned by this package. Fields are mutable;
   * callers may assign `id`, `controller` and `@context` after generation.
   */
  export interface Bls12381MultikeyPair {
    id?: string;
    controller?: string;
    publicKeyMultibase: string;
    secretKeyMultibase?: string;
    signer(): {
      algorithm: string;
      id?: string;
      sign(options: { data: Uint8Array }): Promise<Uint8Array>;
      multisign?(options: {
        header: Uint8Array;
        messages: Uint8Array[];
      }): Promise<Uint8Array>;
    };
    verifier(): {
      algorithm: string;
      id?: string;
      verify(options: unknown): Promise<boolean>;
    };
    export(options?: {
      publicKey?: boolean;
      secretKey?: boolean;
      includeContext?: boolean;
    }): Promise<Record<string, unknown>>;
    [key: string]: unknown;
  }

  export function generateBbsKeyPair(options: {
    algorithm: string;
    seed?: Uint8Array;
    id?: string;
    controller?: string;
  }): Promise<Bls12381MultikeyPair>;

  export function from(
    multikeyLike: unknown,
    options?: unknown
  ): Promise<Bls12381MultikeyPair>;
}

declare module '@digitalbazaar/data-integrity' {
  export class DataIntegrityProof {
    constructor(options: {
      signer?: unknown;
      date?: string | Date | number;
      cryptosuite: unknown;
      legacyContext?: boolean;
    });
    [key: string]: unknown;
  }
}

declare module '@digitalbazaar/did-method-key' {
  export interface DidKeyDriver {
    method: string;
    use(options: {
      multibaseMultikeyHeader: string;
      fromMultibase: (multikeyLike: unknown, options?: unknown) => Promise<unknown>;
    }): void;
    get(options: { did?: string; url?: string }): Promise<Record<string, unknown>>;
    [key: string]: unknown;
  }

  export function driver(options?: unknown): DidKeyDriver;
}

declare module '@digitalbazaar/did-io' {
  export class CachedResolver {
    constructor(options?: { cache?: unknown });
    use(driver: unknown): void;
    get(options: { did?: string; url?: string }): Promise<Record<string, unknown>>;
  }
}

declare module '@digitalbazaar/security-document-loader' {
  export interface JsonLdDocumentLoaderInstance {
    documents: Map<string, unknown>;
    addStatic(url: string, document: object): void;
    setDidResolver(resolver: unknown): void;
    build(): (url: string) => Promise<{
      contextUrl: string | null;
      document: unknown;
      documentUrl: string;
    }>;
  }

  export function securityLoader(options?: {
    cache?: unknown;
  }): JsonLdDocumentLoaderInstance;
}

declare module '@digitalbazaar/credentials-context' {
  export const contexts: Map<string, object>;
  export const metadata: Map<string, Record<string, unknown>>;
  export const named: Map<string, Record<string, unknown>>;
}

declare module 'jsonld-signatures' {
  export interface VerifyProofResult {
    verified: boolean;
    error?: unknown;
    [key: string]: unknown;
  }

  export interface VerifyResult {
    verified: boolean;
    error?: { errors?: unknown[]; message?: string } | Error;
    results?: VerifyProofResult[];
    [key: string]: unknown;
  }

  export interface JsonLdSignatures {
    sign(
      document: object,
      options: Record<string, unknown>
    ): Promise<Record<string, unknown>>;
    derive(
      document: object,
      options: Record<string, unknown>
    ): Promise<Record<string, unknown>>;
    verify(
      document: object,
      options: Record<string, unknown>
    ): Promise<VerifyResult>;
    purposes: {
      AssertionProofPurpose: new (options?: Record<string, unknown>) => unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  const jsigs: JsonLdSignatures;
  export default jsigs;
}
