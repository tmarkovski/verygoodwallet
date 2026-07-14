/**
 * The narrator: a passport-styled card, fixed to the corner of whichever
 * site the tour is visiting. Deliberately NOT the host's brand — the same
 * navy/cream voice follows the visitor across all four apps, which is the
 * point: the narrator travels with you; your identity doesn't.
 *
 * Styling is inline and self-contained so the overlay renders identically
 * under four different Tailwind themes without importing any of them.
 */

import { useSyncExternalStore, type CSSProperties } from "react";
import {
  tourCtaHref,
  tourProgress,
  tourStop,
  type TourOrigins,
  type TourStop,
} from "./script";
import { currentTourStopId, exitTour, subscribeTour } from "./state";

/** The active stop on this origin, kept in sync with sessionStorage. */
export function useTourStop(): TourStop | null {
  const id = useSyncExternalStore(subscribeTour, currentTourStopId, () => null);
  return id !== null ? tourStop(id) : null;
}

const NAVY = "#1c2742";
const CREAM = "#f3ecd9";
const FOIL = "#c9a86a";
const STAMP = "#8d76c4";

const styles: Record<string, CSSProperties> = {
  card: {
    position: "fixed",
    right: 16,
    bottom: 16,
    zIndex: 9999,
    width: "min(340px, calc(100vw - 32px))",
    background: NAVY,
    color: CREAM,
    border: `1px solid rgba(243, 236, 217, 0.28)`,
    borderRadius: 14,
    boxShadow:
      "inset 0 0 0 3px #1c2742, inset 0 0 0 4px rgba(201, 168, 106, 0.55), 0 12px 40px rgba(0, 0, 0, 0.45)",
    padding: "18px 18px 16px",
    fontFamily: "Georgia, 'Times New Roman', serif",
    lineHeight: 1.55,
  },
  eyebrow: {
    margin: 0,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: FOIL,
  },
  title: {
    margin: "8px 24px 0 0",
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: "-0.01em",
  },
  body: {
    margin: "8px 0 0",
    fontSize: 13,
    color: "rgba(243, 236, 217, 0.82)",
  },
  action: {
    margin: "12px 0 0",
    padding: "2px 0 2px 10px",
    borderLeft: `3px solid ${STAMP}`,
    fontSize: 13,
    fontStyle: "italic",
    color: CREAM,
  },
  cta: {
    display: "block",
    marginTop: 14,
    padding: "10px 14px",
    background: CREAM,
    color: NAVY,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    textDecoration: "none",
    textAlign: "center",
  },
  exit: {
    position: "absolute",
    top: 10,
    right: 12,
    padding: 4,
    background: "none",
    border: "none",
    color: "rgba(243, 236, 217, 0.55)",
    fontSize: 14,
    lineHeight: 1,
    cursor: "pointer",
  },
};

export function TourOverlay({ origins }: { origins: TourOrigins }) {
  const stop = useTourStop();
  // Landing stops are bookends the landing page renders natively.
  if (stop === null || stop.site === "landing") return null;

  const progress = tourProgress(stop.id);
  const href = stop.ctaLabel !== undefined ? tourCtaHref(stop, origins) : null;

  return (
    <aside role="complementary" aria-label="Guided tour" style={styles.card}>
      <button
        type="button"
        onClick={exitTour}
        aria-label="End the tour"
        title="End the tour"
        style={styles.exit}
      >
        ✕
      </button>
      <p style={styles.eyebrow}>
        Guided tour{progress !== null ? ` · ${progress.index} of ${progress.total}` : ""}
      </p>
      <h2 style={styles.title}>{stop.title}</h2>
      {stop.body.map((paragraph, i) => (
        <p key={i} style={styles.body}>
          {paragraph}
        </p>
      ))}
      {stop.action !== undefined && <p style={styles.action}>{stop.action}</p>}
      {stop.ctaLabel !== undefined &&
        (href !== null ? (
          <a href={href} style={styles.cta}>
            {stop.ctaLabel} →
          </a>
        ) : (
          <p style={{ ...styles.body, fontStyle: "italic" }}>
            ({stop.ctaLabel} — destination origin not configured on this build.)
          </p>
        ))}
    </aside>
  );
}
