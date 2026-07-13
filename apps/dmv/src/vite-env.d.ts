/// <reference types="vite/client" />
/*
 * @vgw/vc-kit is consumed as TypeScript source (via worker/); its ambient
 * module shims for the untyped @digitalbazaar packages must be part of this
 * program too.
 */
/// <reference path="../../../packages/vc-kit/src/shims.d.ts" />

interface ImportMetaEnv {
  /** Build-time default for the wallet origin the offer links target. */
  readonly VITE_WALLET_ORIGIN?: string;
}
