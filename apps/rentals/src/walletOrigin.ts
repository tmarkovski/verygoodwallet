/**
 * Which wallet the "Verify your driver details" link targets.
 *
 * Precedence: `?wallet=<origin>` query param → `VITE_WALLET_ORIGIN` →
 * localhost in dev → nothing (null) in production. Same policy as the DMV
 * and the shop: no production default, because until the M6 cutover the
 * apex domain serves the legacy app, which has no /present route — a
 * guessed origin would dead-end the verification. Production builds must
 * set VITE_WALLET_ORIGIN (the Deploy Rentals workflow requires it); without
 * it the UI shows a configuration notice instead of a broken link/QR.
 */

const DEV_WALLET_ORIGIN = "http://localhost:5173";

/** Normalize a configured value to a clean origin (trailing slash, stray path). */
function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function clientWalletOrigin(): string | null {
  const param = new URLSearchParams(window.location.search).get("wallet");
  if (param !== null && param !== "") {
    const origin = parseOrigin(param);
    if (origin !== null) {
      return origin;
    }
    // A malformed override falls through to the configured/default value.
  }
  const configured = import.meta.env.VITE_WALLET_ORIGIN;
  if (configured !== undefined && configured !== "") {
    const origin = parseOrigin(configured);
    if (origin !== null) {
      return origin;
    }
    console.warn(
      `vgw-rentals: VITE_WALLET_ORIGIN is not an absolute origin, ignoring it: ${configured}`,
    );
  }
  return import.meta.env.DEV ? DEV_WALLET_ORIGIN : null;
}
