/**
 * Which wallet the "Open in VeryGoodWallet" link targets.
 *
 * Precedence: `?wallet=<origin>` query param → `VITE_WALLET_ORIGIN` →
 * dev/production default. The link itself is rebuilt client-side from
 * `credential_offer_uri`, so the override works without another server call
 * (the server's `wallet_link` is only a fallback for API consumers).
 */

const DEFAULT_WALLET_ORIGIN = import.meta.env.DEV
  ? "http://localhost:5173"
  : "https://verygoodwallet.com";

export function clientWalletOrigin(): string {
  const param = new URLSearchParams(window.location.search).get("wallet");
  if (param !== null && param !== "") {
    try {
      // Normalize to a clean origin; a malformed value falls through to the default.
      return new URL(param).origin;
    } catch {
      /* ignore */
    }
  }
  return import.meta.env.VITE_WALLET_ORIGIN ?? DEFAULT_WALLET_ORIGIN;
}
