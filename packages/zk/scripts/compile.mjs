// Compiles circuit/age_check with @noir-lang/noir_wasm and derives the
// UltraHonk verification key with @aztec/bb.js, writing both to artifacts/.
//
// The artifacts are CHECKED IN so consumers (wallet, shop, CI) never need a
// Noir toolchain; re-run `pnpm --filter @vgw/zk compile` after editing the
// circuit or bumping noir/bb versions. The test suite recompiles and
// compares, so a stale artifact fails CI instead of shipping.
import { compile_program, createFileManager } from "@noir-lang/noir_wasm";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const circuitDir = resolve(packageRoot, "circuit/age_check");
const artifactsDir = resolve(packageRoot, "artifacts");

// ---------------------------------------------------------------------------
// 1. Compile. Only bytecode + abi are kept: debug symbols and the file map
//    embed absolute build-machine paths, which would make the checked-in
//    artifact differ per machine.
// ---------------------------------------------------------------------------
const fileManager = createFileManager(circuitDir);
const compiled = await compile_program(fileManager);
const { noir_version, hash, abi, bytecode } = compiled.program;

// The prover/verifier wrappers hardcode the public-input order
// [commitment, cutoff_days]; fail the build if the circuit disagrees.
const publicParams = abi.parameters
  .filter((p) => p.visibility === "public")
  .map((p) => p.name);
if (JSON.stringify(publicParams) !== JSON.stringify(["commitment", "cutoff_days"])) {
  throw new Error(
    `Circuit public inputs changed (${publicParams.join(", ")}) — update src/prove.ts + src/verify.ts before recompiling`,
  );
}

const artifact = { noir_version, hash, abi, bytecode };

// ---------------------------------------------------------------------------
// 2. Verification key (proof-system side, depends on the bb.js version).
// ---------------------------------------------------------------------------
const api = await Barretenberg.new({ threads: 4 });
// The exact-pinned bb.js version from our own manifest (bb.js does not
// export its package.json).
const bbVersion = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
).dependencies["@aztec/bb.js"];
const backend = new UltraHonkBackend(bytecode, api);
const vk = await backend.getVerificationKey();
await api.destroy();

const vkArtifact = {
  bbVersion,
  vkHash: createHash("sha256").update(vk).digest("hex"),
  // base64url to match @vgw/keys' fromBase64Url, which the verifier uses.
  vkBase64Url: Buffer.from(vk).toString("base64url"),
};

// ---------------------------------------------------------------------------
// 3. Write.
// ---------------------------------------------------------------------------
mkdirSync(artifactsDir, { recursive: true });
writeFileSync(
  resolve(artifactsDir, "age_check.json"),
  JSON.stringify(artifact, null, 2) + "\n",
);
writeFileSync(
  resolve(artifactsDir, "age_check.vk.json"),
  JSON.stringify(vkArtifact, null, 2) + "\n",
);
console.log(
  `age_check compiled (noir ${noir_version}): bytecode ${bytecode.length} chars, vk ${vk.length} bytes (bb.js ${bbVersion}), vk hash ${vkArtifact.vkHash}`,
);
process.exit(0); // bb.js worker threads keep the event loop alive
