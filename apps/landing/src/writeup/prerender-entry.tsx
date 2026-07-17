/**
 * SSR entry for the build-time prerender (see ../../prerender.mjs).
 * Mirrors main.tsx's component tree exactly so client hydration matches.
 */
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { Writeup } from "./Writeup";

export function render(): string {
  return renderToString(
    <StrictMode>
      <Writeup />
    </StrictMode>,
  );
}
