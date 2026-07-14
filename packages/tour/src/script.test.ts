import { describe, expect, it } from "vitest";
import {
  TOUR_PERSONA,
  TOUR_STOPS,
  nextTourStop,
  tourCtaHref,
  tourProgress,
  tourStop,
  withTourParam,
} from "./script";

describe("the tour script", () => {
  it("has unique, URL-safe stop ids", () => {
    const ids = TOUR_STOPS.map((stop) => stop.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });

  it("is bookended by the landing", () => {
    expect(TOUR_STOPS[0]?.site).toBe("landing");
    expect(TOUR_STOPS[TOUR_STOPS.length - 1]?.site).toBe("landing");
  });

  it("only offers narrator CTAs for cross-origin hops", () => {
    for (const stop of TOUR_STOPS) {
      if (stop.ctaLabel === undefined) continue;
      const next = nextTourStop(stop.id);
      expect(next, `${stop.id} has a CTA but no next stop`).not.toBeNull();
      expect(next?.site).not.toBe(stop.site);
    }
  });

  it("guides every non-CTA overlay stop with an action", () => {
    for (const stop of TOUR_STOPS) {
      if (stop.site === "landing") continue;
      expect(
        stop.action !== undefined || stop.ctaLabel !== undefined,
        `${stop.id} leaves the visitor stranded`,
      ).toBe(true);
    }
  });

  it("numbers the overlay stops and skips the landing bookends", () => {
    expect(tourProgress("create")).toEqual({ index: 1, total: 12 });
    expect(tourProgress("finale")).toEqual({ index: 12, total: 12 });
    expect(tourProgress("start")).toBeNull();
    expect(tourProgress("stamped")).toBeNull();
    expect(tourProgress("nope")).toBeNull();
  });

  it("walks the story in order", () => {
    expect(TOUR_STOPS.map((stop) => stop.id)).toEqual([
      "start",
      "create",
      "home",
      "issue",
      "offer",
      "credential",
      "shop",
      "present-shop",
      "shop-verified",
      "rentals",
      "present-rentals",
      "rentals-verified",
      "finale",
      "stamped",
    ]);
  });

  it("keeps the persona over 25 so both verifier gates pass", () => {
    const birth = new Date(`${TOUR_PERSONA.birthDate}T00:00:00Z`);
    const now = new Date();
    const cutoff = new Date(
      Date.UTC(now.getUTCFullYear() - 25, now.getUTCMonth(), now.getUTCDate()),
    );
    expect(birth.getTime()).toBeLessThanOrEqual(cutoff.getTime());
  });
});

describe("withTourParam", () => {
  it("appends to a bare URL", () => {
    expect(withTourParam("https://dmv.example/", "issue")).toBe(
      "https://dmv.example/?tour=issue",
    );
  });

  it("preserves an existing query string", () => {
    const url = withTourParam(
      "https://wallet.example/present?client_id=abc&nonce=n%2F1",
      "present-shop",
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("abc");
    expect(parsed.searchParams.get("nonce")).toBe("n/1");
    expect(parsed.searchParams.get("tour")).toBe("present-shop");
  });

  it("replaces an existing tour param instead of duplicating it", () => {
    const url = withTourParam("https://shop.example/?tour=shop", "shop-verified");
    expect(url.match(/tour=/g)).toHaveLength(1);
    expect(new URL(url).searchParams.get("tour")).toBe("shop-verified");
  });
});

describe("tourCtaHref", () => {
  it("links a CTA stop to the next stop's site, path, and param", () => {
    const home = tourStop("home");
    expect(home).not.toBeNull();
    expect(tourCtaHref(home!, { dmv: "https://dmv.example" })).toBe(
      "https://dmv.example/?tour=issue",
    );
  });

  it("lands the start CTA on the wallet's /welcome", () => {
    const start = tourStop("start");
    expect(tourCtaHref(start!, { wallet: "https://wallet.example" })).toBe(
      "https://wallet.example/welcome?tour=create",
    );
  });

  it("returns null when the destination origin is not configured", () => {
    const home = tourStop("home");
    expect(tourCtaHref(home!, {})).toBeNull();
    expect(tourCtaHref(home!, { dmv: null })).toBeNull();
  });
});
