/**
 * Default mandatory pointers for credkit issuance (and, historically, the
 * retired bbs-2023 stack — same set, same correlation caveat). Kept in a
 * dependency-free module on purpose.
 */
import type { VerifiableCredential } from './types.js';

/**
 * Mandatory pointers applied when the caller supplies none.
 *
 * `/validUntil` is included so relying parties can check expiry on derived
 * proofs. Privacy note: mandatory pointers are disclosed byte-for-byte in
 * EVERY derived proof, so any high-precision per-credential value here (e.g.
 * a millisecond issuance timestamp) becomes a correlation handle that defeats
 * unlinkability across verifiers — keep these values coarse (date-granular),
 * as `buildUtopiaDriversLicense` does by default.
 */
export const DEFAULT_MANDATORY_POINTERS = ['/issuer', '/validFrom', '/validUntil'] as const;

/** {@link DEFAULT_MANDATORY_POINTERS} filtered to the fields the credential carries. */
export function defaultMandatoryPointers(credential: VerifiableCredential): string[] {
  return DEFAULT_MANDATORY_POINTERS.filter(
    (pointer) => credential[pointer.slice(1)] !== undefined
  );
}
