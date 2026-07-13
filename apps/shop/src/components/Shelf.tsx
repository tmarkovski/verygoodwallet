/**
 * The bottle shelf — six house bottles drawn as inline SVG silhouettes.
 * Locked until the age gate verifies; the lock is enforced server-side by
 * the story (this is a demo storefront), visually by the overlay here.
 */

interface Bottle {
  name: string;
  note: string;
  price: string;
  /** SVG path of the bottle silhouette in a 60×140 viewBox. */
  silhouette: string;
  /** Fill color of the glass. */
  glass: string;
}

const BOTTLES: Bottle[] = [
  {
    name: "Utopia Rye 12",
    note: "engraved oak, long finish",
    price: "Ʉ 68",
    silhouette:
      "M24 8h12v26l6 10c1.5 2.6 2 4.6 2 8v74a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6V52c0-3.4.5-5.4 2-8l6-10z",
    glass: "#8a5a24",
  },
  {
    name: "Petrol Gin",
    note: "juniper over deep water",
    price: "Ʉ 44",
    silhouette:
      "M26 8h8v20l10 14c2 2.8 3 5.2 3 9v75a6 6 0 0 1-6 6H19a6 6 0 0 1-6-6V51c0-3.8 1-6.2 3-9l10-14z",
    glass: "#1d4a4d",
  },
  {
    name: "Guilloché Bitter",
    note: "orange peel, engraver's spice",
    price: "Ʉ 39",
    silhouette:
      "M22 8h16v34a18 18 0 0 1 10 16v68a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V58a18 18 0 0 1 10-16z",
    glass: "#9c3b2e",
  },
  {
    name: "Verdigris Amaro",
    note: "thirty-one herbs, patina green",
    price: "Ʉ 52",
    silhouette:
      "M25 8h10v18l8 8c3 3 5 6.5 5 11v81a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V45c0-4.5 2-8 5-11l8-8z",
    glass: "#3e6b52",
  },
  {
    name: "Midnight Vermouth",
    note: "wormwood under lamplight",
    price: "Ʉ 35",
    silhouette:
      "M23 8h14v22l7 12c1.6 2.7 2 4.8 2 8v76a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6V50c0-3.2.4-5.3 2-8l7-12z",
    glass: "#4a3550",
  },
  {
    name: "Engraver's Stout",
    note: "black as fresh ink",
    price: "Ʉ 12",
    silhouette:
      "M22 8h16v18c6 4 10 10.5 10 18v74a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V44c0-7.5 4-14 10-18z",
    glass: "#241a12",
  },
];

function BottleGraphic({ bottle }: { bottle: Bottle }) {
  return (
    <svg viewBox="0 0 60 140" className="h-32 w-auto" aria-hidden="true">
      {/* cork/cap */}
      <rect x="24" y="2" width="12" height="8" rx="2" fill="#c9a86a" opacity="0.85" />
      <path d={bottle.silhouette} fill={bottle.glass} stroke="rgb(241 232 214 / 0.25)" />
      {/* label */}
      <rect
        x="16"
        y="72"
        width="28"
        height="34"
        rx="2"
        fill="#f1e8d6"
        opacity="0.92"
      />
      <line x1="20" y1="80" x2="40" y2="80" stroke="#92876f" strokeWidth="2" />
      <line x1="20" y1="87" x2="40" y2="87" stroke="#cabfa8" strokeWidth="1.5" />
      <line x1="20" y1="93" x2="34" y2="93" stroke="#cabfa8" strokeWidth="1.5" />
    </svg>
  );
}

export function Shelf({ unlocked }: { unlocked: boolean }) {
  return (
    <section aria-label="Tonight's shelf" className="relative">
      <div
        className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${
          unlocked ? "" : "opacity-40 grayscale-[0.6] blur-[1.5px] select-none"
        }`}
        aria-hidden={!unlocked}
      >
        {BOTTLES.map((bottle) => (
          <article
            key={bottle.name}
            className="flex flex-col items-center rounded-2xl border border-line bg-surface px-4 pb-4 pt-5 text-center"
          >
            <BottleGraphic bottle={bottle} />
            <h3 className="mt-3 font-display text-[15px] text-ink">{bottle.name}</h3>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">{bottle.note}</p>
            <p className="mt-2 font-mono text-[13px] text-accent">{bottle.price}</p>
            <button
              type="button"
              disabled={!unlocked}
              className="mt-3 w-full rounded-xl bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast transition-opacity hover:opacity-90 disabled:cursor-not-allowed"
            >
              Add to basket
            </button>
          </article>
        ))}
      </div>

      {!unlocked && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-line-strong bg-overlay px-6 py-4 text-center backdrop-blur-[2px]">
            <p className="font-display text-lg text-ink">Shelf's locked after dark.</p>
            <p className="mt-1 text-[13px] text-ink-dim">
              Verify you're over 18 to browse — no ID handover, just one honest bit.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
