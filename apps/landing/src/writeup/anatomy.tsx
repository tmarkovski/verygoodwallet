/**
 * Shared machinery for the /writeup/ "anatomy" figures: a specimen pane
 * (annotated JSON, credential cards, byte strips) whose marked tokens pair
 * with numbered annotation cards in a side rail. Hover or focus on either
 * half highlights the pair, and on wide screens an SVG overlay draws a fine
 * connector line from each mark to its card using engraving-style line work.
 * Measurements happen client-side after hydration so the prerendered HTML
 * never depends on layout.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Semantic ink families shared by marks, cards, strips, and legends. */
export type NoteColor = "disclosed" | "hidden" | "proven" | "binding" | "wire";

export interface AnatomyNote {
  id: string;
  color: NoteColor;
  title: string;
  body: ReactNode;
  /**
   * "rail" (default) renders in the annotation column; an "inline" note's
   * card is placed by the pane itself via <InlineNote> (e.g. the link-secret
   * chip between the two credential cards).
   */
  placement?: "rail" | "inline";
}

interface AnatomyContextValue {
  figureId: string;
  active: string | null;
  setActive: (id: string | null) => void;
  colorOf: (id: string) => NoteColor;
  numberOf: (id: string) => number | undefined;
}

const AnatomyContext = createContext<AnatomyContextValue | null>(null);

function useAnatomy(): AnatomyContextValue {
  const value = useContext(AnatomyContext);
  if (value === null) throw new Error("anatomy components must live inside <AnatomyFigure>");
  return value;
}

/**
 * Interaction props for any element acting as a mark. Spread onto the
 * element; pair with the `anat-mark`/`anat-row` styles as needed. Passing
 * `undefined` yields inert props (rows without an annotation).
 */
export function useMarkProps(note: string | undefined): {
  active: boolean;
  markProps: Record<string, unknown>;
} {
  const { figureId, active, setActive } = useAnatomy();
  if (note === undefined) return { active: false, markProps: {} };
  return {
    active: active === note,
    markProps: {
      "data-mark": note,
      tabIndex: 0,
      "aria-describedby": `${figureId}-note-${note}`,
      onMouseEnter: () => setActive(note),
      onMouseLeave: () => setActive(null),
      onFocus: () => setActive(note),
      onBlur: () => setActive(null),
    },
  };
}

/** An annotated token inside a JSON pane. */
export function Mark({
  note,
  quiet,
  children,
}: {
  note: string;
  /** Suppress the numeral on repeat marks of the same note. */
  quiet?: boolean;
  children: ReactNode;
}) {
  const { numberOf, colorOf } = useAnatomy();
  const { active, markProps } = useMarkProps(note);
  const number = numberOf(note);
  return (
    <span
      {...markProps}
      className={`anat-mark c-${colorOf(note)}${active ? " is-active" : ""}`}
    >
      {children}
      {!quiet && number !== undefined && <i className="anat-num">{number}</i>}
    </span>
  );
}

/** The card for an `inline`-placed note, positioned by the pane's layout. */
export function InlineNote({ note, children }: { note: string; children: ReactNode }) {
  const { figureId, active, setActive } = useAnatomy();
  return (
    <div
      data-note-card={note}
      id={`${figureId}-note-${note}`}
      className={`anat-chip c-binding${active === note ? " is-active" : ""}`}
      onMouseEnter={() => setActive(note)}
      onMouseLeave={() => setActive(null)}
    >
      {children}
    </div>
  );
}

interface ConnectorLine {
  key: string;
  id: string;
  color: NoteColor;
  d: string;
  x: number;
  y: number;
}

export function AnatomyFigure({
  id,
  eyebrow,
  title,
  notes,
  children,
  footer,
  caption,
  railPosition = "side",
}: {
  /** Unique per page; namespaces the note DOM ids. */
  id: string;
  eyebrow: string;
  title: string;
  notes: readonly AnatomyNote[];
  /** The specimen pane (left column on wide screens). */
  children: ReactNode;
  /** Full-width content below the pane/rail grid (byte strips, verdict boxes). */
  footer?: ReactNode;
  caption?: ReactNode;
  /**
   * "side" pairs marks and cards with connector lines; "below" flows the
   * cards under a full-width pane with hover pairing only and no long lines.
   */
  railPosition?: "side" | "below";
}) {
  const [active, setActive] = useState<string | null>(null);
  const [lines, setLines] = useState<ConnectorLine[]>([]);
  const rootRef = useRef<HTMLElement>(null);

  const railNotes = useMemo(
    () => notes.filter((note) => (note.placement ?? "rail") === "rail"),
    [notes],
  );
  const context = useMemo<AnatomyContextValue>(
    () => ({
      figureId: id,
      active,
      setActive,
      colorOf: (noteId) => notes.find((note) => note.id === noteId)?.color ?? "wire",
      numberOf: (noteId) => {
        const index = railNotes.findIndex((note) => note.id === noteId);
        return index === -1 ? undefined : index + 1;
      },
    }),
    [id, active, notes, railNotes],
  );

  // Connector lines: measured after layout, wide screens only. The initial
  // render (and the prerendered HTML) carries no lines, so hydration always
  // matches; numbered marks keep the figure legible without them.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const wide = window.matchMedia("(min-width: 48rem)");
    let frame = 0;
    const measure = () => {
      if (!wide.matches) {
        setLines((previous) => (previous.length === 0 ? previous : []));
        return;
      }
      const box = root.getBoundingClientRect();
      const next: ConnectorLine[] = [];
      for (const note of notes) {
        const card = root.querySelector<HTMLElement>(`[data-note-card="${note.id}"]`);
        if (card === null || card.dataset["noLine"] !== undefined) continue;
        const c = card.getBoundingClientRect();
        if (c.width === 0) continue;
        const marks = root.querySelectorAll<HTMLElement>(`[data-mark="${note.id}"]`);
        marks.forEach((mark, index) => {
          const m = mark.getBoundingClientRect();
          if (m.width === 0) return;
          // Exit from whichever mark edge faces the card.
          const forward = m.right - box.left <= c.left - box.left;
          const x1 = (forward ? m.right : m.left) - box.left + (forward ? 3 : -3);
          const y1 = m.top - box.top + m.height / 2;
          const x2 = (forward ? c.left : c.right) - box.left + (forward ? -5 : 5);
          const y2 = c.top - box.top + (c.height < 56 ? c.height / 2 : 16);
          const bend = Math.max(24, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
          next.push({
            key: `${note.id}-${index}`,
            id: note.id,
            color: note.color,
            d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
            x: x1,
            y: y1,
          });
        });
      }
      setLines(next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const scrollers = Array.from(root.querySelectorAll("[data-anat-scroll]"));
    scrollers.forEach((el) => el.addEventListener("scroll", schedule));
    wide.addEventListener("change", schedule);
    document.fonts?.ready.then(schedule).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scrollers.forEach((el) => el.removeEventListener("scroll", schedule));
      wide.removeEventListener("change", schedule);
    };
  }, [notes]);

  return (
    <figure id={id} ref={rootRef} className="figure-wide anat">
      <AnatomyContext.Provider value={context}>
        <figcaption>
          <p className="anat-eyebrow">{eyebrow}</p>
          <p className="anat-title">{title}</p>
        </figcaption>
        <div className={`anat-grid${railPosition === "below" ? " is-below" : ""}`}>
          <div className="anat-pane-col">{children}</div>
          <div className={`anat-rail${railPosition === "below" ? " is-below" : ""}`}>
            {railNotes.map((note, index) => (
              <div
                key={note.id}
                data-note-card={note.id}
                {...(railPosition === "below" ? { "data-no-line": "" } : {})}
                id={`${id}-note-${note.id}`}
                className={`anat-note c-${note.color}${active === note.id ? " is-active" : ""}`}
                onMouseEnter={() => setActive(note.id)}
                onMouseLeave={() => setActive(null)}
              >
                <p className="anat-note-title">
                  <i className="anat-num">{index + 1}</i>
                  {note.title}
                </p>
                <p className="anat-note-body">{note.body}</p>
              </div>
            ))}
          </div>
        </div>
        {footer}
        {caption !== undefined && <p className="anat-caption">{caption}</p>}
        <svg className="anat-lines" aria-hidden="true">
          {lines.map((line) => (
            <g key={line.key} className={active === line.id ? "is-active" : ""}>
              <path className={`anat-line c-${line.color}`} d={line.d} />
              <circle className={`anat-dot c-${line.color}`} cx={line.x} cy={line.y} r={2} />
            </g>
          ))}
        </svg>
      </AnatomyContext.Provider>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Byte strips
// ---------------------------------------------------------------------------

export interface ByteSegment {
  label: string;
  bytes?: string;
  color: NoteColor;
  /** Relative visual width; use compressed (sqrt-ish) proportions, not raw bytes. */
  grow: number;
}

export function ByteStrip({
  title,
  segments,
  legend,
}: {
  title: ReactNode;
  segments: readonly ByteSegment[];
  legend?: readonly { color: NoteColor; label: string; text: ReactNode }[];
}) {
  return (
    <div className="anat-strip">
      <p className="anat-strip-title">{title}</p>
      <div className="anat-strip-scroll" data-anat-scroll>
        <div className="anat-strip-bar">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className={`anat-seg c-${segment.color}`}
              style={{ flexGrow: segment.grow }}
            >
              <span className="anat-seg-label">{segment.label}</span>
              {segment.bytes !== undefined && (
                <span className="anat-seg-bytes">{segment.bytes}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      {legend !== undefined && (
        <ul className="anat-strip-legend">
          {legend.map((entry) => (
            <li key={entry.label} className={`c-${entry.color}`}>
              <i className="anat-legend-dot" />
              <span>
                <strong>{entry.label}:</strong> {entry.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credential cards (the presentation figure's side-by-side halves)
// ---------------------------------------------------------------------------

export type RowStatus = "disclosed" | "hidden" | "proven" | "binding";

export interface CardRow {
  label: string;
  value?: string;
  status: RowStatus;
  /** Short proof statement shown as a badge, e.g. "proved ≤ day 37,091". */
  badge?: string;
  /** Pairs the row with an annotation note. */
  note?: string;
}

const ROW_COLOR: Record<RowStatus, NoteColor> = {
  disclosed: "disclosed",
  hidden: "hidden",
  proven: "proven",
  binding: "binding",
};

function CredentialRow({ row }: { row: CardRow }) {
  const { active, markProps } = useMarkProps(row.note);
  return (
    <div
      {...markProps}
      className={`anat-row is-${row.status} c-${ROW_COLOR[row.status]}${active ? " is-active" : ""}`}
    >
      <i className="anat-row-dot" />
      <span className="anat-row-label">{row.label}</span>
      <span className="anat-row-value">
        {row.value}
        {row.badge !== undefined && <span className="anat-badge">{row.badge}</span>}
      </span>
    </div>
  );
}

export function CredentialCard({ title, rows }: { title: string; rows: readonly CardRow[] }) {
  return (
    <div className="anat-card">
      <p className="anat-card-head">{title}</p>
      {rows.map((row) => (
        <CredentialRow key={row.label} row={row} />
      ))}
    </div>
  );
}

/** The figure-level key for row statuses. */
export function StatusKey() {
  return (
    <div className="anat-key">
      <span className="c-disclosed">
        <i className="anat-row-dot" /> disclosed
      </span>
      <span className="c-hidden">
        <i className="anat-row-dot" /> stays hidden
      </span>
      <span className="c-proven">
        <i className="anat-row-dot" /> hidden, but proven about
      </span>
      <span className="c-binding">
        <i className="anat-row-dot" /> holder binding
      </span>
    </div>
  );
}
