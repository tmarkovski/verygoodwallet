/**
 * Where the tour's "now rent a car" CTA points. Unlike walletOrigin, a
 * production default is safe here — the link carries no secrets, only the
 * tour's stop id. Flipped to the custom domain at the M6 cutover.
 */

const DEV_RENTALS_ORIGIN = "http://localhost:5176";
const PROD_RENTALS_ORIGIN = "https://rentals.verygoodwallet.com";

export function rentalsOrigin(): string {
  const configured = import.meta.env.VITE_RENTALS_ORIGIN;
  if (configured !== undefined && configured !== "") {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn(
        `vgw-shop: VITE_RENTALS_ORIGIN is not an absolute origin, ignoring it: ${configured}`,
      );
    }
  }
  return import.meta.env.DEV ? DEV_RENTALS_ORIGIN : PROD_RENTALS_ORIGIN;
}
