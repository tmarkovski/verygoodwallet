/**
 * Dependency-free collapsible JSON viewer built on `<details>`.
 */

const MAX_STRING = 120;

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted">null</span>;
  switch (typeof value) {
    case "string": {
      const shown =
        value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
      return (
        <span className="break-all text-ok" title={value.length > MAX_STRING ? value : undefined}>
          "{shown}"
        </span>
      );
    }
    case "number":
    case "bigint":
      return <span className="text-ink">{String(value)}</span>;
    case "boolean":
      return <span className="text-ink">{String(value)}</span>;
    case "undefined":
      return <span className="text-muted">undefined</span>;
    default:
      return <span className="text-muted">{String(value)}</span>;
  }
}

function isComposite(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

interface JsonNodeProps {
  name?: string;
  value: unknown;
  defaultOpen?: boolean;
  depth: number;
}

function JsonNode({ name, value, defaultOpen = false, depth }: JsonNodeProps) {
  const label =
    name !== undefined ? <span className="text-ink-dim">{name}: </span> : null;

  if (!isComposite(value)) {
    return (
      <div className="py-px">
        {label}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  const summary = Array.isArray(value)
    ? `Array(${entries.length})`
    : `{…} ${entries.length} ${entries.length === 1 ? "key" : "keys"}`;

  return (
    <details open={defaultOpen} className="py-px">
      <summary className="cursor-pointer select-none text-ink-dim hover:text-ink [&::marker]:text-muted">
        {label}
        <span className="text-muted">{summary}</span>
      </summary>
      <div className="ml-1.5 border-l border-line pl-3">
        {entries.map(([key, item]) => (
          <JsonNode key={key} name={key} value={item} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export function JsonTree({
  value,
  defaultOpen = true,
}: {
  value: unknown;
  defaultOpen?: boolean;
}) {
  return (
    <div className="overflow-x-auto font-mono text-xs leading-relaxed">
      <JsonNode value={value} defaultOpen={defaultOpen} depth={0} />
    </div>
  );
}
