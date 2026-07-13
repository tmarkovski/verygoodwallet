/**
 * App chrome: sticky header (wordmark, session chip, inspector + settings
 * buttons) and the inspector drawer.
 */

import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { InspectorDrawer } from "../inspector/InspectorDrawer";
import { useSession } from "../session";

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-xl p-2.5 text-muted transition-colors hover:bg-surface hover:text-ink"
    >
      {children}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const { account, locked, simulated, logout } = useSession();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between px-5 py-3.5">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gold-soft text-gold transition-transform duration-200 group-hover:scale-105">
              {/* key glyph */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="4.25" stroke="currentColor" strokeWidth="1.8" />
                <path d="M11 11l8.5 8.5M16 16l2.5-2.5M18.5 18.5l2-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight">
              VeryGood<span className="text-gold">Wallet</span>
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {!locked && account !== null && (
              <span className="mr-1 hidden items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs text-ink-dim sm:flex">
                <span className={`size-1.5 rounded-full ${simulated ? "bg-danger" : "bg-ok"}`} />
                {account.name}
              </span>
            )}
            {!locked && (
              <IconButton
                label="Lock wallet"
                onClick={() => {
                  logout();
                  void navigate("/");
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </IconButton>
            )}
            <IconButton label="Toggle inspector" onClick={() => setInspectorOpen((v) => !v)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </IconButton>
            <IconButton label="Settings" onClick={() => void navigate("/settings")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2L5.6 5.6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-20 pt-8">{children}</main>

      <footer className="border-t border-line py-6">
        <p className="mx-auto max-w-xl px-5 text-center text-[11px] text-muted">
          Demo wallet — keys derive from your passkey's PRF output and never
          leave this device.
        </p>
      </footer>

      <InspectorDrawer open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
    </div>
  );
}
