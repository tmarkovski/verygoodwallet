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

/**
 * A W3C VC Data Model 2.0 presentation (unsigned or signed). Open-world like
 * {@link VerifiableCredential}.
 */
export interface VerifiablePresentation {
  '@context': JsonLdContextEntry | JsonLdContextEntry[];
  type: string | string[];
  /**
   * A presenter DID. Credkit presentations never carry one — the holder is
   * bound cryptographically via the blind-committed link secret, and credkit
   * rejects a `holder` property outright — so on the live stack this field
   * is always absent. It stays in the open-world type because foreign VPs
   * may carry it.
   */
  holder?: string;
  verifiableCredential?: VerifiableCredential | VerifiableCredential[];
  proof?: Record<string, unknown> | Record<string, unknown>[];
  [key: string]: unknown;
}
