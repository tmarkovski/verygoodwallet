/**
 * Guards the checked-in artifacts against drift: the circuit source, the
 * pinned noir_wasm compiler, and artifacts/age_check.json must agree — a
 * circuit edit without `pnpm --filter @vgw/zk compile` fails here instead of
 * shipping a prover that disagrees with the verification key.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import artifact from "../artifacts/age_check.json";
import vkArtifact from "../artifacts/age_check.vk.json";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("checked-in artifacts", () => {
  it("match a fresh compile of the circuit source", { timeout: 120_000 }, async () => {
    const { compile_program, createFileManager } = await import("@noir-lang/noir_wasm");
    const fm = createFileManager(resolve(packageRoot, "circuit/age_check"));
    const compiled = await compile_program(fm);
    expect(compiled.program.bytecode).toBe(artifact.bytecode);
    expect(compiled.program.noir_version).toBe(artifact.noir_version);
  });

  it("declare the public inputs the wrappers hardcode", () => {
    const publicParams = artifact.abi.parameters
      .filter((p) => p.visibility === "public")
      .map((p) => p.name);
    expect(publicParams).toEqual(["commitment", "cutoff_days"]);
  });

  it("pin the verification key to the installed bb.js version", async () => {
    const manifest = await import("../package.json");
    expect(vkArtifact.bbVersion).toBe(manifest.default.dependencies["@aztec/bb.js"]);
    expect(vkArtifact.vkHash).toMatch(/^[0-9a-f]{64}$/);
    expect(vkArtifact.vkBase64Url.length).toBeGreaterThan(1000);
  });
});
