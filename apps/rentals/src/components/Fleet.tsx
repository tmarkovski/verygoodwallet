/**
 * The rental lot — six house vehicles drawn as inline SVG silhouettes.
 * Gated until the driver verification clears; the gate is enforced
 * server-side by the story (this is a demo counter), visually by the
 * overlay here.
 */

interface Vehicle {
  name: string;
  note: string;
  rate: string;
  /** SVG path of the body silhouette in a 160×72 viewBox (wheels drawn separately). */
  body: string;
  /** Fill color of the paintwork. */
  paint: string;
  /** Optional glasshouse path for silhouettes with different rooflines. */
  glasshouse?: string;
  /** Optional front-wheel center for shorter silhouettes. */
  frontWheelX?: number;
}

const FLEET: Vehicle[] = [
  {
    name: "Meridian GT",
    note: "long-haul cruiser, quiet at speed",
    rate: "Ʉ 89/day",
    body: "M14 52c0-8 4-12 14-13l16-2 14-13c3-3 6-4 11-4h26c6 0 10 2 13 6l9 11 20 3c7 1 9 5 9 11v4a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z",
    paint: "#00694f",
  },
  {
    name: "Cartographer AWD",
    note: "reads gravel like a paper map",
    rate: "Ʉ 74/day",
    body: "M12 54v-16c0-5 3-8 8-9l17-3 11-11c3-3 6-4 10-4h34c5 0 8 1 11 4l11 11 17 3c5 1 8 4 8 9v16a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2z",
    paint: "#3c5a4e",
  },
  {
    name: "Milepost Mini",
    note: "city hopper, parks anywhere",
    rate: "Ʉ 39/day",
    body: "M26 53c-6 0-9-3-9-9 0-10 5-15 14-17l9-9c3-3 6-4 10-4h22c4 0 8 1 10 4l9 9c9 2 14 7 14 17 0 6-3 9-9 9z",
    paint: "#b3812e",
    glasshouse: "M43 26l8-8h19l9 8z",
    frontWheelX: 92,
  },
  {
    name: "Interchange EV",
    note: "charges while you sign nothing",
    rate: "Ʉ 65/day",
    body: "M13 53c-2-12 2-18 12-20l18-3 12-10c3-2 5-3 9-3h20c5 0 9 2 12 5l8 8 22 3c8 1 11 7 9 20a3 3 0 0 1-3 2H16a3 3 0 0 1-3-2z",
    paint: "#26433a",
  },
  {
    name: "Overpass Wagon",
    note: "seats five, swallows luggage",
    rate: "Ʉ 55/day",
    body: "M12 54v-13c0-6 3-9 9-10l14-2 8-12c2-3 5-4 9-4h44c4 0 7 1 9 4l8 12 14 2c6 1 9 4 9 10v13a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2z",
    paint: "#5c6f4e",
  },
  {
    name: "Switchback 4×4",
    note: "for the roads the map dashes out",
    rate: "Ʉ 82/day",
    body: "M12 55v-19c0-4 2-7 7-8l20-4 9-9c3-3 6-4 10-4h30c4 0 7 1 10 4l9 9 20 4c5 1 7 4 7 8v19a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2z",
    paint: "#7a4a2e",
  },
];

function VehicleGraphic({ vehicle }: { vehicle: Vehicle }) {
  return (
    <svg viewBox="0 0 160 72" className="h-20 w-auto" aria-hidden="true">
      {/* road */}
      <line x1="4" y1="66" x2="156" y2="66" stroke="#26302a" strokeWidth="2" />
      <line
        x1="10"
        y1="66"
        x2="150"
        y2="66"
        stroke="#f2b705"
        strokeWidth="1.4"
        strokeDasharray="10 8"
      />
      {/* body */}
      <path d={vehicle.body} fill={vehicle.paint} stroke="rgb(29 43 37 / 0.35)" />
      {/* glasshouse */}
      <path
        d={vehicle.glasshouse ?? "M62 26l8-8h22l8 8z"}
        fill="#f2efe4"
        opacity="0.85"
      />
      {/* wheels */}
      <circle cx="48" cy="56" r="9" fill="#1d2b25" />
      <circle cx="48" cy="56" r="4" fill="#f2efe4" />
      <circle cx={vehicle.frontWheelX ?? 116} cy="56" r="9" fill="#1d2b25" />
      <circle cx={vehicle.frontWheelX ?? 116} cy="56" r="4" fill="#f2efe4" />
    </svg>
  );
}

export function Fleet({ unlocked }: { unlocked: boolean }) {
  return (
    <section aria-label="Today's fleet" className="relative">
      <div
        className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${
          unlocked ? "" : "opacity-40 grayscale-[0.6] blur-[1.5px] select-none"
        }`}
        aria-hidden={!unlocked}
      >
        {FLEET.map((vehicle) => (
          <article
            key={vehicle.name}
            className="flex flex-col items-center rounded-2xl border border-line bg-raised px-4 pb-4 pt-5 text-center"
          >
            <VehicleGraphic vehicle={vehicle} />
            <h3 className="mt-3 font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-ink">
              {vehicle.name}
            </h3>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">{vehicle.note}</p>
            <p className="mt-2 font-mono text-[13px] font-semibold text-accent">
              {vehicle.rate}
            </p>
            <button
              type="button"
              disabled={!unlocked}
              className="mt-3 w-full rounded-xl bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast transition-opacity hover:opacity-90 disabled:cursor-not-allowed"
            >
              Reserve
            </button>
          </article>
        ))}
      </div>

      {!unlocked && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-line-strong bg-raised px-6 py-4 text-center shadow-lg">
            <p className="font-display text-lg font-semibold uppercase tracking-[0.04em] text-ink">
              The lot is gated.
            </p>
            <p className="mt-1 text-[13px] text-ink-dim">
              Verify the rental basics — name, license, over-25 — straight from
              your wallet. Your birthdate can stay in your pocket.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
