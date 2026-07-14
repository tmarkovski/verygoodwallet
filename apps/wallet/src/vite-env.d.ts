/// <reference types="vite/client" />
/*
 * @vgw/vc-kit is consumed as TypeScript source; its ambient module shims for
 * the untyped @digitalbazaar packages must be part of this program too.
 */
/// <reference path="../../../packages/vc-kit/src/shims.d.ts" />

interface ImportMetaEnv {
  /** Build-time overrides for the demo's other sites (see services/demoSites.ts). */
  readonly VITE_DMV_ORIGIN?: string;
  readonly VITE_SHOP_ORIGIN?: string;
  readonly VITE_RENTALS_ORIGIN?: string;
  readonly VITE_LANDING_ORIGIN?: string;
}
