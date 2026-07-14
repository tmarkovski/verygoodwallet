/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time overrides for the demo's sites (see src/origins.ts). */
  readonly VITE_WALLET_ORIGIN?: string;
  readonly VITE_DMV_ORIGIN?: string;
  readonly VITE_SHOP_ORIGIN?: string;
  readonly VITE_RENTALS_ORIGIN?: string;
}
