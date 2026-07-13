/**
 * The age-verification panel: one verification session from start to
 * outcome.
 *
 * Sequence: create a session on the Worker → attempt the browser's Digital
 * Credentials API (the exhibit: web wallets can't answer it yet, so its
 * outcome is explained rather than hidden) → fall back to the OID4VP wallet
 * link + QR → poll the session until the wallet's direct_post lands →
 * render the verdict and, honestly, exactly what this shop learned.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  requestDcApiCredential,
  walletPresentLink,
  type DcApiOutcome,
  type PresentationRequest,
} from "@vgw/protocols";
import { clientWalletOrigin } from "../walletOrigin";

/** Mirrors the Worker's VerificationSessionBody (wire contract, not import). */
export interface VerificationSession {
  session_id: string;
  status_url: string;
  request: PresentationRequest;
  wallet_link?: string;
}

/** Mirrors the Worker's SessionStatus. */
export type SessionStatus =
  | { status: "pending" }
  | {
      status: "verified" | "failed";
      verdict?: "allowed" | "denied";
      reason: string;
      disclosed: Record<string, unknown>;
      vpToken?: unknown;
      completedAt: number;
    };

export type GateOutcome = Exclude<SessionStatus, { status: "pending" }>;

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type Phase =
  | { kind: "starting" }
  | { kind: "start-failed"; error: string }
  | { kind: "awaiting"; session: VerificationSession; dcApi: DcApiOutcome | null }
  | { kind: "resumed"; sessionId: string }
  | { kind: "done"; outcome: GateOutcome; session: VerificationSession | null }
  | { kind: "timed-out" };

function describeDcApi(outcome: DcApiOutcome): string {
  switch (outcome.outcome) {
    case "unsupported":
      return "This browser doesn't expose the Digital Credentials API — falling back to the wallet link.";
    case "declined":
      return "The browser's credential sheet was dismissed or offered no matching wallet — falling back to the wallet link.";
    case "error":
      return `The Digital Credentials API answered with an error (${outcome.message}) — falling back to the wallet link.`;
    case "response":
      return "A platform wallet answered over the DC API — this demo verifies the OID4VP fallback path, so continue with the wallet link.";
  }
}

/**
 * Poll a session's status URL until it leaves `pending`, the timeout hits,
 * or the effect is torn down.
 */
function usePolledOutcome(
  statusUrl: string | null,
  onOutcome: (outcome: GateOutcome) => void,
  onTimeout: () => void,
) {
  // Keep the callbacks out of the effect's dependencies: re-running the
  // effect would double-poll, and the callers recreate closures per render.
  const callbacks = useRef({ onOutcome, onTimeout });
  callbacks.current = { onOutcome, onTimeout };

  useEffect(() => {
    if (statusUrl === null) return;
    let cancelled = false;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        callbacks.current.onTimeout();
        return;
      }
      try {
        const response = await fetch(statusUrl);
        if (response.ok) {
          const status = (await response.json()) as SessionStatus;
          if (status.status !== "pending") {
            if (!cancelled) callbacks.current.onOutcome(status);
            return;
          }
        }
      } catch {
        // Transient network error — keep polling until the timeout.
      }
      if (!cancelled) setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
    };
  }, [statusUrl]);
}

function QrCode({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (dataUrl === null) return null;
  return (
    <img
      src={dataUrl}
      alt="QR code opening this verification request in VeryGoodWallet on another device"
      className="size-44 rounded-xl border border-line bg-white p-1.5"
    />
  );
}

/** Collapsible raw-JSON exhibit — every app in the demo shows its wire traffic. */
function Inspector({ title, data }: { title: string; data: unknown }) {
  return (
    <details className="group mt-2 rounded-xl border border-line bg-canvas">
      <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted group-open:border-b group-open:border-line">
        {title}
      </summary>
      <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-ink-dim">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

/** The "what did the verifier actually learn" table — the point of the demo. */
function LearnedPanel({ outcome }: { outcome: GateOutcome }) {
  const entries = Object.entries(outcome.disclosed);
  return (
    <div className="mt-4 rounded-2xl border border-line bg-canvas p-4 text-left">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        What The Nightcap learned
      </p>
      {entries.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-dim">Nothing — the presentation failed before disclosure.</p>
      ) : (
        <dl className="mt-2 space-y-1.5">
          {entries.map(([claim, value]) => (
            <div key={claim} className="flex items-baseline justify-between gap-4">
              <dt className="font-mono text-[12px] text-ink-dim">{claim}</dt>
              <dd className="break-all text-right font-mono text-[12px] text-ink">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
        {outcome.reason}
      </p>
    </div>
  );
}

export function AgeGate({
  resumeSessionId,
  onVerdict,
}: {
  /** Set when the page loaded with ?session= (same-device return / refresh). */
  resumeSessionId: string | null;
  onVerdict: (verdict: "allowed" | "denied" | null) => void;
}) {
  const [phase, setPhase] = useState<Phase | null>(
    resumeSessionId !== null ? { kind: "resumed", sessionId: resumeSessionId } : null,
  );
  const walletOrigin = clientWalletOrigin();

  const start = useCallback(async () => {
    setPhase({ kind: "starting" });
    onVerdict(null);
    let session: VerificationSession;
    try {
      const response = await fetch("/api/verification", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      session = (await response.json()) as VerificationSession;
    } catch (error) {
      setPhase({
        kind: "start-failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // The DC API attempt is an exhibit, not a gate: whatever it reports, the
    // OID4VP fallback below is the path that actually completes.
    setPhase({ kind: "awaiting", session, dcApi: null });
    const dcApi = await requestDcApiCredential(session.request);
    setPhase((current) =>
      current?.kind === "awaiting" && current.session.session_id === session.session_id
        ? { ...current, dcApi }
        : current,
    );
  }, [onVerdict]);

  const statusUrl =
    phase?.kind === "awaiting"
      ? phase.session.status_url
      : phase?.kind === "resumed"
        ? `/api/verification/${encodeURIComponent(phase.sessionId)}`
        : null;

  usePolledOutcome(
    statusUrl,
    (outcome) => {
      setPhase((current) => ({
        kind: "done",
        outcome,
        session: current?.kind === "awaiting" ? current.session : null,
      }));
      onVerdict(outcome.status === "verified" ? (outcome.verdict ?? null) : null);
    },
    () => setPhase({ kind: "timed-out" }),
  );

  // Wallet link: prefer building against the client-side wallet origin
  // (supports the ?wallet= override); the server's wallet_link is the
  // fallback for when no client-side origin is known.
  const walletLink = (session: VerificationSession): string | null => {
    if (walletOrigin !== null) {
      return walletPresentLink(walletOrigin, session.request);
    }
    return session.wallet_link ?? null;
  };

  if (phase === null) {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          Age check · 18+
        </p>
        <h2 className="mt-2 font-display text-2xl text-ink">
          Prove it without showing it.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-dim">
          The Nightcap asks your wallet one question — <span className="font-mono">age_over_18</span>.
          Your name, birthdate and license number stay in your pocket.
        </p>
        <button
          type="button"
          onClick={() => void start()}
          className="mt-5 rounded-2xl bg-accent px-6 py-3 text-[15px] font-semibold text-accent-contrast transition-opacity hover:opacity-90"
        >
          Verify with VeryGoodWallet
        </button>
        {walletOrigin === null && (
          <p className="mx-auto mt-4 max-w-md rounded-xl bg-danger-soft px-4 py-3 text-[12px] leading-relaxed text-danger">
            No wallet origin is configured for this deployment (VITE_WALLET_ORIGIN) —
            the verification link can't be built. Append <span className="font-mono">?wallet=&lt;origin&gt;</span> to
            override.
          </p>
        )}
      </div>
    );
  }

  if (phase.kind === "starting") {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 text-center text-[13px] text-ink-dim">
        Starting a verification session…
      </div>
    );
  }

  if (phase.kind === "start-failed") {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 text-center">
        <p className="text-[13px] text-danger">
          Couldn't start the verification session: {phase.error}
        </p>
        <button
          type="button"
          onClick={() => void start()}
          className="mt-4 rounded-2xl bg-accent px-5 py-2.5 text-[14px] font-semibold text-accent-contrast"
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase.kind === "resumed") {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 text-center" aria-live="polite">
        <p className="text-[13px] text-ink-dim">Checking your verification…</p>
      </div>
    );
  }

  if (phase.kind === "timed-out") {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 text-center">
        <p className="text-[13px] text-ink-dim">
          No response arrived within five minutes — the request expired.
        </p>
        <button
          type="button"
          onClick={() => void start()}
          className="mt-4 rounded-2xl bg-accent px-5 py-2.5 text-[14px] font-semibold text-accent-contrast"
        >
          Start over
        </button>
      </div>
    );
  }

  if (phase.kind === "awaiting") {
    const link = walletLink(phase.session);
    return (
      <div className="rounded-3xl border border-line bg-surface p-6" aria-live="polite">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          Age check · waiting for your wallet
        </p>

        {phase.dcApi !== null && (
          <p className="mx-auto mt-3 max-w-lg rounded-xl bg-accent-soft px-4 py-3 text-[12px] leading-relaxed text-ink-dim">
            <span className="font-semibold text-ink">Digital Credentials API:</span>{" "}
            {describeDcApi(phase.dcApi)}{" "}
            <span className="text-muted">
              (Browser-native wallet selection exists, but web wallets can't register as
              providers yet — that gap is part of this exhibit.)
            </span>
          </p>
        )}

        <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          {link !== null && (
            <>
              <div className="flex flex-col items-center gap-2">
                <QrCode value={link} />
                <p className="text-[12px] text-muted">Scan with your phone's wallet</p>
              </div>
              <div className="text-center text-[13px] text-muted sm:px-2">or</div>
              <a
                href={link}
                className="rounded-2xl bg-accent px-6 py-3 text-[15px] font-semibold text-accent-contrast transition-opacity hover:opacity-90"
              >
                Open VeryGoodWallet here
              </a>
            </>
          )}
          {link === null && (
            <p className="rounded-xl bg-danger-soft px-4 py-3 text-[12px] text-danger">
              No wallet origin configured — see the note above.
            </p>
          )}
        </div>

        <p className="mt-5 text-center text-[12px] text-muted">
          This page keeps checking for the wallet's response — cross-device answers land
          here automatically.
        </p>
        <Inspector title="OID4VP authorization request" data={phase.session.request} />
      </div>
    );
  }

  // phase.kind === "done"
  const { outcome } = phase;
  const allowed = outcome.status === "verified" && outcome.verdict === "allowed";
  const denied = outcome.status === "verified" && outcome.verdict === "denied";
  return (
    <div className="rounded-3xl border border-line bg-surface p-6 text-center" aria-live="polite">
      {allowed && (
        <>
          <p className="neon font-mono text-lg font-semibold uppercase tracking-[0.3em]">
            ● Open for you
          </p>
          <h2 className="mt-2 font-display text-2xl text-ink">Verified — 18 or over.</h2>
        </>
      )}
      {denied && (
        <>
          <p className="font-mono text-lg font-semibold uppercase tracking-[0.3em] text-danger">
            ● No sale
          </p>
          <h2 className="mt-2 font-display text-2xl text-ink">
            The license says not yet.
          </h2>
        </>
      )}
      {outcome.status === "failed" && (
        <>
          <p className="font-mono text-lg font-semibold uppercase tracking-[0.3em] text-danger">
            ● Couldn't verify
          </p>
          <p className="mx-auto mt-2 max-w-lg break-words text-[13px] leading-relaxed text-ink-dim">
            {outcome.reason}
          </p>
        </>
      )}

      <LearnedPanel outcome={outcome} />

      {phase.session !== null && (
        <Inspector title="OID4VP authorization request" data={phase.session.request} />
      )}
      {outcome.vpToken !== undefined && (
        <Inspector title="vp_token (as received)" data={outcome.vpToken} />
      )}

      {!allowed && (
        <button
          type="button"
          onClick={() => void start()}
          className="mt-5 rounded-2xl bg-accent px-5 py-2.5 text-[14px] font-semibold text-accent-contrast"
        >
          Try again
        </button>
      )}
    </div>
  );
}
