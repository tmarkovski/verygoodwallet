/**
 * The narrator: a passport-styled card, fixed to a corner of whichever
 * site the tour is visiting. Deliberately NOT the host's brand — the same
 * navy/cream voice follows the visitor across all four apps, which is the
 * point: the narrator travels with you; your identity doesn't.
 *
 * Styling is inline and self-contained so the overlay renders identically
 * under four different Tailwind themes without importing any of them.
 *
 * The card can be minimized (eyebrow + title only, shrunk to the title's
 * width) and dragged between the four viewport corners, picture-in-picture
 * style: free movement while the pointer is down, then a snap to whichever
 * corner the card's center is nearest. Both preferences persist per tab
 * alongside the tour state.
 *
 * There is deliberately no ✕: minimizing handles "out of my way", the TTL
 * in state.ts retires abandoned tours, and the quiet End-tour link in the
 * expanded card is the explicit way out.
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
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

/** Gap between the card and the viewport edges at every anchor. */
const INSET = 16;
/** Pointer travel (px) below which a press still counts as a click. */
const DRAG_THRESHOLD = 4;

type Corner = "tl" | "tr" | "bl" | "br";

const CORNERS: readonly Corner[] = ["tl", "tr", "bl", "br"];

const cornerAnchors: Record<Corner, CSSProperties> = {
  tl: { top: INSET, left: INSET },
  tr: { top: INSET, right: INSET },
  bl: { bottom: INSET, left: INSET },
  br: { bottom: INSET, right: INSET },
};

/**
 * Card placement prefs. sessionStorage (per tab, like the tour state) —
 * where you parked the narrator survives navigation and reload, but a new
 * tab starts at the default corner. Per-origin, so each app remembers its
 * own parking spot.
 */
const UI_KEY = "vgw:tour:ui";

interface TourUiPrefs {
  corner: Corner;
  min: boolean;
}

function readUiPrefs(): TourUiPrefs {
  const fallback: TourUiPrefs = { corner: "br", min: false };
  if (typeof window === "undefined") return fallback;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(UI_KEY);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  let stored: Partial<TourUiPrefs>;
  try {
    stored = JSON.parse(raw) as Partial<TourUiPrefs>;
  } catch {
    stored = {};
  }
  return {
    corner: CORNERS.includes(stored.corner as Corner)
      ? (stored.corner as Corner)
      : fallback.corner,
    min: stored.min === true,
  };
}

function writeUiPrefs(prefs: TourUiPrefs): void {
  try {
    window.sessionStorage.setItem(UI_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the card just resets to the default corner.
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const styles: Record<string, CSSProperties> = {
  card: {
    position: "fixed",
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
    touchAction: "none",
    // Selection would start on pointerdown, before any drag state exists —
    // a dragged card must never leave its own prose highlighted behind.
    userSelect: "none",
  },
  // Minimized, the card shrink-wraps the title instead of wrapping it —
  // fixed-position boxes size to content once width is auto.
  cardMin: {
    width: "auto",
    maxWidth: "calc(100vw - 32px)",
    padding: "12px 14px 12px 16px",
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
  titleMin: {
    margin: "4px 28px 0 0",
    fontSize: 14,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
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
  control: {
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
  endTour: {
    display: "block",
    marginTop: 10,
    padding: 0,
    background: "none",
    border: "none",
    fontFamily: "inherit",
    fontSize: 11,
    fontStyle: "italic",
    color: "rgba(243, 236, 217, 0.5)",
    textDecoration: "underline",
    textUnderlineOffset: 2,
    cursor: "pointer",
  },
};

export function TourOverlay({ origins }: { origins: TourOrigins }) {
  const stop = useTourStop();
  // Landing stops are bookends the landing page renders natively.
  if (stop === null || stop.site === "landing") return null;
  return <TourCard stop={stop} origins={origins} />;
}

function TourCard({ stop, origins }: { stop: TourStop; origins: TourOrigins }) {
  const [prefs, setPrefs] = useState<TourUiPrefs>(readUiPrefs);
  // Visual displacement from the anchored corner: pointer delta while
  // dragging, then the launch point of the snap glide, then null at rest.
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  // True only during the post-release glide — the sole time transform is
  // transitioned (transitions during the drag itself would add pointer lag).
  const [settling, setSettling] = useState(false);
  // The drag is pure pointer math over the rect captured at pointerdown —
  // never the live DOM rect, which lags a render behind the latest offset.
  const pointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
    rect: { left: number; top: number; width: number; height: number };
  } | null>(null);

  useEffect(() => {
    writeUiPrefs(prefs);
  }, [prefs]);

  const progress = tourProgress(stop.id);
  const href = stop.ctaLabel !== undefined ? tourCtaHref(stop, origins) : null;
  const min = prefs.min;
  const dragging = offset !== null && !settling;

  const handlePointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // Controls and the CTA keep their click behavior — drag from anywhere else.
    if ((e.target as HTMLElement).closest("a, button") !== null) return;
    if (settling) {
      // Grabbed mid-glide: finish the snap instantly and drag from the corner.
      setSettling(false);
      setOffset(null);
    }
    const rect = e.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released — the drag simply won't track past the card.
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pointerRef.current;
    if (p === null || e.pointerId !== p.id) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    p.moved = true;
    setOffset({ dx, dy });
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pointerRef.current;
    if (p === null || e.pointerId !== p.id) return;
    pointerRef.current = null;
    if (!p.moved) {
      // A plain click: the whole minimized card is its own expand button.
      if (min) setPrefs((prev) => ({ ...prev, min: false }));
      return;
    }
    // Where the drop leaves the card: the pointerdown rect carried by the
    // full pointer delta. Snap to whichever corner its center lands nearest
    // (the iPhone picture-in-picture rule: viewport quadrant decides).
    const left = p.rect.left + (e.clientX - p.x);
    const top = p.rect.top + (e.clientY - p.y);
    const cx = left + p.rect.width / 2;
    const cy = top + p.rect.height / 2;
    const corner = ((cy < window.innerHeight / 2 ? "t" : "b") +
      (cx < window.innerWidth / 2 ? "l" : "r")) as Corner;
    const targetX =
      corner === "tl" || corner === "bl"
        ? INSET
        : window.innerWidth - INSET - p.rect.width;
    const targetY =
      corner === "tl" || corner === "tr"
        ? INSET
        : window.innerHeight - INSET - p.rect.height;
    // Re-anchor to the new corner but keep the card visually where it was
    // dropped, then glide the leftover offset to zero (FLIP).
    const dx = left - targetX;
    const dy = top - targetY;
    setPrefs((prev) => ({ ...prev, corner }));
    if (prefersReducedMotion() || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) {
      setOffset(null);
      return;
    }
    setOffset({ dx, dy });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setSettling(true);
        setOffset({ dx: 0, dy: 0 });
      }),
    );
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pointerRef.current;
    if (p === null || e.pointerId !== p.id) return;
    pointerRef.current = null;
    setOffset(null);
  };

  const handleTransitionEnd = (e: ReactTransitionEvent<HTMLElement>) => {
    if (e.propertyName !== "transform" || !settling) return;
    setSettling(false);
    setOffset(null);
  };

  const cardStyle: CSSProperties = {
    ...styles.card,
    ...(min ? styles.cardMin : null),
    ...cornerAnchors[prefs.corner],
    ...(offset !== null
      ? { transform: `translate(${offset.dx}px, ${offset.dy}px)` }
      : null),
    transition: settling
      ? "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)"
      : undefined,
    cursor: dragging ? "grabbing" : min ? "pointer" : "grab",
  };

  return (
    <aside
      role="complementary"
      aria-label="Guided tour"
      style={cardStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onTransitionEnd={handleTransitionEnd}
    >
      <button
        type="button"
        onClick={() => setPrefs((prev) => ({ ...prev, min: !prev.min }))}
        aria-label={min ? "Expand the tour card" : "Minimize the tour card"}
        aria-expanded={!min}
        title={min ? "Expand" : "Minimize"}
        style={styles.control}
      >
        {min ? "+" : "−"}
      </button>
      <p
        style={{
          ...styles.eyebrow,
          ...(min ? { marginRight: 28, whiteSpace: "nowrap" } : null),
        }}
      >
        Guided tour{progress !== null ? ` · ${progress.index} of ${progress.total}` : ""}
      </p>
      <h2 style={{ ...styles.title, ...(min ? styles.titleMin : null) }}>
        {stop.title}
      </h2>
      {!min && (
        <>
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
          <button type="button" onClick={exitTour} style={styles.endTour}>
            End tour
          </button>
        </>
      )}
    </aside>
  );
}
