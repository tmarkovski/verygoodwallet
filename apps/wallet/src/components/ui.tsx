/**
 * Small shared UI primitives: buttons, badges, section headers.
 * No dependencies — plain Tailwind utilities.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-contrast font-semibold shadow-sm hover:brightness-110 active:scale-[0.98]",
  ghost:
    "border border-line-strong text-ink hover:bg-surface active:scale-[0.98]",
  danger:
    "bg-danger-soft text-danger border border-danger/30 hover:bg-danger hover:text-canvas active:scale-[0.98]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  busy?: boolean;
}

export function Button({
  variant = "primary",
  busy = false,
  disabled,
  children,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled === true || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type BadgeTone = "gold" | "ok" | "warn" | "neutral";

const BADGE_STYLES: Record<BadgeTone, string> = {
  /** Authority marks — issuer names, verified wordmarks. */
  gold: "bg-gold-soft text-gold",
  ok: "bg-ok-soft text-ok",
  warn: "bg-danger-soft text-danger",
  neutral: "bg-surface text-muted",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

/** PRF status badge — the honest label the plan requires. */
export function PrfBadge({ prfSupported }: { prfSupported: boolean }) {
  return prfSupported ? (
    <Badge tone="ok">Passkey PRF</Badge>
  ) : (
    <Badge tone="warn">Simulated (PRF unavailable)</Badge>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
      {children}
    </h2>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      {children}
    </p>
  );
}

/** Friendly message for WebAuthn/DOM exceptions. */
export function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "The passkey prompt was dismissed or timed out. Please try again.";
    }
    if (error.name === "InvalidStateError") {
      return "This authenticator already has a passkey for this wallet.";
    }
    return `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
