/**
 * Browser/Node proving wrapper. The heavyweight dependencies — noir_js's
 * ACVM/ABI WASM and bb.js's barretenberg WASM (~10 MB uncompressed) — load
 * behind dynamic imports, so importing @vgw/zk costs nothing until a proof
 * is actually generated. bb.js picks its own thread count (Web Workers when
 * `crossOriginIsolated`, single-threaded WASM otherwise).
 */

import { toBase64Url, verifyCommitment } from "@vgw/keys";
import { assertAgeProofBundle, ZK_CIRCUIT_ID, ZK_SCHEME, type AgeProofBundle } from "./bundle.js";
import { fieldHex, normalizeFieldHex } from "./encoding.js";

export interface ProveAgeOptions {
  /** Private: the committed birth date, days since the Unix epoch. */
  dobDays: number;
  /** Private: the commitment's blinding factor (0x-hex, from the vault opening). */
  blinding: string;
  /** Public: the credential's signed `birthDateCommitment` (0x-hex). */
  commitment: string;
  /** Public: latest qualifying birth date in days — see `ageCutoffDays`. */
  cutoffDays: number;
  /** The predicate's threshold, recorded in the bundle for the verifier's policy check. */
  years: number;
  /** Override bb.js's thread autodetection (e.g. 1 to force single-threaded). */
  threads?: number;
  /** Phase callback for progress UI. */
  onPhase?: (phase: "loading-circuit" | "executing" | "proving") => void;
}

export interface ProveAgeResult {
  bundle: AgeProofBundle;
  /** `[commitment, cutoff_days]` exactly as the proof transcript encodes them. */
  publicInputs: string[];
  provingMs: number;
}

export async function proveAgePredicate(opts: ProveAgeOptions): Promise<ProveAgeResult> {
  const commitment = normalizeFieldHex(opts.commitment);
  if (!Number.isInteger(opts.dobDays) || opts.dobDays < 0 || opts.dobDays > 0xffff_ffff) {
    throw new RangeError(`proveAgePredicate: dobDays out of u32 range: ${opts.dobDays}`);
  }
  if (!Number.isInteger(opts.cutoffDays) || opts.cutoffDays < 0 || opts.cutoffDays > 0xffff_ffff) {
    throw new RangeError(`proveAgePredicate: cutoffDays out of u32 range: ${opts.cutoffDays}`);
  }
  // Friendly pre-flight: the circuit would reject a wrong opening anyway, but
  // "Cannot satisfy constraint" helps nobody.
  if (!verifyCommitment(opts.dobDays, opts.blinding, commitment)) {
    throw new Error(
      "proveAgePredicate: the vault's commitment opening does not open the credential's birthDateCommitment",
    );
  }
  if (opts.dobDays > opts.cutoffDays) {
    throw new Error(
      "proveAgePredicate: the committed birth date is after the cutoff — the predicate is not satisfiable",
    );
  }

  opts.onPhase?.("loading-circuit");
  const [{ Noir }, { Barretenberg, UltraHonkBackend }, artifact] = await Promise.all([
    import("@noir-lang/noir_js"),
    import("@aztec/bb.js"),
    import("../artifacts/age_check.json"),
  ]);

  opts.onPhase?.("executing");
  const noir = new Noir(artifact.default as never);
  const { witness } = await noir.execute({
    dob_days: opts.dobDays,
    blinding: normalizeFieldHex(opts.blinding),
    commitment,
    cutoff_days: opts.cutoffDays,
  });

  opts.onPhase?.("proving");
  const started = Date.now();
  const api = await Barretenberg.new(
    opts.threads !== undefined ? { threads: opts.threads } : {},
  );
  try {
    const backend = new UltraHonkBackend(artifact.default.bytecode, api);
    const proof = await backend.generateProof(witness);
    const provingMs = Date.now() - started;

    // The verifier reconstructs these; catch ABI drift here, not there.
    const expected = [commitment, fieldHex(opts.cutoffDays)];
    const actual = proof.publicInputs.map((value) => normalizeFieldHex(value));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `proveAgePredicate: unexpected public-input layout — got [${actual.join(", ")}], expected [${expected.join(", ")}]`,
      );
    }

    const { bundle } = assertAgeProofBundle({
      scheme: ZK_SCHEME,
      circuit: ZK_CIRCUIT_ID,
      years: opts.years,
      cutoffDays: opts.cutoffDays,
      commitment,
      proof: toBase64Url(proof.proof),
    });
    return { bundle, publicInputs: actual, provingMs };
  } finally {
    await api.destroy();
  }
}
