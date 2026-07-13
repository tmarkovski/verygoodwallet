/**
 * Shared error-message extraction for jsonld-signatures verify results,
 * used by both credential (bbs.ts) and presentation (presentation.ts)
 * verification.
 */

export function extractErrorMessage(result: {
  error?: { errors?: unknown[]; message?: string } | Error | unknown[];
  results?: { error?: unknown }[];
}): string {
  const topLevel = result.error;
  if (topLevel) {
    // ProofSet.verify sets `error` to an ARRAY of per-proof errors; the
    // jsigs.verify wrapper turns that into a VerificationError — an Error
    // whose `.errors` array holds the useful messages ("challenge is not as
    // expected", …) behind a generic "Verification error(s)." facade.
    if (Array.isArray(topLevel)) {
      return topLevel.map(toMessage).join('; ');
    }
    const errors = (topLevel as { errors?: unknown }).errors;
    const nested = Array.isArray(errors) ? errors.map(toMessage).join('; ') : '';
    return nested || toMessage(topLevel);
  }
  const perProof = (result.results ?? [])
    .map((r) => r.error)
    .filter((e) => e !== undefined)
    .map(toMessage)
    .join('; ');
  return perProof || 'Verification failed.';
}

export function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}
