/**
 * Utopia Wheels — a car-rental counter that happens to be an OID4VP
 * verifier. The demo's second verifier (M5): a different disclosure profile
 * (name + license number + over-25) on the same rails as the shop, plus the
 * cross-verifier exhibit — what could and could not link this visit to the
 * one at The Nightcap.
 */

import { useEffect, useMemo, useState } from "react";
import { TourOverlay, adoptTourFromUrl, advanceTourFrom } from "@vgw/tour";
import { RentalGate } from "./components/RentalGate";
import { Fleet } from "./components/Fleet";
import { clientWalletOrigin } from "./walletOrigin";

/** Interstate-style route shield, the brand mark. */
function RouteShield() {
  return (
    <svg viewBox="0 0 44 48" className="h-11 w-auto" aria-hidden="true">
      <path
        d="M22 2l18 6v14c0 12-7.5 20.5-18 24C11.5 42.5 4 34 4 22V8z"
        fill="#00694f"
      />
      <path
        d="M22 5.4l14.8 4.9V22c0 10-6 17-14.8 20.2C13.2 39 7.2 32 7.2 22V10.3z"
        fill="none"
        stroke="#f2efe4"
        strokeWidth="1.6"
      />
      <text
        x="22"
        y="27.5"
        textAnchor="middle"
        fill="#f2efe4"
        fontFamily="Avenir Next Condensed, Arial Narrow, sans-serif"
        fontSize="14"
        fontWeight="700"
        letterSpacing="0.5"
      >
        UW
      </text>
    </svg>
  );
}

export default function App() {
  // ?session= means we came back from a same-device wallet redirect (or a
  // refresh mid-verification): resume polling that session instead of
  // showing the CTA again.
  const resumeSessionId = useMemo(
    () => new URLSearchParams(window.location.search).get("session"),
    [],
  );
  const [verdict, setVerdict] = useState<"allowed" | "denied" | null>(null);

  // Guided tour: adopt the ?tour= param. (The pre-N3 in-browser verifier
  // warm-up is gone: verification runs entirely on the Worker now — there is
  // no client WASM to warm.)
  useEffect(() => {
    adoptTourFromUrl();
  }, []);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 pt-8">
        <div className="flex items-center gap-3">
          <RouteShield />
          <div>
            <h1 className="font-display text-3xl font-bold uppercase tracking-[0.04em] text-accent">
              Utopia Wheels
            </h1>
            <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
              Car rental · every road in Utopia
            </p>
          </div>
        </div>
        <p aria-live="polite">
          {verdict === "allowed" ? (
            <span className="mile-chip">driver verified</span>
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              ○ counter waiting
            </span>
          )}
        </p>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-5 pb-16 pt-8">
        <div className="center-line" aria-hidden="true" />

        <section className="animate-rise">
          <RentalGate
            resumeSessionId={resumeSessionId}
            onVerdict={(v) => {
              setVerdict(v);
              // Cross-device returns never carry the ?tour= param — the
              // verdict itself moves the tour along.
              if (v === "allowed") advanceTourFrom("rentals");
            }}
          />
        </section>

        <div className="animate-fade">
          <Fleet unlocked={verdict === "allowed"} />
        </div>

        <footer className="border-t border-line pt-5 text-[12px] leading-relaxed text-muted">
          <p>
            Utopia Wheels is a fictional verifier in the{" "}
            <a
              href="https://verygoodwallet.com"
              className="text-ink-dim underline decoration-accent/60 underline-offset-2 hover:decoration-accent"
            >
              VeryGoodWallet
            </a>{" "}
            demo. It speaks OpenID for Verifiable Presentations (DCQL,{" "}
            <span className="font-mono">direct_post</span>) and verifies BBS
            selective-disclosure proofs issued by the{" "}
            <span className="font-mono">Utopia DMV</span>. It asks for more than
            the bottle shop does — a rental agreement needs a name — and that
            contrast is the exhibit: each verifier gets its own answer, and
            nothing lets the two compare notes.
          </p>
        </footer>
      </main>

      <TourOverlay origins={{ wallet: clientWalletOrigin() }} />
    </div>
  );
}
