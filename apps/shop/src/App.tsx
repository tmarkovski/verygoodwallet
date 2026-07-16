/**
 * The Nightcap — a late-night bottle shop that happens to be an OID4VP
 * verifier. The flagship verification flow of the VeryGoodWallet demo:
 * DCQL age query, Digital Credentials API attempt with an honest fallback,
 * direct_post response, and a result panel that shows exactly what the
 * verifier learned.
 */

import { useEffect, useMemo, useState } from "react";
import { TourOverlay, adoptTourFromUrl, advanceTourFrom } from "@vgw/tour";
import { AgeGate } from "./components/AgeGate";
import { Shelf } from "./components/Shelf";
import { rentalsOrigin } from "./rentalsOrigin";

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
    <div className="bulb-glow min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-baseline justify-between px-5 pt-8">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-accent">
            The Nightcap
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            Bottle shop · open 'til late
          </p>
        </div>
        <p
          className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
            verdict === "allowed" ? "neon" : "text-muted"
          }`}
          aria-live="polite"
        >
          {verdict === "allowed" ? "● 18+ verified" : "○ age unverified"}
        </p>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-5 pb-16 pt-10">
        <section className="animate-rise">
          <AgeGate
            resumeSessionId={resumeSessionId}
            onVerdict={(v) => {
              setVerdict(v);
              // Cross-device returns never carry the ?tour= param — the
              // verdict itself moves the tour along.
              if (v === "allowed") advanceTourFrom("shop");
            }}
          />
        </section>

        <div className="animate-fade">
          <Shelf unlocked={verdict === "allowed"} />
        </div>

        <footer className="border-t border-line pt-5 text-[12px] leading-relaxed text-muted">
          <p>
            The Nightcap is a fictional verifier in the{" "}
            <a
              href="https://verygoodwallet.com"
              className="text-ink-dim underline decoration-accent/60 underline-offset-2 hover:decoration-accent"
            >
              VeryGoodWallet
            </a>{" "}
            demo. It speaks OpenID for Verifiable Presentations (DCQL,{" "}
            <span className="font-mono">direct_post</span>) and verifies BBS
            selective-disclosure proofs issued by the{" "}
            <span className="font-mono">Utopia DMV</span>. Nothing here is for
            sale — except the idea that age checks don't need your name.
          </p>
        </footer>
      </main>

      <TourOverlay origins={{ rentals: rentalsOrigin() }} />
    </div>
  );
}
