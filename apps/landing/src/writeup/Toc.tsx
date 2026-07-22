/**
 * The writeup's right-rail table of contents (desktop only). A scroll
 * listener keeps the entry whose heading was most recently passed marked
 * active; clicks ride native anchor navigation (headings carry
 * scroll-margin, and the page opts into smooth scrolling).
 */
import { useEffect, useState } from "react";

export interface TocSection {
  id: string;
  label: string;
  children?: readonly { id: string; label: string }[];
}

function flatten(sections: readonly TocSection[]): string[] {
  return sections.flatMap((section) => [
    section.id,
    ...(section.children?.map((child) => child.id) ?? []),
  ]);
}

export function Toc({ sections }: { sections: readonly TocSection[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const ids = flatten(sections);
    let frame = 0;
    const update = () => {
      // Active = the last heading (in document order) above the fold line.
      let current: string | null = null;
      for (const id of ids) {
        const heading = document.getElementById(id);
        if (heading === null) continue;
        if (heading.getBoundingClientRect().top <= 160) current = id;
        else break;
      }
      // At the very bottom, pin the last entry because the final heading can
      // sit too low to ever cross the fold line.
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        current = ids[ids.length - 1] ?? current;
      }
      setActive(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sections]);

  return (
    <nav className="toc" aria-label="Article contents">
      <p className="toc-title">Contents</p>
      {sections.map((section) => (
        <div key={section.id}>
          <a href={`#${section.id}`} className={active === section.id ? "is-active" : ""}>
            {section.label}
          </a>
          {section.children?.map((child) => (
            <a
              key={child.id}
              href={`#${child.id}`}
              className={`toc-sub${active === child.id ? " is-active" : ""}`}
            >
              {child.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
