/**
 * The hero element: a credential card with an engraved guilloché face.
 * Every card shares the same deep-petrol plate — in both UI themes, like
 * physical cards in a wallet — so its colors are literal, not tokens.
 * `meta.colorSeed` picks the engraving tint; the red seal is the issuing
 * authority's mark.
 */

import type { CSSProperties } from "react";
import { cardTheme } from "../services/color";
import { kindLabel } from "../services/meta";
import type { CredentialMeta } from "../services/meta";

export function CredentialCard({ meta }: { meta: CredentialMeta }) {
  const theme = cardTheme(meta.colorSeed);
  return (
    <div
      className="guilloche relative aspect-[8/5] w-full overflow-hidden rounded-3xl border border-[rgb(201_168_106/0.35)] p-6 text-[#ece7d3] shadow-[0_18px_44px_rgb(0_0_0/0.45)]"
      style={
        {
          "--guilloche-line-a": theme.lineA,
          "--guilloche-line-b": theme.lineB,
        } as CSSProperties
      }
    >
      <div className="relative flex h-full flex-col justify-between">
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
        <div className="flex items-end justify-between">
          <span className="rounded-full bg-[#ece7d3]/10 px-2.5 py-1 text-[11px] font-medium text-[#ece7d3]/85 backdrop-blur-sm">
            {kindLabel(meta.kind)}
          </span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-[#ece7d3]/45">
            credkit-bbs
          </span>
        </div>
      </div>
    </div>
  );
}
