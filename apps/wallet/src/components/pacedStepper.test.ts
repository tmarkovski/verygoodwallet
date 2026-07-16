import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPacedStepper } from "./pacedStepper";

describe("createPacedStepper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the first step immediately and paces rapid successors", async () => {
    const shown: string[] = [];
    const pacer = createPacedStepper<string>((id) => shown.push(id), 200);

    pacer.step("a");
    pacer.step("b");
    pacer.step("c");
    expect(shown).toEqual(["a"]);

    await vi.advanceTimersByTimeAsync(199);
    expect(shown).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(shown).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(shown).toEqual(["a", "b", "c"]);
  });

  it("shows a slow phase the moment it begins", async () => {
    const shown: string[] = [];
    const pacer = createPacedStepper<string>((id) => shown.push(id), 200);

    pacer.step("a");
    await vi.advanceTimersByTimeAsync(500);
    pacer.step("b");
    expect(shown).toEqual(["a", "b"]);
  });

  it("settled() waits for the queue to drain plus the final dwell", async () => {
    const shown: string[] = [];
    const pacer = createPacedStepper<string>((id) => shown.push(id), 200);

    pacer.step("a");
    pacer.step("b");
    let done = false;
    void pacer.settled().then(() => {
      done = true;
    });

    // "a" dwelling, "b" queued: 200ms shows b, 400ms ends b's dwell.
    await vi.advanceTimersByTimeAsync(399);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(shown).toEqual(["a", "b"]);
  });

  it("settled() resolves immediately when nothing is dwelling", async () => {
    const pacer = createPacedStepper<string>(() => {}, 200);
    await expect(pacer.settled()).resolves.toBeUndefined();
  });
});
