/**
 * The issued-offer panel: wallet deep link, cross-device QR, and the raw
 * protocol payload for the curious (inspector pedagogy — quiet mono, no
 * ceremony).
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { CredentialOffer } from "@vgw/protocols";

export interface OfferResultProps {
  credentialOffer: CredentialOffer;
  credentialOfferUri: string;
  walletLink: string;
  walletOrigin: string;
}

export function OfferResult({
  credentialOffer,
  credentialOfferUri,
  walletLink,
  walletOrigin,
}: OfferResultProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Rendered at 2x the display size for crisp modules; petrol-on-paper so
    // the code stays scannable (QR needs dark-on-light) inside the dark UI.
    QRCode.toDataURL(walletLink, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: { dark: "#0c1f21", light: "#f6f3ea" },
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
        <span aria-hidden="true" className="seal-authority size-10 shrink-0" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            License issued
          </p>
          <p className="mt-0.5 text-sm text-ink-dim">
            Ready for pickup — collect it into your wallet.
          </p>
        </div>
      </div>

      <a
        href={walletLink}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-contrast shadow-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
      >
        Open in VeryGoodWallet
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

      <details className="mt-5 rounded-xl border border-line bg-canvas">
        <summary className="cursor-pointer select-none px-4 py-3 text-[12px] font-medium text-ink-dim">
          Raw credential offer
        </summary>
        <div className="border-t border-line px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            credential_offer_uri
          </p>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted">
            {credentialOfferUri}
          </pre>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            credential_offer
          </p>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify(credentialOffer, null, 2)}
          </pre>
        </div>
      </details>
    </section>
  );
}
