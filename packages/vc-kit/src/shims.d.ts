/**
 * Ambient module shim for @digitalbazaar/di-sd-primitives — the one untyped
 * JavaScript dependency left in the credkit runtime graph (the HMAC label
 * shuffle inside @credkit/cryptosuite's document pipeline).
 *
 * @credkit/cryptosuite is consumed as TypeScript SOURCE (MIGRATION §11), so
 * its import of this untyped package is typechecked inside every consumer's
 * compilation. credkit ships the same declarations in its own src/vendor.d.ts,
 * but ambient .d.ts files inside node_modules are only loaded when referenced
 * — this mirror (same surface, kept in sync with the pinned credkit sha) is
 * what loads them here and in every app that references shims.d.ts.
 */
declare module '@digitalbazaar/di-sd-primitives' {
  export type LabelMapFactory = (input: {
    canonicalIdMap: Map<string, string>;
  }) => Promise<Map<string, string>>;

  export interface DocumentLoaderResult {
    contextUrl: string | null;
    document: unknown;
    documentUrl: string;
  }
  export type DocumentLoader = (url: string) => Promise<DocumentLoaderResult>;
  export interface DiSdOptions {
    documentLoader: DocumentLoader;
  }

  export interface GroupResult {
    matching: Map<number, string>;
    nonMatching: Map<number, string>;
    deskolemizedNQuads: string[];
  }

  export function canonicalizeAndGroup(input: {
    document: Record<string, unknown>;
    labelMapFactoryFunction: LabelMapFactory;
    groups: Record<string, readonly string[]>;
    options: DiSdOptions;
  }): Promise<{
    groups: Record<string, GroupResult>;
    labelMap: Map<string, string>;
    nquads: string[];
  }>;

  export function canonicalize(
    input: string | Record<string, unknown>,
    options: DiSdOptions & { inputFormat?: string; canonicalIdMap?: Map<string, string> },
  ): Promise<string>;

  export function canonizeProof(input: {
    document: Record<string, unknown>;
    proof: Record<string, unknown>;
    options: DiSdOptions;
  }): Promise<string>;

  export function selectJsonLd(input: {
    document: Record<string, unknown>;
    pointers: readonly string[];
  }): Record<string, unknown>;

  export function createLabelMapFunction(input: {
    labelMap: Map<string, string>;
  }): LabelMapFactory;

  export function labelReplacementCanonicalizeJsonLd(input: {
    document: Record<string, unknown>;
    labelMapFactoryFunction: LabelMapFactory;
    options: DiSdOptions;
  }): Promise<string[]>;

  export function stripBlankNodePrefixes(map: Map<string, string>): Map<string, string>;

  export interface Hmac {
    sign(data: Uint8Array): Promise<Uint8Array>;
    export(): Promise<Uint8Array>;
  }
  export function createHmac(input: { key: Uint8Array | null }): Promise<Hmac>;
}
