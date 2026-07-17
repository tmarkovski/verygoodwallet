import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "../index.css";
import { Writeup } from "./Writeup";

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    <Writeup />
  </StrictMode>
);

// Production builds ship the article prerendered into #root (prerender.mjs);
// the dev server serves the empty shell.
if (root.firstElementChild) {
  hydrateRoot(root, app);
} else {
  createRoot(root).render(app);
}
