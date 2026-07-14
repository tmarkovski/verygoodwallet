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

/** Mirrors the Worker's ZkOutcomePayload (wire contract, not import). */
export interface ZkPayload {
  scheme: string;
  circuit: string;
  years: number;
  cutoffDays: number;
  commitment: string;
  proof: string;
}

/** Mirrors the Worker's SessionStatus. */
export type SessionStatus =
  | { status: "pending" }
  | {
      status: "verified" | "failed";
      verdict?: "allowed" | "denied" | "zk_pending";
      reason: string;
      disclosed: Record<string, unknown>;
      zk?: ZkPayload;
      vpToken?: unknown;
      completedAt: number;
    };

export type GateOutcome = Exclude<SessionStatus, { status: "pending" }>;

/** What THIS BROWSER established about a tier-2 proof (the final word). */
export interface ZkVerification {
  verified: boolean;
  verifyMs: number;
  vkHash: string;
  publicInputs: string[];
  /** Set when bb.js itself failed to load/run (distinct from "proof invalid"). */
  error?: string;
}

/**
 * The tier-2 handover: the Worker verified signatures, issuer, and the
 * proof's public-input bindings, then recorded the proof for the shop's own
 * client to check — bb.js can't run on the free-tier edge runtime (no
 * runtime WASM compilation, 3 MiB script cap), and pretending otherwise
 * would defeat the exhibit. A self-hosted verifier would make this exact
 * call server-side; the e2e suite does, in Node.
 */
async function verifyZkPayload(zk: ZkPayload): Promise<ZkVerification> {
  try {
    // The /verify subpath keeps the shop's build free of the PROVING stack
    // (noir_js + ACVM WASM) — verifiers verify, wallets prove.
    const { verifyAgeProof } = await import("@vgw/zk/verify");
    const result = await verifyAgeProof({
      proof: zk.proof,
      commitment: zk.commitment,
      cutoffDays: zk.cutoffDays,
    });
    return {
      verified: result.verified,
      verifyMs: result.verifyMs,
      vkHash: result.vkHash,
      publicInputs: result.publicInputs,
    };
  } catch (error) {
    return {
      verified: false,
      verifyMs: 0,
      vkHash: "",
      publicInputs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type Phase =
  | { kind: "starting" }
  | { kind: "start-failed"; error: string }
  | { kind: "awaiting"; session: VerificationSession; dcApi: DcApiOutcome | null }
  | { kind: "resumed"; sessionId: string }
  | { kind: "zk-verifying"; outcome: GateOutcome; session: VerificationSession | null }
  | {
      kind: "done";
      outcome: GateOutcome;
      session: VerificationSession | null;
      /** Present iff the outcome carried a tier-2 proof this browser checked. */
      zk?: ZkVerification;
    }
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

/**
 * Tier 2's "where did verification run" exhibit — the demo's teaching point
 * split honestly across the two runtimes that did the work.
 */
function ZkExhibit({ outcome, zk }: { outcome: GateOutcome; zk?: ZkVerification }) {
  const payload = outcome.status === "verified" ? outcome.zk : undefined;
  return (
    <div className="mt-4 rounded-2xl border border-line bg-canvas p-4 text-left">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        Zero-knowledge check · who verified what
      </p>
      <dl className="mt-2 space-y-1.5 text-[12px] leading-relaxed">
        <div>
          <dt className="font-semibold text-ink">The Nightcap's Worker verified</dt>
          <dd className="text-ink-dim">
            the DMV's BBS signature over the disclosed commitment, the wallet's
            presentation signature (nonce + audience → no replay), that the proof's
            commitment IS the one the DMV signed, and that its cutoff matches today's
            18+ policy.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">This browser verified</dt>
          <dd className="text-ink-dim">
            {zk === undefined ? (
              "…still running."
            ) : zk.verified ? (
              <>
                the UltraHonk proof itself ({payload?.scheme}, circuit{" "}
                <span className="font-mono">{payload?.circuit}</span>) in {zk.verifyMs} ms,
                against the shop's built-in verification key{" "}
                <span className="font-mono break-all">sha256:{zk.vkHash.slice(0, 16)}…</span>
              </>
            ) : (
              "the UltraHonk proof — and it did NOT verify."
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
        Why split? The proof verifier is ~10 MB of WASM that Cloudflare's free-tier
        Worker can neither ship nor instantiate at runtime — so the shop's own client
        runs it (a self-hosted verifier would make the same call server-side, as this
        demo's e2e suite does in Node). Unlike the age_over_18 flag — frozen at
        issuance for cutoffs the DMV guessed in advance — this proof was generated
        against <em>today's</em> cutoff, from a birthdate that never left the wallet.
      </p>
      {zk !== undefined && zk.publicInputs.length > 0 && (
        <Inspector
          title="ZK public inputs [commitment, cutoff_days]"
          data={{ publicInputs: zk.publicInputs, vkHash: zk.vkHash, verifyMs: zk.verifyMs }}
        />
      )}
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
      const zkPayload =
        outcome.status === "verified" && outcome.verdict === "zk_pending"
          ? outcome.zk
          : undefined;
      setPhase((current) => {
        const session = current?.kind === "awaiting" ? current.session : null;
        return zkPayload !== undefined
          ? { kind: "zk-verifying", outcome, session }
          : { kind: "done", outcome, session };
      });
      if (zkPayload !== undefined) {
        // The Worker's checks passed; the UltraHonk proof is this browser's
        // to verify (see verifyZkPayload) — the verdict waits for it.
        void verifyZkPayload(zkPayload).then((zk) => {
          setPhase((current) =>
            current?.kind === "zk-verifying" && current.outcome === outcome
              ? { kind: "done", outcome, session: current.session, zk }
              : current,
          );
          onVerdict(zk.verified ? "allowed" : null);
        });
        return;
      }
      onVerdict(
        outcome.status === "verified" && outcome.verdict !== "zk_pending"
          ? (outcome.verdict ?? null)
          : null,
      );
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

  if (phase.kind === "zk-verifying") {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 text-center" aria-live="polite">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          Age check · zero-knowledge proof
        </p>
        <p className="mt-3 text-[13px] text-ink-dim">
          Verifying the UltraHonk proof in this browser…
        </p>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-muted">
          The Worker already checked the signatures and that the proof is about the
          commitment the DMV signed — the proof itself is checked right here.
        </p>
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
  const { outcome, zk } = phase;
  const isZkOutcome = outcome.status === "verified" && outcome.verdict === "zk_pending";
  const allowed =
    outcome.status === "verified" &&
    (outcome.verdict === "allowed" || (isZkOutcome && zk?.verified === true));
  const denied = outcome.status === "verified" && outcome.verdict === "denied";
  const zkFailed = isZkOutcome && zk?.verified !== true;
  return (
    <div className="rounded-3xl border border-line bg-surface p-6 text-center" aria-live="polite">
      {allowed && (
        <>
          <p className="neon font-mono text-lg font-semibold uppercase tracking-[0.3em]">
            ● Open for you
          </p>
          <h2 className="mt-2 font-display text-2xl text-ink">
            {isZkOutcome ? "Proven — 18 or over. Nothing else." : "Verified — 18 or over."}
          </h2>
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
      {(outcome.status === "failed" || zkFailed) && (
        <>
          <p className="font-mono text-lg font-semibold uppercase tracking-[0.3em] text-danger">
            ● Couldn't verify
          </p>
          <p className="mx-auto mt-2 max-w-lg break-words text-[13px] leading-relaxed text-ink-dim">
            {outcome.status === "failed"
              ? outcome.reason
              : zk?.error !== undefined
                ? `The proof verifier could not run in this browser: ${zk.error}`
                : "The zero-knowledge proof did not verify — the presentation is not accepted."}
          </p>
        </>
      )}

      <LearnedPanel outcome={outcome} />

      {isZkOutcome && <ZkExhibit outcome={outcome} zk={zk} />}

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
