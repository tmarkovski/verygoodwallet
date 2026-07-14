/**
 * The wire shape of a tier-2 proof: what the wallet embeds in the signed
 * presentation (the VP's `zkAgeProof` property, a JSON literal under the VGW
 * context) and what the verifier validates before checking the proof.
 *
 * Deliberately NOT trusted for public inputs: the verifier reconstructs
 * `[commitment, cutoff_days]` from the BBS-disclosed `birthDateCommitment`
 * claim and its own policy cutoff — the bundle's copies exist for display
 * and for cheap early mismatch errors.
 *
 * Exported as `@vgw/zk/bundle` for Cloudflare Worker consumers: this module
 * (like ./cutoff and ./encoding) must stay free of bb.js/noir imports, even
 * dynamic ones — Worker bundles upload every lazy chunk.
 */

import { fromBase64Url } from "@vgw/keys";
import { normalizeFieldHex } from "./encoding.js";

export const ZK_SCHEME = "noir-ultrahonk" as const;
export const ZK_CIRCUIT_ID = "vgw-age-check-v1" as const;

/** UltraHonk proof size sanity bounds (bytes); the current circuit's proofs are ~14.7 KB. */
const PROOF_MIN_BYTES = 1_000;
const PROOF_MAX_BYTES = 200_000;

export interface AgeProofBundle {
  scheme: typeof ZK_SCHEME;
  circuit: typeof ZK_CIRCUIT_ID;
  /** The predicate's age threshold (display + policy; the cutoff is what's proven). */
  years: number;
  /** Public input: latest qualifying birth date, days since the Unix epoch. */
  cutoffDays: number;
  /** Public input: the Poseidon commitment — must equal the BBS-disclosed claim. */
  commitment: string;
  /** UltraHonk proof bytes, base64url. */
  proof: string;
}

/**
 * Validate an untrusted bundle (throws naming the first problem). Returns the
 * bundle with `commitment` normalized to canonical `0x` + 64-hex form and the
 * decoded proof bytes.
 */
export function assertAgeProofBundle(value: unknown): {
  bundle: AgeProofBundle;
  proofBytes: Uint8Array;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("zkAgeProof must be a JSON object");
  }
  const raw = value as Record<string, unknown>;
  if (raw["scheme"] !== ZK_SCHEME) {
    throw new Error(`zkAgeProof.scheme must be "${ZK_SCHEME}", got ${JSON.stringify(raw["scheme"])}`);
  }
  if (raw["circuit"] !== ZK_CIRCUIT_ID) {
    throw new Error(
      `zkAgeProof.circuit must be "${ZK_CIRCUIT_ID}", got ${JSON.stringify(raw["circuit"])}`,
    );
  }
  const years = raw["years"];
  if (typeof years !== "number" || !Number.isInteger(years) || years <= 0 || years > 150) {
    throw new Error(`zkAgeProof.years must be a positive integer, got ${JSON.stringify(years)}`);
  }
  const cutoffDays = raw["cutoffDays"];
  if (
    typeof cutoffDays !== "number" ||
    !Number.isInteger(cutoffDays) ||
    cutoffDays < 0 ||
    cutoffDays > 0xffff_ffff
  ) {
    throw new Error(
      `zkAgeProof.cutoffDays must be a non-negative day count, got ${JSON.stringify(cutoffDays)}`,
    );
  }
  let commitment: string;
  try {
    commitment = normalizeFieldHex(raw["commitment"] as string);
  } catch (cause) {
    throw new Error("zkAgeProof.commitment is not a hex field element", { cause });
  }
  const proof = raw["proof"];
  if (typeof proof !== "string" || proof === "") {
    throw new Error("zkAgeProof.proof must be a non-empty base64url string");
  }
  let proofBytes: Uint8Array;
  try {
    proofBytes = fromBase64Url(proof);
  } catch (cause) {
    throw new Error("zkAgeProof.proof is not valid base64url", { cause });
  }
  if (proofBytes.length < PROOF_MIN_BYTES || proofBytes.length > PROOF_MAX_BYTES) {
    throw new Error(
      `zkAgeProof.proof has an implausible size (${proofBytes.length} bytes)`,
    );
  }
  return {
    bundle: { scheme: ZK_SCHEME, circuit: ZK_CIRCUIT_ID, years, cutoffDays, commitment, proof },
    proofBytes,
  };
}
