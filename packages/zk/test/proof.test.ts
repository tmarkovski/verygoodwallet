/**
 * Real UltraHonk proofs — no mocks. Slow (~2s per proof), which is the
 * point: this is the exact code path the wallet (prove) and the shop client
 * + e2e (verify) execute.
 */
import { describe, expect, it } from "vitest";
import { createCommitment, daysSinceEpoch } from "@vgw/keys";
import { ageCutoffDays } from "../src/cutoff.js";
import { fieldHex } from "../src/encoding.js";
import { proveAgePredicate } from "../src/prove.js";
import { verifyAgeProof } from "../src/verify.js";

const NOW = new Date("2026-07-13T12:00:00Z");
// Alex Hale, the DMV's default persona: born 1988-04-19.
const DOB_DAYS = daysSinceEpoch("1988-04-19");
const OPENING = createCommitment(DOB_DAYS);
const CUTOFF_18 = ageCutoffDays(18, NOW);

describe("proveAgePredicate + verifyAgeProof", () => {
  it("proves and verifies an over-18 predicate end to end", { timeout: 120_000 }, async () => {
    const { bundle, publicInputs, provingMs } = await proveAgePredicate({
      dobDays: DOB_DAYS,
      blinding: OPENING.blinding,
      commitment: OPENING.commitment,
      cutoffDays: CUTOFF_18,
      years: 18,
    });
    expect(provingMs).toBeGreaterThan(0);
    expect(publicInputs).toEqual([OPENING.commitment, fieldHex(CUTOFF_18)]);
    expect(bundle.commitment).toBe(OPENING.commitment);

    const result = await verifyAgeProof({
      proof: bundle.proof,
      commitment: OPENING.commitment,
      cutoffDays: CUTOFF_18,
    });
    expect(result.verified).toBe(true);
    expect(result.publicInputs).toEqual(publicInputs);

    // The verifier binds the proof to ITS values: a different commitment or
    // cutoff is a different statement and must not verify.
    const otherCommitment = createCommitment(DOB_DAYS).commitment; // fresh blinding
    await expect(
      verifyAgeProof({
        proof: bundle.proof,
        commitment: otherCommitment,
        cutoffDays: CUTOFF_18,
      }),
    ).resolves.toMatchObject({ verified: false });
    await expect(
      verifyAgeProof({
        proof: bundle.proof,
        commitment: OPENING.commitment,
        cutoffDays: CUTOFF_18 - 400,
      }),
    ).resolves.toMatchObject({ verified: false });

    // Garbage of a plausible length must not verify (nor throw).
    const garbage = new Uint8Array(bundle.proof.length).fill(0x42);
    await expect(
      verifyAgeProof({
        proof: garbage.slice(0, 14656),
        commitment: OPENING.commitment,
        cutoffDays: CUTOFF_18,
      }),
    ).resolves.toMatchObject({ verified: false });
  });

  it("refuses to prove an unsatisfiable predicate (under 18)", async () => {
    // Noa Lindqvist, the DMV's under-18 persona: born 2009-11-02.
    const minorDays = daysSinceEpoch("2009-11-02");
    const minorOpening = createCommitment(minorDays);
    await expect(
      proveAgePredicate({
        dobDays: minorDays,
        blinding: minorOpening.blinding,
        commitment: minorOpening.commitment,
        cutoffDays: CUTOFF_18,
        years: 18,
      }),
    ).rejects.toThrow(/not satisfiable/);
  });

  it("refuses to prove with an opening that does not match the commitment", async () => {
    await expect(
      proveAgePredicate({
        dobDays: DOB_DAYS,
        blinding: createCommitment(DOB_DAYS).blinding, // different blinding
        commitment: OPENING.commitment,
        cutoffDays: CUTOFF_18,
        years: 18,
      }),
    ).rejects.toThrow(/does not open/);
  });
});
