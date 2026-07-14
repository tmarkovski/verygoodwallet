/**
 * UltraHonk verification against the checked-in verification key.
 *
 * WHERE THIS RUNS is the honest part of the tier-2 story: bb.js instantiates
 * WASM from bytes at runtime, which Cloudflare Workers prohibit (and its
 * WASM alone nearly fills the free plan's 3 MiB script budget) — so the shop
 * WORKER cannot run this. Instead the shop's own CLIENT runs it (same
 * origin, same operator, lazy-loaded bb.js), and the e2e suite runs the
 * identical call in Node — which is exactly what a self-hosted verifier
 * would execute server-side.
 *
 * Trust model: the verification key ships with the VERIFIER's code (checked
 * in at compile time), and the public inputs are reconstructed from the
 * BBS-disclosed commitment + the verifier's own cutoff — nothing
 * prover-supplied is trusted beyond the proof bytes themselves.
 */

import { fromBase64Url } from "@vgw/keys";
import { fieldHex, normalizeFieldHex } from "./encoding.js";

export interface VerifyAgeProofOptions {
  /** UltraHonk proof bytes (or their base64url form, as carried in the bundle). */
  proof: Uint8Array | string;
  /** The BBS-disclosed `birthDateCommitment` claim (0x-hex) — NOT the bundle's copy. */
  commitment: string;
  /** The cutoff the VERIFIER accepts (already policy-checked against the bundle's). */
  cutoffDays: number;
  /** Override bb.js's thread autodetection; verification is light, 1 is plenty. */
  threads?: number;
}

export interface VerifyAgeProofResult {
  verified: boolean;
  /** `[commitment, cutoff_days]` as passed to the proof system. */
  publicInputs: string[];
  /** sha256 of the verification key used (inspector display). */
  vkHash: string;
  verifyMs: number;
}

/**
 * Prefetch and compile the verifier's WASM ahead of a verification. The api
 * instance is not kept — verifyAgeProof builds its own — so the warmth lives
 * in the browser's HTTP and compiled-WASM caches, which is exactly what the
 * real call hits next. First-ever verification on a fresh origin otherwise
 * pays a multi-second cold start (measured ~26s; ~0.6s warm).
 */
export async function warmAgeVerifier(): Promise<void> {
  try {
    const { Barretenberg } = await import("@aztec/bb.js");
    const api = await Barretenberg.new({ threads: 1 });
    await api.destroy();
  } catch {
    // Best-effort: a failed warm just means the real call pays the cost.
  }
}

export async function verifyAgeProof(
  opts: VerifyAgeProofOptions,
): Promise<VerifyAgeProofResult> {
  if (!Number.isInteger(opts.cutoffDays) || opts.cutoffDays < 0 || opts.cutoffDays > 0xffff_ffff) {
    throw new RangeError(`verifyAgeProof: cutoffDays out of u32 range: ${opts.cutoffDays}`);
  }
  const publicInputs = [normalizeFieldHex(opts.commitment), fieldHex(opts.cutoffDays)];
  const proof = typeof opts.proof === "string" ? fromBase64Url(opts.proof) : opts.proof;

  const [{ Barretenberg, UltraHonkVerifierBackend }, vkArtifact] = await Promise.all([
    import("@aztec/bb.js"),
    import("../artifacts/age_check.vk.json"),
  ]);
  const verificationKey = fromBase64Url(vkArtifact.default.vkBase64Url);

  const started = Date.now();
  const api = await Barretenberg.new({ threads: opts.threads ?? 1 });
  try {
    const verifier = new UltraHonkVerifierBackend(api);
    const verified = await verifier.verifyProof({
      proof,
      publicInputs,
      verificationKey,
    });
    return {
      verified,
      publicInputs,
      vkHash: vkArtifact.default.vkHash,
      verifyMs: Date.now() - started,
    };
  } catch {
    // bb.js throws on structurally-broken proofs (wrong length, bad field
    // encodings); for a verifier that is just "not verified".
    return {
      verified: false,
      publicInputs,
      vkHash: vkArtifact.default.vkHash,
      verifyMs: Date.now() - started,
    };
  } finally {
    await api.destroy();
  }
}
