/**
 * The guided tour's script — one ordered list of stops across the five
 * sites, walked by carrying a `?tour=<stop id>` param over the demo's
 * existing cross-origin links. The URL is the only cross-origin state;
 * within an origin the current stop lives in sessionStorage (state.ts).
 *
 * This package is demo chrome only: nothing here touches the wire
 * protocols, and the Workers never read the param.
 */

export type TourSite = "landing" | "wallet" | "dmv" | "shop" | "rentals";

/** Origins for CTA links, provided by the host app (Vite env / dev defaults). */
export type TourOrigins = Partial<Record<TourSite, string | null>>;

export interface TourStop {
  /** Stable id — the value carried by the `?tour=` URL param. */
  id: string;
  site: TourSite;
  /** Path on `site` where this stop takes place (where CTA links land). */
  path?: string;
  title: string;
  body: string[];
  /** What the visitor does next using the page's own controls. */
  action?: string;
  /**
   * Label for a narrator-rendered link to the next stop — used only where
   * the hop is one the page has no control of its own for.
   */
  ctaLabel?: string;
}

export const TOUR_PARAM = "tour";

/**
 * The form persona the DMV counter prefills during the tour. Born over 25
 * years before any plausible demo date, so both verifier gates (18+, 25+)
 * pass. No document number — the DMV auto-assigns a valid one.
 */
export const TOUR_PERSONA = {
  givenName: "Avery",
  familyName: "Fontaine",
  birthDate: "1993-03-14",
} as const;

export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: "start",
    site: "landing",
    title: "The ninety-second version",
    body: ["Five sites, one passkey, no simulation."],
    ctaLabel: "Create your wallet",
  },
  {
    id: "create",
    site: "wallet",
    path: "/welcome",
    title: "The entire signup",
    body: [
      "No seed phrase, no account, no download. You're about to create one passkey — and its PRF secret will derive everything that follows: the vault key, a fresh identity per issuer, a fresh identity per verifier.",
    ],
    action:
      "Name your wallet and create the passkey — you'll confirm twice, once to create it, once to unlock. Already have one on this device? Unlock it instead; the tour follows either way.",
  },
  {
    id: "home",
    site: "wallet",
    path: "/",
    title: "A wallet with nothing in it",
    body: [
      "This is the whole wallet, reproducible from that passkey alone. The ⟨ ⟩ button in the header opens the inspector — a key-derivation tree grows there live as you use the demo.",
      "Time to put something in it. The State of Utopia's DMV issues driver's licenses over OID4VCI.",
    ],
    ctaLabel: "Visit the Utopia DMV",
  },
  {
    id: "issue",
    site: "dmv",
    path: "/",
    title: "A friendly clerk",
    body: [
      "The DMV is the issuer. The counter form is already filled with your tour persona — Avery Fontaine, comfortably over 25. That number will matter later.",
      "Issuing creates a pre-authorized credential offer. Note what the DMV never does: it doesn't talk to your wallet, and it will never learn where the license gets used.",
    ],
    action: "Press “Issue driver's license”, then follow “Open in VeryGoodWallet”.",
  },
  {
    id: "offer",
    site: "wallet",
    path: "/offer",
    title: "Collecting the license",
    body: [
      "The wallet redeems the offer's one-time code, proves possession of a key derived only for this issuer, and verifies the DMV's BBS signature before storing anything.",
      "One deliberate absence: no holder identifier inside the credential. BBS proofs structurally reveal embedded ids, so leaving it out is what keeps your presentations unlinkable later.",
    ],
    action: "Press “Add to wallet”.",
  },
  {
    id: "credential",
    site: "wallet",
    title: "What you're actually holding",
    body: [
      "Every claim sits under one BBS signature and can be disclosed or withheld per presentation.",
      "The odd one out is the birthdate commitment — not the date itself, but a Poseidon envelope sealed around it. The zero-knowledge tier proves statements about what's inside without opening it.",
    ],
    ctaLabel: "Go somewhere age-gated — The Nightcap",
  },
  {
    id: "shop",
    site: "shop",
    path: "/",
    title: "One bit of information",
    body: [
      "The Nightcap needs to know exactly one thing: 18 or over. Watch its request — it will accept an age flag, or a birth date, or, best of all, just the sealed commitment plus a proof.",
    ],
    action: "Press “Verify with VeryGoodWallet”, then follow the link to your wallet.",
  },
  {
    id: "present-shop",
    site: "wallet",
    title: "The tier that matters",
    body: [
      "Pick tier 2 — prove the age, never the date. The wallet derives a presenter identity that exists only for this shop, a BBS proof that discloses nothing but the commitment, and a zero-knowledge proof that the sealed date clears today's 18+ cutoff.",
      "Proving runs in this tab. The few seconds are real cryptography, not a spinner.",
    ],
    action: "Choose tier 2, press Share, then return to the shop.",
  },
  {
    id: "shop-verified",
    site: "shop",
    title: "What the shop learned",
    body: [
      "One proven bit: over 18. No name, no birthday, no document number.",
      "Scroll the result panels: the presenter identity shown is pairwise — no other site will ever see it — and your own browser verified the proof (the exhibit explains why the server can't).",
    ],
    ctaLabel: "Now rent a car — Utopia Wheels",
  },
  {
    id: "rentals",
    site: "rentals",
    path: "/",
    title: "A different appetite",
    body: [
      "A rental counter can't serve anonymous customers. Utopia Wheels asks for your name, your license number, and over-25.",
      "Same license, same sealed commitment — only the cutoff changed. One commitment can answer any age policy.",
    ],
    action: "Press “Verify with VeryGoodWallet”, then follow the link to your wallet.",
  },
  {
    id: "present-rentals",
    site: "wallet",
    title: "Same seal, different question",
    body: [
      "Read the request: the identity claims ride alongside the same commitment, and the predicate now says 25, not 18.",
      "The presenter identity is derived fresh for the rental counter. The one the shop saw never appears here.",
    ],
    action: "Tier 2 again — Share, then return to Utopia Wheels.",
  },
  {
    id: "rentals-verified",
    site: "rentals",
    title: "Cleared for pickup",
    body: [
      "The counter got a name and a license number — that's the rental business — plus one proven bit: over 25.",
      "And the identity that signed all of it is not the one the shop saw. Time for the punchline.",
    ],
    ctaLabel: "See what they could compare — back to your wallet",
  },
  {
    id: "finale",
    site: "wallet",
    path: "/",
    title: "The exhibit",
    body: [
      "“Across verifiers”, below your credential, shows both visits exactly as each verifier recorded them: two presenter identities the cryptography can never join, and proofs derived fresh each time.",
      "And one honest catch: you took the ZK tier at both counters, so both saw the same birthdate commitment — the seal never opens, but the seal itself is a value they could match. Your name went only to the rental counter. The exhibit draws the exact line between what could be joined and what never can.",
    ],
    ctaLabel: "Collect your stamps",
  },
  {
    id: "stamped",
    site: "landing",
    path: "/",
    title: "Passport, stamped",
    body: [
      "Four sites visited, one passkey — and an exhibit that tells the truth about what could follow you.",
    ],
  },
];

const BY_ID = new Map(TOUR_STOPS.map((stop) => [stop.id, stop]));

export function tourStop(id: string): TourStop | null {
  return BY_ID.get(id) ?? null;
}

export function nextTourStop(id: string): TourStop | null {
  const index = TOUR_STOPS.findIndex((stop) => stop.id === id);
  if (index === -1) return null;
  return TOUR_STOPS[index + 1] ?? null;
}

/**
 * Position of an overlay stop within the numbered walk. Landing stops are
 * bookends rendered by the landing page itself — they carry no number.
 */
export function tourProgress(id: string): { index: number; total: number } | null {
  const numbered = TOUR_STOPS.filter((stop) => stop.site !== "landing");
  const index = numbered.findIndex((stop) => stop.id === id);
  if (index === -1) return null;
  return { index: index + 1, total: numbered.length };
}

/** Append (or replace) the tour param on an absolute URL. */
export function withTourParam(url: string, stopId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(TOUR_PARAM, stopId);
  return parsed.toString();
}

/**
 * The href for a stop's narrator CTA: the next stop's site + path, carrying
 * the param that makes the destination pick the tour up. Null when the host
 * has no origin configured for the destination.
 */
export function tourCtaHref(stop: TourStop, origins: TourOrigins): string | null {
  const next = nextTourStop(stop.id);
  if (next === null) return null;
  const origin = origins[next.site];
  if (origin === undefined || origin === null || origin === "") return null;
  return withTourParam(new URL(next.path ?? "/", origin).toString(), next.id);
}
