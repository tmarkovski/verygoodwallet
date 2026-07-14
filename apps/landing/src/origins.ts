/**
 * Where the demo's sites live, from the landing's point of view — the tour
 * launcher and the cast links. Build-time overrides (VITE_*_ORIGIN) win;
 * otherwise the sibling dev ports locally and the custom domains in
 * production (flipped at the M6 cutover).
 */

import type { TourOrigins } from "@vgw/tour";

const DEV_ORIGINS = {
  wallet: "http://localhost:5173",
  dmv: "http://localhost:5174",
  shop: "http://localhost:5175",
  rentals: "http://localhost:5176",
} as const;

const PROD_ORIGINS = {
  wallet: "https://wallet.verygoodwallet.com",
  dmv: "https://dmv.verygoodwallet.com",
  shop: "https://shop.verygoodwallet.com",
  rentals: "https://rentals.verygoodwallet.com",
} as const;

function origin(configured: string | undefined, fallback: string): string {
  if (configured !== undefined && configured !== "") {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn(
        `vgw-landing: ignoring a malformed origin override: ${configured}`,
      );
    }
  }
  return fallback;
}

const defaults = import.meta.env.DEV ? DEV_ORIGINS : PROD_ORIGINS;

export const SITE_ORIGINS = {
  wallet: origin(import.meta.env.VITE_WALLET_ORIGIN, defaults.wallet),
  dmv: origin(import.meta.env.VITE_DMV_ORIGIN, defaults.dmv),
  shop: origin(import.meta.env.VITE_SHOP_ORIGIN, defaults.shop),
  rentals: origin(import.meta.env.VITE_RENTALS_ORIGIN, defaults.rentals),
} as const;

export const TOUR_ORIGINS: TourOrigins = SITE_ORIGINS;
