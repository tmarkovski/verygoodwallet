/**
 * The hero element: a credential card with an engraved guilloché face.
 * Each of the DMV's document series gets its own plate and engraving
 * geometry (services/color.ts) — dark in both UI themes, like physical
 * cards in a wallet, so the colors are literal. The red seal is the
 * issuing authority's mark.
 *
 * `face` is optional richer display data derived from the DECRYPTED
 * credential (services/meta.ts `cardFace`); without it — a locked wallet —
 * the card renders the generic plate from plaintext meta alone.
 */

import type { CSSProperties } from "react";
import { cardTheme } from "../services/color";
import { kindLabel } from "../services/meta";
import type { CardFace, CredentialMeta } from "../services/meta";

export function CredentialCard({
  meta,
  face,
}: {
  meta: CredentialMeta;
  face?: CardFace | null;
}) {
  const theme = cardTheme(meta.colorSeed);
  return (
    <div
      className={`guilloche ${
        theme.pattern === "tide" ? "guilloche-tide" : ""
      } relative aspect-[8/5] w-full overflow-hidden rounded-3xl border border-[rgb(201_168_106/0.35)] p-6 text-[#ece7d3] shadow-[0_18px_44px_rgb(0_0_0/0.45)]`}
      style={
        {
          "--guilloche-line-a": theme.lineA,
          "--guilloche-line-b": theme.lineB,
          "--guilloche-plate-a": theme.plateA,
          "--guilloche-plate-b": theme.plateB,
          "--seal-well": theme.plateB,
        } as CSSProperties
      }
    >
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-[#c9a86a]">
              {meta.issuerName}
            </p>
            <h3 className="mt-1 truncate text-lg font-semibold leading-tight">
              {meta.name}
            </h3>
          </div>
          <span aria-hidden="true" className="seal-authority size-9 shrink-0" />
        </div>
        <div className="mt-auto min-w-0">
          {face != null && (
            <>
              {face.holder !== undefined && (
                <p className="truncate font-mono text-[13px] tracking-[0.14em] text-[#ece7d3]/90">
                  {face.holder}
                </p>
              )}
              {face.fields.length > 0 && (
                <div className="mt-2 flex gap-6">
                  {face.fields.map((field) => (
                    <div key={field.label} className="min-w-0">
                      <p className="text-[9px] uppercase tracking-[0.18em] text-[#c9a86a]/80">
                        {field.label}
                      </p>
                      <p className="truncate font-mono text-[11px] text-[#ece7d3]/85">
                        {field.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <span className="shrink-0 rounded-full bg-[#ece7d3]/10 px-2.5 py-1 text-[11px] font-medium text-[#ece7d3]/85 backdrop-blur-sm">
            {kindLabel(meta.kind)}
          </span>
          <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
            {/* Security microprint — like the fine print on a physical card,
                readable only once the wallet is unlocked (face data). */}
            {face != null && (
              <p className="truncate font-mono text-[9px] tracking-[0.18em] text-[#c9a86a]/75">
                HOLDER-BOUND{face.revocable ? " · REVOCABLE" : ""}
              </p>
            )}
            <span className="font-mono text-[10px] tracking-[0.2em] text-[#ece7d3]/45">
              credkit-bbs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
