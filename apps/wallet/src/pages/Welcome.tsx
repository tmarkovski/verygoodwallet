/**
 * Onboarding: the thesis, plus the create-wallet passkey flow.
 */

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { WalletCreatedError, useSession } from "../session";
import type { AccountRecord } from "../services/db";
import { passkeysAvailable } from "../services/webauthn";
import { Button, ErrorNote, describeError } from "../components/ui";

function Step({
  title,
  children,
  icon,
}: {
  title: string;
  children: string;
  icon: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{children}</p>
      </div>
    </li>
  );
}

export function Welcome() {
  const { accounts, createWallet, login } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the passkey/account were created but the automatic sign-in was
  // rejected (macOS can refuse a `get()` fired while the creation sheet is
  // still dismissing). The click on "Sign in" retries with fresh activation.
  const [created, setCreated] = useState<AccountRecord | null>(null);

  const available = passkeysAvailable();
  const hasAccounts = accounts !== null && accounts.length > 0;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createWallet(trimmed);
      await navigate("/");
    } catch (err) {
      if (err instanceof WalletCreatedError) {
        setCreated(err.account);
      } else {
        setError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const onSignIn = async () => {
    if (created === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(created);
      await navigate("/");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-rise">
      <section className="relative pb-10 pt-6 text-center">
        {/* Engraved rosette — the hero's single ambient flourish. Static and
            CSS-only; the petrol/paper ground shows through the line-work. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
          style={{
            background:
              "repeating-radial-gradient(circle, transparent 0 9px, var(--vgw-gold-soft) 9px 10px)",
            maskImage:
              "radial-gradient(circle, rgb(0 0 0) 25%, transparent 68%)",
            WebkitMaskImage:
              "radial-gradient(circle, rgb(0 0 0) 25%, transparent 68%)",
          }}
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
          Passkey-native identity
        </p>
        <h1 className="mx-auto mt-4 max-w-md text-balance text-4xl font-semibold leading-[1.1] tracking-tight">
          Your passkey <em>is</em> your wallet.
        </h1>
        {/* Fine gold rule beneath the thesis line. */}
        <div
          aria-hidden="true"
          className="mx-auto mt-5 flex max-w-md items-center justify-center gap-2"
        >
          <span className="h-px w-16 bg-gradient-to-r from-transparent to-gold/60" />
          <span className="size-1 rotate-45 bg-gold/80" />
          <span className="h-px w-16 bg-gradient-to-l from-transparent to-gold/60" />
        </div>
        <p className="mx-auto mt-5 max-w-md text-pretty text-[15px] leading-relaxed text-ink-dim">
          No seed phrase, no custodian. Your passkey's PRF output derives the
          wallet's entire key hierarchy, and passkey sync gives you backup and
          multi-device recovery for free.
        </p>
      </section>

      <section className="mx-auto max-w-sm">
        {created !== null ? (
          <div className="rounded-3xl border border-line bg-surface p-6 shadow-lg">
            <h2 className="text-center text-sm font-semibold">
              Your wallet was created
            </h2>
            <p className="mt-2 text-center text-[13px] leading-relaxed text-ink-dim">
              The passkey for <span className="font-medium text-ink">{created.name}</span>{" "}
              is saved. Sign in with it to unlock your wallet.
            </p>
            <Button
              type="button"
              busy={busy}
              onClick={() => void onSignIn()}
              className="mt-4 w-full"
            >
              {busy ? "Waiting for your passkey…" : "Sign in"}
            </Button>
            {error !== null && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
          </div>
        ) : (
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="rounded-3xl border border-line bg-surface p-6 shadow-lg"
        >
          <label htmlFor="wallet-name" className="text-[13px] font-medium text-ink-dim">
            Name your wallet
          </label>
          <input
            id="wallet-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jamie's wallet"
            autoComplete="off"
            maxLength={64}
            className="mt-2 w-full rounded-xl border border-line-strong bg-canvas px-4 py-3 text-sm text-ink placeholder:text-muted"
          />
          <Button
            type="submit"
            busy={busy}
            disabled={!available || name.trim().length === 0}
            className="mt-4 w-full"
          >
            {busy ? "Creating passkey…" : "Create your wallet"}
          </Button>
          {!available && (
            <p className="mt-3 text-center text-xs text-danger">
              Passkeys are unavailable here — this page needs a secure context
              (https or localhost) and a WebAuthn-capable browser.
            </p>
          )}
          {error !== null && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
            You'll confirm twice: once to create the passkey, once to unlock —
            PRF output is only released during authentication.
          </p>
        </form>
        )}

        {hasAccounts && (
          <p className="mt-4 text-center text-sm text-ink-dim">
            Already set up on this device?{" "}
            <Link
              to="/"
              className="font-medium text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
            >
              Unlock your wallet
            </Link>
          </p>
        )}
      </section>

      <section className="mx-auto mt-12 max-w-sm">
        <ol className="space-y-3">
          <Step
            title="One passkey, whole wallet"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="4.25" stroke="currentColor" strokeWidth="1.8" />
                <path d="M11 11l8.5 8.5M16 16l2.5-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            }
          >
            The passkey's PRF output feeds an HKDF tree: vault key, one
            lifelong link secret, per-issuer issuance keys. Nothing to back
            up.
          </Step>
          <Step
            title="Encrypted at rest"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            }
          >
            Credentials are sealed with AES-GCM under a key that exists only
            while the wallet is unlocked. Refresh the page and it's locked.
          </Step>
          <Step
            title="Selective disclosure"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            }
          >
            BBS signatures (credkit) let you reveal single claims, or prove
            facts about hidden ones — and each presentation is unlinkable
            from the last.
          </Step>
        </ol>
      </section>
    </div>
  );
}
