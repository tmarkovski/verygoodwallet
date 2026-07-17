/**
 * The cover of the demo: states the thesis, introduces the cast, and opens
 * the guided tour. With ?tour=stamped (the tour's final hop) it renders the
 * stamped visa page instead — the only place the whole journey exists.
 */

import { useEffect, useMemo, type CSSProperties } from "react";
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
      <p className="font-label text-[11px] font-semibold uppercase tracking-[0.24em] text-stamp">
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
      className="passport-page foil-frame tour-promo flex flex-col bg-accent text-accent-contrast"
    >
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

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 items-center px-6 py-20 sm:px-10">
        <div className="tour-promo-copy">
          <p className="font-label text-[10px] font-semibold uppercase tracking-[0.24em] text-foil">
            Guided demo · about 3 minutes
          </p>
          <h2
            id="guided-demo-title"
            className="mt-3 text-balance font-display text-4xl font-bold leading-[1.12] tracking-tight sm:text-5xl"
          >
            Follow one credential from the DMV to both verifiers.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-accent-contrast/80">
            Create a passkey wallet, pick up a real BBS-signed license, use it
            to prove your age without sharing your birthday, and see exactly
            what each verifier learns.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {startHref !== null ? (
              <a
                href={startHref}
                className="rounded-xl bg-canvas px-6 py-3.5 font-label text-[12px] font-bold uppercase tracking-[0.09em] text-accent transition-opacity hover:opacity-90"
              >
                Start the guided demo
              </a>
            ) : (
              <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-accent-contrast">
                The wallet is unavailable in this build.
              </p>
            )}
            <p className="font-label text-[10px] uppercase tracking-[0.14em] text-accent-contrast/60">
              12 guided stops · runs in your browser
            </p>
          </div>
        </div>
      </div>

      <footer className="relative z-10 border-t border-foil/25 py-8">
        <p className="mx-auto max-w-3xl px-5 text-center text-[11.5px] leading-relaxed text-accent-contrast/70">
          VeryGoodWallet is a portfolio demonstration by Tomislav Markovski.
          The State of Utopia, its DMV, The Nightcap, and Utopia Wheels are
          fictional; the cryptography is not. Source on{" "}
          <a
            href="https://github.com/tmarkovski/verygoodwallet"
            className="text-foil underline decoration-foil/60 underline-offset-2 hover:decoration-foil"
          >
            GitHub
          </a>.
        </p>
      </footer>
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
    line: "Lives at a URL, not in an app store. Your passkey derives its vault key, an issuance key for each issuer, and a link secret that stays hidden.",
    href: SITE_ORIGINS.wallet,
    band: "#0c1f21",
    bandText: "#d4b264",
  },
  {
    name: "Utopia DMV",
    role: "The issuer",
    line: "Issues a BBS-signed driver's license through OID4VCI, then has no part in where you use it.",
    href: SITE_ORIGINS.dmv,
    band: "#1f6280",
    bandText: "#ffffff",
  },
  {
    name: "The Nightcap",
    role: "Verifier — wants one bit",
    line: "A bottle shop that asks one question: are you 18 or over? It gets a zero-knowledge proof instead of your birthday.",
    href: SITE_ORIGINS.shop,
    band: "#171310",
    bandText: "#e8a13d",
  },
  {
    name: "Utopia Wheels",
    role: "Verifier — wants a name",
    line: "A rental counter that needs your name, license number, and proof that you're over 25. The birth date still stays hidden.",
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
        <p className="font-label text-[11px] font-semibold uppercase tracking-[0.24em] text-stamp">
          Tour complete
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
          Passport, stamped.
        </h1>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {STAMPS.map((stamp, index) => (
            <div
              key={stamp.name}
              className="stamp stamp-enter"
              style={
                {
                  color: stamp.ink,
                  "--stamp-tilt": stamp.tilt,
                  "--stamp-delay": `${300 + index * 220}ms`,
                } as CSSProperties
              }
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
          Four stamps, two verifiers. Neither presentation included a holder
          key or DID, and every proof was freshly randomized. The proofs
          themselves give the two sites nothing they can match. Only claims
          shared with both could overlap, and your name and license number went
          to the rental counter alone. Your wallet's final comparison shows
          exactly what each site received.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/writeup/"
            className="rounded-xl bg-accent px-5 py-3 font-label text-sm font-semibold text-accent-contrast transition-opacity hover:opacity-90"
          >
            Read how it works
          </a>
          {startHref !== null && (
            <a
              href={startHref}
              className="rounded-xl border border-line-strong px-5 py-3 font-label text-sm text-ink-dim transition-colors hover:border-ink"
            >
              Run the tour again
            </a>
          )}
          <a
            href="/"
            className="inline-flex items-center px-2 font-label text-sm text-ink underline decoration-stamp/60 underline-offset-2 hover:decoration-stamp"
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
    <div className="passport-scroll">
      {/* ——— The cover ——— */}
      <header className="passport-page foil-frame relative flex flex-col items-center justify-center bg-accent px-6 py-20 text-center text-accent-contrast">
        <p className="font-label text-[11px] font-semibold uppercase tracking-[0.3em] text-foil">
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
          A working demo of passkey-native identity, with no seed phrase,
          browser extension, or custodian. You hold the driver's license, prove
          your age without sharing your birthday, and decide what each verifier
          receives. Everything below is real and running.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          {startHref !== null && (
            <a
              href={startHref}
              className="rounded-xl bg-canvas px-6 py-3.5 font-label text-sm font-bold uppercase tracking-[0.08em] text-accent transition-opacity hover:opacity-90"
            >
              Take the guided tour
            </a>
          )}
          <a
            href="/writeup/"
            className="rounded-xl border border-foil/60 px-6 py-3.5 font-label text-sm text-accent-contrast transition-colors hover:border-foil"
          >
            Read how it works
          </a>
        </div>
        <p
          aria-hidden="true"
          className="absolute bottom-6 font-label text-[10px] uppercase tracking-[0.3em] text-accent-contrast/55"
        >
          ▾ open the passport
        </p>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5">
        {/* ——— Page 01 · the idea ——— */}
        <section className="passport-page passport-content-page relative">
          <div
            aria-hidden="true"
            className="guilloche pointer-events-none absolute -right-40 top-8 -z-10 size-[26rem] text-stamp opacity-[0.07]"
          />
          <SectionTitle no="01">The idea</SectionTitle>
          <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-ink-dim">
            <p>
              An identity wallet needs a secret. Most ask you to write down a
              seed phrase, install an app, or trust a custodian. This demo uses
              something you may already have: a synced, hardware-backed,
              phishing-resistant passkey.
            </p>
            <p>
              WebAuthn's PRF extension lets the wallet get the same secret from
              your passkey whenever you unlock it. The wallet feeds that secret
              through HKDF to derive the key that encrypts your credentials, an
              issuance key for each issuer, and one link secret that is
              committed to every credential without being revealed. You don't
              back up those keys separately; passkey sync lets the wallet
              derive them again.
            </p>
            <p>
              The DMV signs credentials with BBS through the credkit
              cryptosuite. Each time you present one, you choose which claims
              to reveal, and the proof is randomized so it can't be matched to
              an earlier presentation. The license also contains a hidden
              numeric version of the birth date. A range proof can show that
              you're over 18 or over 25 without revealing the date, and the
              verifier checks that proof on its server.
            </p>
          </div>
          <p className="mt-6 rounded-xl bg-accent-soft px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">
            passkey → PRF → HKDF → {"{"} vault key · link secret · issuance keys {"}"}
          </p>
        </section>

        {/* ——— Page 02 · the cast ——— */}
        <section className="passport-page passport-content-page">
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
                  <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-80">
                    visit ↗
                  </span>
                </div>
                <div className="px-5 py-4">
                  <p className="font-label text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                    {site.role}
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{site.line}</p>
                </div>
              </a>
            ))}
          </div>
          <p className="mt-5 text-[12.5px] leading-relaxed text-muted">
            Each site represents a separate party and keeps its own records.
            That separation is what makes unlinkability between the two
            verifiers meaningful.
          </p>
        </section>

        {/* ——— Page 03 · the tour ——— */}
        <section className="passport-page passport-content-page">
          <SectionTitle no="03">The tour</SectionTitle>
          <div className="mt-7 rounded-3xl border border-line bg-surface p-7">
            <p className="text-[15px] leading-relaxed text-ink-dim">
              The tour has twelve stops and takes about three minutes. You'll
              create a real passkey, receive a BBS-signed license, prove your
              age at a bottle shop without sharing your birthday, and give a
              rental counter exactly the three answers it asks for. At the end,
              you can compare what each verifier received. A narrator card
              guides you across all four sites.
            </p>
            <div className="mt-5 flex flex-col items-start gap-2">
              {startHref !== null ? (
                <a
                  href={startHref}
                  className="rounded-xl bg-accent px-6 py-3.5 font-label text-sm font-bold uppercase tracking-[0.08em] text-accent-contrast transition-opacity hover:opacity-90"
                >
                  Begin at the wallet
                </a>
              ) : (
                <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                  No wallet origin is configured for this build (VITE_WALLET_ORIGIN).
                </p>
              )}
              <p className="font-label text-[10px] uppercase tracking-[0.14em] text-muted">
                Needs a passkey-capable browser
              </p>
            </div>
          </div>
          <div className="mt-5 rounded-3xl border border-dashed border-line-strong p-7">
            <p className="font-label text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              Prefer to watch
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">
              A recorded walkthrough will go here when the demo moves to its
              custom domains. For now, you can try the live tour above.
            </p>
          </div>
        </section>

        {/* ——— Page 04 · the writeup ——— */}
        <section className="passport-page passport-content-page">
          <SectionTitle no="04">The writeup</SectionTitle>
          <a
            href="/writeup/"
            className="mt-7 block rounded-3xl border border-line bg-raised p-7 transition-transform duration-150 hover:-translate-y-0.5 hover:border-line-strong"
          >
            <h3 className="font-display text-xl font-bold tracking-tight">
              Verifiable credentials, BBS, and zero-knowledge proofs
            </h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              The longer explanation behind the demo. It starts with
              verifiable credentials, then works through BBS, range proofs,
              and holder binding. No zero-knowledge background needed. The
              implementation uses OID4VCI, OID4VP, and IETF BBS with an
              experimental Data Integrity cryptosuite.
            </p>
            <ul className="mt-4 space-y-2 text-[13.5px] leading-relaxed text-ink-dim">
              <li>
                · Why ordinary signatures make you share too much and allow
                presentations to be linked — and how BBS fixes both
              </li>
              <li>
                · How a range proof checks any age cutoff without revealing
                your birth date
              </li>
              <li>
                · How a blind link secret binds credentials to you while
                keeping separate presentations unlinkable
              </li>
            </ul>
            <p className="mt-4 font-label text-[10px] uppercase tracking-[0.2em] text-stamp">
              Read the full writeup →
            </p>
          </a>
        </section>
      </main>

      <GuidedDemoBanner startHref={startHref} />
    </div>
  );
}
