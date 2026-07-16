/**
 * credkit issuance facade — the ONLY path through which VGW apps touch
 * `@credkit/cryptosuite` (house pattern: apps import vc-kit facades, never
 * credkit directly).
 *
 * What it pins, so no caller can get it wrong (MIGRATION §4, §11):
 * - the cryptosuite era: `credkit-bbs-sha-2026`, forever — the link-secret
 *   scalar is suite-dependent, so cross-credential equality never crosses
 *   eras;
 * - the document loader: VGW's bundled offline contexts on credkit's strict
 *   loader. Credkit's default knows only the VC v2 context and would reject
 *   the vDL/AAMVA/VGW URLs before any proof is produced — EVERY credkit call
 *   gets this loader explicitly;
 * - the default mandatory pointers: the same `/issuer`,`/validFrom`,
 *   `/validUntil` set bbs-2023 issuance uses (disclosed in every derived
 *   proof — keep them coarse).
 *
 * Issuance is always holder-bound here: the wallet commits to its
 * master-derived link secret (`createHolderBinding({ linkSecret })` — the
 * bare call mints a random secret and silently breaks cross-credential
 * linking), the issuer blind-signs a message it never sees, and the wallet
 * runs the receipt check before anything enters the vault.
 */
import {
  CRYPTOSUITE_SHA,
  createDocumentLoader,
  createHolderBinding,
  issueCredential,
  verifyIssuedCredential,
  type CreateHolderBindingOptions,
  type HolderBinding,
  type NumericDeclarationEntry,
} from '@credkit/cryptosuite';
import { defaultMandatoryPointers } from './mandatory.js';
import { BUNDLED_CONTEXTS } from './contexts/index.js';
import type { CredkitBbsKeyPair } from './keys.js';
import type { VerifiableCredential } from './types.js';

/**
 * The pinned credkit Data Integrity cryptosuite id: `credkit-bbs-sha-2026`.
 * One era, forever (MIGRATION §11) — nothing in VGW may pass another.
 */
export const CREDKIT_CRYPTOSUITE = CRYPTOSUITE_SHA;

/**
 * VGW's strict, offline document loader in credkit's shape: every bundled
 * context (vDL, AAMVA, VGW, citizenship, security, …) plus the VC v2 context
 * credkit vendors itself. Unknown URLs are a hard error, never a fetch.
 */
export const credkitDocumentLoader = createDocumentLoader(
  Object.fromEntries(BUNDLED_CONTEXTS),
);

/** Options for {@link issueCredkitCredential}. */
export interface IssueCredkitCredentialOptions {
  /** The unsigned VC 2.0 credential. Must carry `@context` and no `proof`. */
  credential: VerifiableCredential;
  /** Issuer key pair from `generateCredkitBbsKeyPair`. */
  keyPair: CredkitBbsKeyPair;
  /**
   * JSON pointers disclosed in EVERY derived presentation. Defaults to
   * `['/issuer', '/validFrom', '/validUntil']` filtered to the fields the
   * credential carries — the same default (and the same correlation caveat)
   * as bbs-2023 `signCredential`.
   */
  mandatoryPointers?: readonly string[];
  /**
   * Ordered (pointer, encoder) pairs declaring hidden numeric twins, e.g.
   * `UTOPIA_DL_NUMERIC_DECLARATIONS` for the DL's `date1900` birth date.
   */
  numericDeclarations?: readonly NumericDeclarationEntry[];
  /**
   * The holder's `commitmentWithProof` bytes from `createHolderBinding` —
   * REQUIRED: VGW issuance is always holder-bound to the link secret; a
   * credential without it can never prove "same holder" (MIGRATION §6).
   */
  holderCommitment: Uint8Array;
}

/**
 * Issue a credential under the pinned `credkit-bbs-sha-2026` suite, blind-
 * signing the holder's link-secret commitment (issuer operation). The
 * verification method is the key pair's did:key `id`; the offline VGW loader
 * is always passed.
 */
export async function issueCredkitCredential(
  options: IssueCredkitCredentialOptions,
): Promise<VerifiableCredential> {
  const { verifiableCredential } = await issueCredential({
    document: options.credential as Record<string, unknown>,
    keyPair: { secretKey: options.keyPair.secretKey, publicKey: options.keyPair.publicKey },
    verificationMethod: options.keyPair.id,
    cryptosuite: CREDKIT_CRYPTOSUITE,
    mandatoryPointers:
      options.mandatoryPointers ?? defaultMandatoryPointers(options.credential),
    ...(options.numericDeclarations !== undefined
      ? { numericDeclarations: options.numericDeclarations }
      : {}),
    holderCommitment: options.holderCommitment,
    documentLoader: credkitDocumentLoader,
  });
  return verifiableCredential as VerifiableCredential;
}

/** Options for {@link verifyIssuedCredkitCredential}. */
export interface VerifyIssuedCredkitCredentialOptions {
  /** The credential as received from the issuer. */
  verifiableCredential: VerifiableCredential;
  /**
   * The holder's binding for this issuance: the link secret that was
   * committed and the per-credential `secretProverBlind` returned by
   * `createHolderBinding`. Required for holder-bound credentials.
   */
  holderBinding?: Pick<HolderBinding, 'linkSecret' | 'secretProverBlind'>;
}

/**
 * Holder receipt check (replaces the retired commitment-opening validation):
 * recompute the whole credkit pipeline from the received credential and
 * verify the issuer's blind signature against the holder's own link secret
 * and blind. Fails closed — any disagreement is `false`, never a throw.
 */
export async function verifyIssuedCredkitCredential(
  options: VerifyIssuedCredkitCredentialOptions,
): Promise<boolean> {
  return verifyIssuedCredential({
    verifiableCredential: options.verifiableCredential,
    ...(options.holderBinding !== undefined
      ? { holderBinding: options.holderBinding }
      : {}),
    documentLoader: credkitDocumentLoader,
  });
}

// The holder side of blind issuance, re-exported so the wallet never imports
// credkit directly. ALWAYS pass { linkSecret: deriveLinkSecret(master) }: the
// bare call mints a fresh random secret per call (fine for one credential,
// fatal for cross-credential equality and one-secret-for-life — MIGRATION §6).
export {
  createHolderBinding,
  type CreateHolderBindingOptions,
  type HolderBinding,
  type NumericDeclarationEntry,
};
