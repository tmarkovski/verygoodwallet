/**
 * Which wallet the "Open in VeryGoodWallet" link targets.
 *
 * Precedence: `?wallet=<origin>` query param → `VITE_WALLET_ORIGIN` →
 * localhost in dev → nothing (null) in production. The link itself is rebuilt
 * client-side from `credential_offer_uri`, so the override works without
 * another server call (the server's `wallet_link` is only a fallback for API
 * consumers).
 *
 * There is deliberately no production default: until the M6 cutover the apex
 * domain serves the legacy GitHub Pages app, which has no /offer route, so a
 * guessed origin would dead-end issuance and hand the PII-bearing offer code
 * to the wrong host. Production builds must set VITE_WALLET_ORIGIN (the
 * Deploy DMV workflow requires it — see DEPLOY.md); without it the UI shows
 * a configuration notice instead of a broken link/QR.
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
      `vgw-dmv: VITE_WALLET_ORIGIN is not an absolute origin, ignoring it: ${configured}`,
    );
  }
  return import.meta.env.DEV ? DEV_WALLET_ORIGIN : null;
}
