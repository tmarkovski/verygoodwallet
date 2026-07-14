/**
 * Where the rest of the demo lives, from the wallet's point of view — the
 * single source for every cross-site origin the wallet renders (tour CTAs,
 * the inspector's derivation branches).
 *
 * Build-time overrides (VITE_*_ORIGIN) win; otherwise the sibling dev ports
 * locally and the custom domains in production (flipped at the M6 cutover;
 * the retired workers.dev hostnames still serve, but nothing links to them).
 */

import type { TourOrigins } from "@vgw/tour";

const DEV_ORIGINS = {
  dmv: "http://localhost:5174",
  shop: "http://localhost:5175",
  rentals: "http://localhost:5176",
  landing: "http://localhost:5177",
} as const;

const PROD_ORIGINS = {
  dmv: "https://dmv.verygoodwallet.com",
  shop: "https://shop.verygoodwallet.com",
  rentals: "https://rentals.verygoodwallet.com",
  landing: "https://verygoodwallet.com",
} as const;

function origin(configured: string | undefined, fallback: string): string {
  if (configured !== undefined && configured !== "") {
    try {
      return new URL(configured).origin;
    } catch {
      console.warn(
        `vgw-wallet: ignoring a malformed origin override: ${configured}`,
      );
    }
  }
  return fallback;
}

const defaults = import.meta.env.DEV ? DEV_ORIGINS : PROD_ORIGINS;

export const DEMO_SITE_ORIGINS = {
  dmv: origin(import.meta.env.VITE_DMV_ORIGIN, defaults.dmv),
  shop: origin(import.meta.env.VITE_SHOP_ORIGIN, defaults.shop),
  rentals: origin(import.meta.env.VITE_RENTALS_ORIGIN, defaults.rentals),
  landing: origin(import.meta.env.VITE_LANDING_ORIGIN, defaults.landing),
} as const;

export const TOUR_ORIGINS: TourOrigins = DEMO_SITE_ORIGINS;
