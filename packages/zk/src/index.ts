/**
 * @vgw/zk — the tier-2 age predicate: a Noir circuit over the credential's
 * Poseidon birthdate commitment, proven in the browser and verified against
 * a checked-in UltraHonk verification key.
 *
 * Importing this package is cheap: the Noir/bb.js WASM stacks load behind
 * dynamic imports inside `proveAgePredicate` / `verifyAgeProof` only.
 */

export {
  assertAgeProofBundle,
  ZK_CIRCUIT_ID,
  ZK_SCHEME,
  type AgeProofBundle,
} from "./bundle.js";
export { ageCutoffDays } from "./cutoff.js";
export { fieldHex, normalizeFieldHex } from "./encoding.js";
export {
  proveAgePredicate,
  type ProveAgeOptions,
  type ProveAgeResult,
} from "./prove.js";
export {
  verifyAgeProof,
  type VerifyAgeProofOptions,
  type VerifyAgeProofResult,
} from "./verify.js";
