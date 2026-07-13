/**
 * In-flight protocol progress: done / active / pending markers for a
 * ceremony's phases, driven by the flow's `onStep` callback.
 */

import { SectionTitle, Spinner } from "./ui";

export interface StepDescriptor {
  id: string;
  label: string;
}

export function StepList({
  title,
  steps,
  current,
}: {
  title: string;
  steps: readonly StepDescriptor[];
  current: string | null;
}) {
  const activeIndex = current === null ? -1 : steps.findIndex((s) => s.id === current);
  return (
    <div className="mt-6 animate-fade rounded-3xl border border-line bg-surface p-5">
      <SectionTitle>{title}</SectionTitle>
      <ol className="mt-3 space-y-2.5">
        {steps.map((s, index) => {
          const state =
            index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
          return (
            <li
              key={s.id}
              className={`flex items-center gap-2.5 text-[13px] ${
                state === "pending" ? "text-muted" : "text-ink"
              }`}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {state === "done" ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className="text-ok"
                  >
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : state === "active" ? (
                  <Spinner />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              {s.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
