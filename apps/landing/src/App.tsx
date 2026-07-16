/**
 * The cover of the demo: states the thesis, introduces the cast, and opens
 * the guided tour. With ?tour=stamped (the tour's final hop) it renders the
 * stamped visa page instead — the only place the whole journey exists.
 */

import { useEffect, useMemo } from "react";
import { TOUR_STOPS, exitTour, tourCtaHref } from "@vgw/tour";
import { SITE_ORIGINS, TOUR_ORIGINS } from "./origins";

const START_STOP = TOUR_STOPS[0]!;

function tourStartHref(): string | null {
  return tourCtaHref(START_STOP, TOUR_ORIGINS);
}

/** Passport crest: a key set in an engraved rosette ring. */
function Crest({ size = 88 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="48" cy="48" r="39" stroke="currentColor" strokeWidth="0.7" strokeDasharray="1.5 3" />
      <circle cx="48" cy="48" r="30" stroke="currentColor" strokeWidth="0.9" />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i * Math.PI) / 12;
        return (
          <line
            key={i}
            x1={48 + 30 * Math.cos(a)}
            y1={48 + 30 * Math.sin(a)}
            x2={48 + 39 * Math.cos(a + 0.09)}
            y2={48 + 39 * Math.sin(a + 0.09)}
            stroke="currentColor"
            strokeWidth="0.6"
          />
        );
      })}
      <circle cx="48" cy="41" r="10.5" stroke="currentColor" strokeWidth="2.4" />
      {/* Key shaft with two wards — teeth to one side so it reads as a key. */}
      <path
        d="M48 51.5v16M48 61h7M48 66.5h5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SectionTitle({ no, children }: { no: string; children: string }) {
  return (
    <div>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-stamp">
        Page {no}
      </p>
      <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">{children}</h2>
      <div className="mt-3 h-0.5 w-14 bg-foil" aria-hidden="true" />
    </div>
  );
}

function GuidedDemoBanner({ startHref }: { startHref: string | null }) {
  return (
    <section
      aria-labelledby="guided-demo-title"
      className="mx-auto max-w-5xl px-5 pt-10"
    >
      <div className="tour-promo overflow-hidden rounded-3xl border border-foil/35 bg-accent text-accent-contrast">
        <div className="tour-promo-art" aria-hidden="true">
          <img
            src="/guided-demo-banner.webp"
            alt=""
            width="2172"
            height="724"
            loading="lazy"
            decoding="async"
          />
          <div className="tour-promo-scrim" />
        </div>

        <div className="tour-promo-copy">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-foil">
            Guided demo · about 3 minutes
          </p>
          <h2
            id="guided-demo-title"
            className="mt-3 text-balance font-display text-3xl font-bold leading-tight tracking-tight"
          >
            Carry one credential through the whole story.
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-accent-contrast/80">
            Create a passkey wallet, collect a real BBS-signed license, prove
            your age without revealing your birthday, and inspect exactly what
            each verifier learns.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {startHref !== null ? (
              <a
                href={startHref}
                className="rounded-xl bg-canvas px-5 py-3 text-[12px] font-bold uppercase tracking-[0.09em] text-accent transition-opacity hover:opacity-90"
              >
                Start the guided demo
              </a>
            ) : (
              <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-accent-contrast">
                The wallet is unavailable in this build.
              </p>
            )}
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent-contrast/55">
              12 guided stops · runs in your browser
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const CAST: {
  name: string;
  role: string;
  line: string;
  href: string;
  band: string;
  bandText: string;
}[] = [
  {
    name: "VeryGoodWallet",
    role: "The wallet",
    line: "Lives at a URL, not in an app store. One passkey derives its vault key, its per-issuer identities, and one lifelong link secret no one ever sees.",
    href: SITE_ORIGINS.wallet,
    band: "#0c1f21",
    bandText: "#d4b264",
  },
  {
    name: "Utopia DMV",
    role: "The issuer",
    line: "Issues a BBS-signed driver's license over OID4VCI — and never learns where it gets used.",
    href: SITE_ORIGINS.dmv,
    band: "#1f6280",
    bandText: "#ffffff",
  },
  {
    name: "The Nightcap",
    role: "Verifier — wants one bit",
    line: "A bottle shop that asks a single question: 18 or over. The good answer is a zero-knowledge proof.",
    href: SITE_ORIGINS.shop,
    band: "#171310",
    bandText: "#e8a13d",
  },
  {
    name: "Utopia Wheels",
    role: "Verifier — wants a name",
    line: "A rental counter that needs your name, license number, and over-25 — same credential, same sealed birthdate, different cutoff.",
    href: SITE_ORIGINS.rentals,
    band: "#00694f",
    bandText: "#f2efe4",
  },
];

const STAMPS: { name: string; line: string; ink: string; tilt: string }[] = [
  {
    name: "VeryGoodWallet",
    line: "Passkey created · keys derived",
    ink: "var(--pp-stamp)",
    tilt: "-5deg",
  },
  {
    name: "Utopia DMV",
    line: "License issued · never saw it used",
    ink: "var(--pp-ok)",
    tilt: "3deg",
  },
  {
    name: "The Nightcap",
    line: "Learned: over 18 — nothing else",
    ink: "var(--pp-crimson)",
    tilt: "-2deg",
  },
  {
    name: "Utopia Wheels",
    line: "Learned: name, license №, over 25",
    ink: "var(--pp-accent)",
    tilt: "4deg",
  },
];

function StampedPage() {
  const startHref = tourStartHref();
  return (
    <main className="mx-auto max-w-3xl px-5 py-14 animate-rise">
      <div className="relative overflow-hidden rounded-3xl border border-line-strong bg-surface p-8 sm:p-12">
        <div
          aria-hidden="true"
          className="guilloche pointer-events-none absolute -right-24 -top-24 size-96 text-stamp opacity-[0.1]"
        />
        <div
          aria-hidden="true"
          className="guilloche pointer-events-none absolute -bottom-28 -left-28 size-96 text-crimson opacity-[0.08]"
        />
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-stamp">
          Tour complete
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
          Passport, stamped.
        </h1>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {STAMPS.map((stamp) => (
            <div
              key={stamp.name}
              className="stamp"
              style={{ color: stamp.ink, transform: `rotate(${stamp.tilt})` }}
            >
              <p className="text-[13px] font-bold tracking-[0.18em]">{stamp.name}</p>
              <p className="mt-1 text-[10.5px] tracking-[0.1em]">{stamp.line}</p>
              <p className="mt-2 border-t border-current pt-1.5 font-mono text-[9px] tracking-[0.2em] opacity-80">
                State of Utopia · admitted
              </p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-[15px] leading-relaxed text-ink-dim">
          Four stamps, two verifiers. Neither site saw an identifier of any
          kind — no key, no DID — and every proof, the age proofs included,
          was a fresh re-randomized derivation. The cryptography gives them
          nothing to join. What could join them is only what you chose to
          disclose, and your name and license number went to the rental
          counter alone; your wallet's exhibit draws that line exactly. This
          page, in your wallet's company, is the only place the whole journey
          exists.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/writeup/"
            className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-contrast transition-opacity hover:opacity-90"
          >
            Read how it works
          </a>
          {startHref !== null && (
            <a
              href={startHref}
              className="rounded-xl border border-line-strong px-5 py-3 text-sm text-ink-dim transition-colors hover:border-ink"
            >
              Run the tour again
            </a>
          )}
          <a
            href="/"
            className="inline-flex items-center px-2 text-sm text-ink underline decoration-stamp/60 underline-offset-2 hover:decoration-stamp"
          >
            Back to the cover
          </a>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const stamped = useMemo(
    () => new URLSearchParams(window.location.search).get("tour") === "stamped",
    [],
  );

  // The finale is the tour's last hop: render it, then retire the tour state
  // (and the URL param) so a reload shows a clean, still-stamped page.
  useEffect(() => {
    if (stamped) exitTour();
  }, [stamped]);

  if (stamped) return <StampedPage />;

  const startHref = tourStartHref();

  return (
    <>
      {/* ——— The cover ——— */}
      <header className="foil-frame relative flex min-h-[92dvh] flex-col items-center justify-center bg-accent px-6 py-20 text-center text-accent-contrast">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-foil">
          State of Utopia · demonstration passport
        </p>
        <div className="mt-8 text-foil">
          <Crest />
        </div>
        <h1 className="mt-8 font-display text-[13px] font-bold uppercase tracking-[0.42em] text-foil">
          VeryGoodWallet
        </h1>
        <p className="mt-6 max-w-xl text-balance font-display text-4xl font-bold leading-[1.15] tracking-tight sm:text-5xl">
          Your passkey <em>is</em> the wallet.
        </p>
        <p className="mt-5 max-w-lg text-pretty text-[15px] leading-relaxed text-accent-contrast/80">
          A working demo of passkey-native identity — no seed phrase, no
          extension, no custodian. A driver's license you hold, an age you can
          prove without a birthday, and two verifiers that cannot link you.
          Everything below is real and running.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          {startHref !== null && (
            <a
              href={startHref}
              className="rounded-xl bg-canvas px-6 py-3.5 text-sm font-bold uppercase tracking-[0.08em] text-accent transition-opacity hover:opacity-90"
            >
              Take the guided tour
            </a>
          )}
          <a
            href="/writeup/"
            className="rounded-xl border border-foil/60 px-6 py-3.5 text-sm text-accent-contrast transition-colors hover:border-foil"
          >
            Read how it works
          </a>
        </div>
        <p
          aria-hidden="true"
          className="absolute bottom-6 font-mono text-[10px] uppercase tracking-[0.3em] text-accent-contrast/50"
        >
          ▾ open the passport
        </p>
      </header>

      <GuidedDemoBanner startHref={startHref} />

      <main className="mx-auto max-w-3xl px-5 pb-20">
        {/* ——— Page 01 · the idea ——— */}
        <section className="relative pt-16">
          <div
            aria-hidden="true"
            className="guilloche pointer-events-none absolute -right-40 top-8 -z-10 size-[26rem] text-stamp opacity-[0.07]"
          />
          <SectionTitle no="01">The idea</SectionTitle>
          <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-ink-dim">
            <p>
              Every wallet begins with a secret, and most begin by making that
              secret your problem — a seed phrase to write down, an app to
              install, a custodian to trust. This demo starts from a different
              premise: you already carry a synced, hardware-backed,
              phishing-resistant secret. It's called a passkey.
            </p>
            <p>
              WebAuthn's PRF extension lets a web page ask your passkey for a
              deterministic secret at every unlock. Feed that through HKDF and
              the entire wallet falls out: the key that encrypts your
              credentials at rest, a fresh identity for every issuer, and one
              lifelong link secret that is blind-committed into every
              credential without any issuer ever seeing it. Nothing to back
              up — passkey sync is the recovery story.
            </p>
            <p>
              The credentials are BBS signatures (the credkit cryptosuite),
              so every presentation discloses exactly the claims you pick and
              is cryptographically unlinkable from the last. And the birthdate
              never travels at all: the license seals it as a hidden numeric
              twin, and a range proof shows "over 18" or "over 25" — any
              cutoff, live, verified entirely on the verifier's server —
              without ever revealing the date or leaving anything two
              verifiers could match.
            </p>
          </div>
          <p className="mt-6 rounded-xl bg-accent-soft px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">
            passkey → PRF → HKDF → {"{"} vault key · link secret · issuance keys {"}"}
          </p>
        </section>

        {/* ——— Page 02 · the cast ——— */}
        <section className="pt-16">
          <SectionTitle no="02">The cast</SectionTitle>
          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            {CAST.map((site) => (
              <a
                key={site.name}
                href={site.href}
                className="group overflow-hidden rounded-2xl border border-line bg-raised transition-transform duration-150 hover:-translate-y-0.5 hover:border-line-strong"
              >
                <div
                  className="flex items-baseline justify-between px-5 py-3"
                  style={{ backgroundColor: site.band, color: site.bandText }}
                >
                  <span className="font-display text-[15px] font-bold tracking-tight">
                    {site.name}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] opacity-80">
                    visit ↗
                  </span>
                </div>
                <div className="px-5 py-4">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                    {site.role}
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{site.line}</p>
                </div>
              </a>
            ))}
          </div>
          <p className="mt-5 text-[12.5px] leading-relaxed text-muted">
            Four sites, four operators in the story, four deliberately
            different brands — because unlinkability only means something
            between parties that don't share a database.
          </p>
        </section>

        {/* ——— Page 03 · the tour ——— */}
        <section className="pt-16">
          <SectionTitle no="03">The tour</SectionTitle>
          <div className="mt-7 rounded-3xl border border-line bg-surface p-7">
            <p className="text-[15px] leading-relaxed text-ink-dim">
              Twelve stops, about three minutes, nothing simulated. You'll
              create a real passkey, be issued a real BBS-signed license,
              prove your age in zero knowledge at a bottle shop, hand a rental
              counter exactly three answers, and end at the exhibit showing
              why the two can never compare notes. A narrator card follows you
              across all four sites.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {startHref !== null ? (
                <a
                  href={startHref}
                  className="rounded-xl bg-accent px-6 py-3.5 text-sm font-bold uppercase tracking-[0.08em] text-accent-contrast transition-opacity hover:opacity-90"
                >
                  Begin at the wallet
                </a>
              ) : (
                <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                  No wallet origin is configured for this build (VITE_WALLET_ORIGIN).
                </p>
              )}
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Needs a passkey-capable browser
              </p>
            </div>
          </div>
          <div className="mt-5 rounded-3xl border border-dashed border-line-strong p-7">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              Prefer to watch
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">
              A filmed run-through of the whole flow lands here with the move
              to custom domains — until then, the tour above is the real
              thing.
            </p>
          </div>
        </section>

        {/* ——— Page 04 · the writeup ——— */}
        <section className="pt-16">
          <SectionTitle no="04">The writeup</SectionTitle>
          <a
            href="/writeup/"
            className="mt-7 block rounded-3xl border border-line bg-raised p-7 transition-transform duration-150 hover:-translate-y-0.5 hover:border-line-strong"
          >
            <h3 className="font-display text-xl font-bold tracking-tight">
              How the first build worked — and what fought back
            </h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Field notes from the pre-credkit build. Its two honest
              compromises — a matchable birthdate commitment and a ZK
              verifier the server couldn't run — are exactly what the credkit
              migration has since removed; the demo you just toured is the
              upgraded stack.
            </p>
            <ul className="mt-4 space-y-2 text-[13.5px] leading-relaxed text-ink-dim">
              <li>
                · Why BBS proofs structurally leak embedded identifiers, and
                what the issuer stopped embedding because of it
              </li>
              <li>
                · Why Cloudflare Workers couldn't run that build's ZK
                verifier, and the honest split that resulted
              </li>
              <li>
                · Why "shared boolean = correlation" was a bug: one bit
                identifies nobody
              </li>
            </ul>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-stamp">
              Read the full writeup →
            </p>
          </a>
        </section>
      </main>

      <footer className="border-t border-line py-8">
        <p className="mx-auto max-w-3xl px-5 text-center text-[11.5px] leading-relaxed text-muted">
          VeryGoodWallet is a portfolio demonstration by Tomislav Markovski.
          The State of Utopia, its DMV, The Nightcap, and Utopia Wheels are
          fictional; the cryptography is not. Source on{" "}
          <a
            href="https://github.com/tmarkovski/verygoodwallet"
            className="text-ink-dim underline decoration-stamp/60 underline-offset-2 hover:decoration-stamp"
          >
            GitHub
          </a>
          .
        </p>
      </footer>
    </>
  );
}
