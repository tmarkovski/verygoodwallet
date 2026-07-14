import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adoptTourFromUrl,
  advanceTourFrom,
  currentTourStopId,
  exitTour,
  setTourStop,
  subscribeTour,
} from "./state";

/** A minimal window with per-test sessionStorage, location, and history. */
function stubWindow(href = "https://wallet.example/") {
  const store = new Map<string, string>();
  const win = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    location: { href, search: new URL(href).search },
    history: {
      replaceState: (_state: unknown, _title: string, url?: string | null) => {
        if (typeof url === "string") {
          win.location.href = url;
          win.location.search = new URL(url).search;
        }
      },
    },
  };
  (globalThis as { window?: unknown }).window = win;
  return win;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("tour state", () => {
  it("is inert without a window", () => {
    expect(currentTourStopId()).toBeNull();
    expect(adoptTourFromUrl()).toBeNull();
    setTourStop("create"); // must not throw
  });

  it("adopts a valid ?tour= param from the URL", () => {
    stubWindow("https://wallet.example/welcome?tour=create");
    expect(adoptTourFromUrl()).toBe("create");
    expect(currentTourStopId()).toBe("create");
  });

  it("ignores unknown stop ids, in the URL and in storage", () => {
    const win = stubWindow("https://wallet.example/?tour=bogus");
    expect(adoptTourFromUrl()).toBeNull();
    win.sessionStorage.setItem("vgw:tour:stop", "also-bogus");
    expect(currentTourStopId()).toBeNull();
    setTourStop("not-a-stop");
    expect(currentTourStopId()).toBeNull();
  });

  it("keeps existing state when the URL has no param", () => {
    stubWindow("https://wallet.example/credentials/3");
    setTourStop("credential");
    expect(adoptTourFromUrl()).toBe("credential");
  });

  it("advances only from the stop it was told about", () => {
    stubWindow();
    setTourStop("create");
    advanceTourFrom("offer"); // stale handler — must not move
    expect(currentTourStopId()).toBe("create");
    advanceTourFrom("create");
    expect(currentTourStopId()).toBe("home");
    advanceTourFrom("create"); // double-fire — must not skip ahead
    expect(currentTourStopId()).toBe("home");
  });

  it("exits by clearing state and stripping the URL param", () => {
    const win = stubWindow("https://shop.example/?session=abc&tour=shop-verified");
    adoptTourFromUrl();
    exitTour();
    expect(currentTourStopId()).toBeNull();
    expect(win.location.href).toBe("https://shop.example/?session=abc");
  });

  it("notifies subscribers on set and exit, and honors unsubscribe", () => {
    stubWindow();
    const listener = vi.fn();
    const unsubscribe = subscribeTour(listener);
    setTourStop("create");
    exitTour();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setTourStop("home");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
