import { afterEach, describe, expect, it } from "vitest";
import { MAX_EVENTS, inspect } from "./events";

afterEach(() => {
  inspect.clear();
});

describe("inspect (event bus)", () => {
  it("emits events with monotonic ids and timestamps", () => {
    const first = inspect.emit({ label: "one" });
    const second = inspect.emit({ label: "two", data: { n: 2 } });
    expect(second.id).toBeGreaterThan(first.id);
    expect(first.t).toBeLessThanOrEqual(second.t);
    expect(inspect.snapshot().map((e) => e.label)).toEqual(["one", "two"]);
    expect(inspect.snapshot()[1]?.data).toEqual({ n: 2 });
  });

  it("omits the data key when no data is given", () => {
    const event = inspect.emit({ label: "bare" });
    expect("data" in event).toBe(false);
  });

  it("notifies subscribers on emit and clear, and honors unsubscribe", () => {
    let calls = 0;
    const unsubscribe = inspect.subscribe(() => {
      calls += 1;
    });
    inspect.emit({ label: "a" });
    expect(calls).toBe(1);
    inspect.clear();
    expect(calls).toBe(2);
    unsubscribe();
    inspect.emit({ label: "b" });
    expect(calls).toBe(2);
  });

  it("keeps a stable snapshot reference between emits", () => {
    inspect.emit({ label: "a" });
    const snapshot = inspect.snapshot();
    expect(inspect.snapshot()).toBe(snapshot);
    inspect.emit({ label: "b" });
    expect(inspect.snapshot()).not.toBe(snapshot);
  });

  it("caps the buffer at MAX_EVENTS, dropping oldest", () => {
    for (let i = 0; i < MAX_EVENTS + 10; i++) {
      inspect.emit({ label: `event-${i}` });
    }
    const events = inspect.snapshot();
    expect(events.length).toBe(MAX_EVENTS);
    expect(events[0]?.label).toBe("event-10");
    expect(events[events.length - 1]?.label).toBe(`event-${MAX_EVENTS + 9}`);
  });
});
