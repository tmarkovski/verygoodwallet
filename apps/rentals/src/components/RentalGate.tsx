/**
 * The driver-verification panel: one verification session from start to
 * outcome.
 *
 * Sequence: create a session on the Worker → show the OID4VP wallet link +
 * QR (the DC API exhibit lives at the shop; this counter goes straight to
 * the fallback that actually works) → poll the session until the wallet's
 * direct_post lands → render the verdict, exactly what this counter
 * learned, and the cross-verifier exhibit: which of it could ever be
 * correlated with another verifier's records, and which of it cannot.
 *
 * Since N3 the Worker verifies the WHOLE presentation server-side — credkit
 * range proofs need no WASM — so the verdict arrives final: no `zk_pending`,
 * no in-browser proof check, no split-runtime exhibit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { walletPresentLink, type PresentationRequest } from "@vgw/protocols";
import { nextTourStop, useTourStop, withTourParam } from "@vgw/tour";
import { clientWalletOrigin } from "../walletOrigin";

/** Mirrors the Worker's VerificationSessionBody (wire contract, not import). */
export interface VerificationSession {
  session_id: string;
  status_url: string;
  request: PresentationRequest;
  wallet_link?: string;
}

/** Mirrors the Worker's PredicateExhibit (wire contract, not import). */
export interface PredicatePayload {
  pointer: string;
  kind: "greaterOrEqual" | "lessOrEqual";
  bound: string;
  digits: number;
  cutoffIso: string;
}

/** Mirrors the Worker's SessionStatus. */
export type SessionStatus =
  | { status: "pending" }
  | {
      status: "verified" | "failed";
      verdict?: "allowed" | "denied";
      reason: string;
      disclosed: Record<string, unknown>;
      predicate?: PredicatePayload;
      vpToken?: unknown;
      completedAt: number;
    };

export type GateOutcome = Exclude<SessionStatus, { status: "pending" }>;

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type Phase =
  | { kind: "starting" }
  | { kind: "start-failed"; error: string }
  | { kind: "awaiting"; session: VerificationSession }
  | { kind: "resumed"; sessionId: string }
  | { kind: "done"; outcome: GateOutcome; session: VerificationSession | null }
  | { kind: "timed-out" };

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
    <details className="group mt-2 rounded-xl border border-line bg-surface">
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
    <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-left">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        What Utopia Wheels learned
      </p>
      {entries.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-dim">
          Nothing — the presentation failed before disclosure.
        </p>
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

/**
 * The cross-verifier exhibit — M5's teaching point, upgraded by the credkit
 * flip. This counter knows who you are (a rental agreement needs a name);
 * the demo's claim is narrower and stronger: NOTHING in the cryptography
 * lets this counter and the shop link their records. The only correlation
 * handles that exist are values you explicitly chose to disclose to both.
 */
function CorrelationPanel({ outcome }: { outcome: GateOutcome }) {
  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-left">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        Could this visit be linked to your shop visit?
      </p>
      <dl className="mt-2 space-y-2 text-[12px] leading-relaxed">
        <div>
          <dt className="font-semibold text-ink">The key that signed this presentation</dt>
          <dd className="text-ink-dim">
            doesn't exist: the presentation carries no holder identifier at all —
            no DID, no key, nothing for two verifiers to compare notes on.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">The proof bytes</dt>
          <dd className="text-ink-dim">
            are a fresh derivation — every presentation of the same license is
            cryptographically unlinkable to every other one, and an age proof
            hides the birthdate behind a per-presentation-randomized value.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">What COULD correlate</dt>
          <dd className="text-ink-dim">
            only the claim values above. This counter needed your name and license
            number for the rental agreement; the shop asked for neither. Your
            wallet's home screen shows the two verifiers' views side by side and
            draws that line exactly.
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The predicate-route exhibit: what the range proof established, and where
 * it was verified (entirely on the Worker — the N3 story).
 */
function PredicateExhibitPanel({ predicate }: { predicate: PredicatePayload }) {
  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-left">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        Range proof · verified on the server
      </p>
      <dl className="mt-2 space-y-1.5 text-[12px] leading-relaxed">
        <div>
          <dt className="font-semibold text-ink">What was proven</dt>
          <dd className="text-ink-dim">
            The license's hidden birth date is on or before{" "}
            <span className="font-mono">{predicate.cutoffIso}</span> — 25+ against{" "}
            <em>this request's</em> cutoff. Same hidden birthdate the shop's 18+
            proof used, different cutoff: precomputed flags freeze the thresholds
            the DMV guessed at issuance, but the predicate proves ANY cutoff live,
            and the date itself never left the wallet.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Where it was checked</dt>
          <dd className="text-ink-dim">
            Entirely on Utopia Wheels' Worker: the DMV's signature, the
            presentation proof (nonce + audience → no replay), and the range proof
            over the hidden value — one server-side verdict, no browser hand-off.
          </dd>
        </div>
      </dl>
      <Inspector title="Predicate (as restated by the verifier)" data={predicate} />
    </div>
  );
}

export function RentalGate({
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
  const tourStopId = useTourStop()?.id;

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
    setPhase({ kind: "awaiting", session });
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
      setPhase((current) => {
        const session = current?.kind === "awaiting" ? current.session : null;
        return { kind: "done", outcome, session };
      });
      onVerdict(outcome.status === "verified" ? (outcome.verdict ?? null) : null);
    },
    () => setPhase({ kind: "timed-out" }),
  );

  // Wallet link: prefer building against the client-side wallet origin
  // (supports the ?wallet= override); the server's wallet_link is the
  // fallback for when no client-side origin is known.
  const walletLink = (session: VerificationSession): string | null => {
    const link =
      walletOrigin !== null
        ? walletPresentLink(walletOrigin, session.request)
        : (session.wallet_link ?? null);
    // An active tour rides the link to the wallet's presentation stop.
    if (link === null || tourStopId !== "rentals") return link;
    const next = nextTourStop("rentals");
    return next !== null ? withTourParam(link, next.id) : link;
  };

  if (phase === null) {
    return (
      <div className="rounded-3xl border border-line bg-raised p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          Driver check · name + license + 25+
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-[0.02em] text-ink">
          Three answers. Not your life story.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-dim">
          The rental agreement needs your{" "}
          <span className="font-mono text-[12px]">name</span>, your{" "}
          <span className="font-mono text-[12px]">license number</span>, and proof
          you're over 25. Your birthdate, address, and everything else stay in
          your pocket.
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
            the verification link can't be built. Append{" "}
            <span className="font-mono">?wallet=&lt;origin&gt;</span> to override.
          </p>
        )}
      </div>
    );
  }

  if (phase.kind === "starting") {
    return (
      <div className="rounded-3xl border border-line bg-raised p-6 text-center text-[13px] text-ink-dim">
        Starting a verification session…
      </div>
    );
  }

  if (phase.kind === "start-failed") {
    return (
      <div className="rounded-3xl border border-line bg-raised p-6 text-center">
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
      <div className="rounded-3xl border border-line bg-raised p-6 text-center" aria-live="polite">
        <p className="text-[13px] text-ink-dim">Checking your verification…</p>
      </div>
    );
  }

  if (phase.kind === "timed-out") {
    return (
      <div className="rounded-3xl border border-line bg-raised p-6 text-center">
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
      <div className="rounded-3xl border border-line bg-raised p-6" aria-live="polite">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          Driver check · waiting for your wallet
        </p>

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
          This page keeps checking for the wallet's response — cross-device answers
          land here automatically.
        </p>
        <Inspector title="OID4VP authorization request" data={phase.session.request} />
      </div>
    );
  }

  // phase.kind === "done"
  const { outcome } = phase;
  const isPredicateOutcome = outcome.status === "verified" && outcome.predicate !== undefined;
  const allowed = outcome.status === "verified" && outcome.verdict === "allowed";
  const denied = outcome.status === "verified" && outcome.verdict === "denied";
  return (
    <div className="rounded-3xl border border-line bg-raised p-6 text-center" aria-live="polite">
      {allowed && (
        <div className="guide-sign mx-auto max-w-md px-6 py-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] opacity-90">
            Exit 25 · driver verified
          </p>
          <h2 className="mt-1.5 font-display text-2xl font-semibold uppercase tracking-[0.03em]">
            Cleared for pickup
          </h2>
          <p className="mt-1 text-[12px] opacity-90">
            {isPredicateOutcome
              ? "Over 25 — proven about a hidden birthdate, verified on the server."
              : "Over 25 — license on file."}
          </p>
        </div>
      )}
      {denied && (
        <>
          <p className="font-mono text-lg font-semibold uppercase tracking-[0.3em] text-danger">
            ● Not today
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold uppercase tracking-[0.03em] text-ink">
            The license says under 25.
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

      {outcome.status === "verified" && <CorrelationPanel outcome={outcome} />}

      {outcome.status === "verified" && outcome.predicate !== undefined && (
        <PredicateExhibitPanel predicate={outcome.predicate} />
      )}

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
