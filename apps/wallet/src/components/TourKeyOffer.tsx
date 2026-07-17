/**
 * The tour's "skip the repeat prompts" dialog.
 *
 * Shown once per tab, the first time the wallet is unlocked while a tour is
 * running: it offers to stash the master secret for the rest of the tour
 * (TTL-bounded) so cross-origin hops don't each cost a passkey prompt — with
 * an honest disclaimer that a production wallet would never do this. See
 * services/tourKey.ts for the stash's exact lifetime rules.
 */

import { useState } from "react";
import { useTourStop } from "@vgw/tour";
import { useSession } from "../session";
import {
  TOUR_KEY_TTL_MS,
  declineTourKey,
  tourKeyDeclined,
} from "../services/tourKey";
import { Button } from "./ui";

export function TourKeyOffer() {
  const { locked, tourKeyStashed, keepUnlockedForTour } = useSession();
  const stop = useTourStop();
  const [declined, setDeclined] = useState(tourKeyDeclined);

  if (locked || stop === null || tourKeyStashed || declined) return null;

  const minutes = Math.round(TOUR_KEY_TTL_MS / 60_000);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-key-title"
    >
      <div className="animate-rise w-full max-w-sm rounded-3xl border border-line bg-surface p-6 shadow-lg">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Tour convenience
        </p>
        <h2 id="tour-key-title" className="mt-2 text-base font-semibold">
          Skip the repeat passkey prompts?
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
          Every stop on the tour reloads the wallet, which locks it and asks
          for your passkey again. For the next {minutes} minutes, this demo
          can keep your key in this tab so the tour flows uninterrupted.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
          To be honest: a production wallet would never store key material
          this way — it lives in memory only. The stashed key is dropped when
          the tour ends, when you lock the wallet, or when the timer runs
          out.
        </p>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={keepUnlockedForTour}>
            Keep me unlocked
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              declineTourKey();
              setDeclined(true);
            }}
          >
            No thanks
          </Button>
        </div>
      </div>
    </div>
  );
}
