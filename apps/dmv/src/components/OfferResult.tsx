/**
 * The issued-offer panel: wallet deep link, cross-device QR, and the raw
 * protocol payload for the curious (inspector pedagogy — quiet mono, no
 * ceremony).
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { CredentialOffer } from "@vgw/protocols";
import { useAutoReveal } from "@vgw/tour";

export interface OfferResultProps {
  credentialOffer: CredentialOffer;
  credentialOfferUri: string;
  /** Stamp headline, e.g. "License issued" / "Registration issued". */
  issuedLabel: string;
  /** Null when no wallet origin is configured — the panel shows a notice instead. */
  walletLink: string | null;
  walletOrigin: string | null;
}

export function OfferResult({
  credentialOffer,
  credentialOfferUri,
  issuedLabel,
  walletLink,
  walletOrigin,
}: OfferResultProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const qrRef = useAutoReveal<HTMLImageElement>(qrDataUrl !== null);

  useEffect(() => {
    if (walletLink === null) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    // Rendered at 2x the display size for crisp modules; clerk ink on white
    // keeps the code scannable and belongs to the DMV's paper UI.
    QRCode.toDataURL(walletLink, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: { dark: "#172b36", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [walletLink]);

  return (
    <section className="animate-rise mt-6 rounded-3xl border border-line bg-surface p-6">
      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="issuance-stamp size-10 shrink-0" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stamp">
            {issuedLabel}
          </p>
          <p className="mt-0.5 text-sm text-ink-dim">
            Ready for pickup — collect it into your wallet.
          </p>
        </div>
      </div>

      {walletLink !== null ? (
        <>
          <a
            href={walletLink}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-contrast shadow-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
          >
            Continue in VeryGoodWallet
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M7 17L17 7M9 7h8v8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
          <p className="mt-2 text-center font-mono text-[11px] text-muted">
            wallet origin {walletOrigin} — override with ?wallet=&lt;origin&gt;
          </p>

          <div className="mt-5 flex flex-col items-center">
            {qrDataUrl !== null && (
              <img
                ref={qrRef}
                src={qrDataUrl}
                alt="QR code of the wallet offer link"
                width={224}
                height={224}
                className="rounded-2xl border border-line"
              />
            )}
            <p className="mt-2 text-[11px] text-muted">
              Scan to pick up on another device
            </p>
          </div>
        </>
      ) : (
        // No wallet origin configured: a loud notice beats a link/QR that
        // dead-ends at the wrong host (see src/walletOrigin.ts).
        <p
          role="alert"
          className="mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          No wallet configured — append ?wallet=&lt;origin&gt; to this page, or
          rebuild with VITE_WALLET_ORIGIN set (see DEPLOY.md), to get a pickup
          link and QR code.
        </p>
      )}

      {/* Same collapsible-inspector idiom as the verifiers' raw-JSON exhibits. */}
      <details className="group mt-5 rounded-xl border border-line bg-canvas text-left">
        <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted group-open:border-b group-open:border-line">
          Raw credential offer
        </summary>
        <div className="max-h-72 overflow-auto p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            credential_offer_uri
          </p>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-ink-dim">
            {credentialOfferUri}
          </pre>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            credential_offer
          </p>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-ink-dim">
            {JSON.stringify(credentialOffer, null, 2)}
          </pre>
        </div>
      </details>
    </section>
  );
}
