import type { ReactNode } from "react";

const JSON_TOKEN =
  /("(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\])*")(\s*:)?|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

function jsonSource(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_key, nested) => (typeof nested === "bigint" ? nested.toString() : nested),
      2,
    ) ?? String(value)
  );
}

function highlightedJson(value: unknown): ReactNode[] {
  const source = jsonSource(value);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of source.matchAll(JSON_TOKEN)) {
    const index = match.index;
    if (index > cursor) nodes.push(source.slice(cursor, index));

    const [, quoted, colon, number, literal] = match;
    if (quoted !== undefined) {
      nodes.push(
        <span key={key++} className={colon === undefined ? "text-ok" : "text-ink"}>
          {quoted}
        </span>,
      );
      if (colon !== undefined) {
        nodes.push(
          <span key={key++} className="text-muted">
            {colon}
          </span>,
        );
      }
    } else if (number !== undefined) {
      nodes.push(
        <span key={key++} className="text-accent">
          {number}
        </span>,
      );
    } else {
      nodes.push(
        <span key={key++} className={literal === "null" ? "text-muted" : "text-accent"}>
          {literal}
        </span>,
      );
    }

    cursor = index + match[0].length;
  }

  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

/** Pretty-printed, selectable JSON with the same syntax colors across every demo app. */
export function JsonCode({
  value,
  className = "",
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <pre
      className={`overflow-auto whitespace-pre font-mono text-[11px] leading-relaxed text-ink-dim ${className}`}
    >
      {highlightedJson(value)}
    </pre>
  );
}
