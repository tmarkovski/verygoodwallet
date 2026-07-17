import { useEffect, useRef, type RefObject } from "react";

/**
 * Bring newly rendered flow output into view without moving keyboard focus.
 * Reduced-motion users get the same positioning without animated scrolling.
 */
export function useAutoReveal<T extends HTMLElement>(
  revealed: boolean,
  block: ScrollLogicalPosition = "center",
): RefObject<T | null> {
  const targetRef = useRef<T>(null);

  useEffect(() => {
    if (!revealed || targetRef.current === null) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    targetRef.current.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block,
      inline: "nearest",
    });
  }, [revealed, block]);

  return targetRef;
}
