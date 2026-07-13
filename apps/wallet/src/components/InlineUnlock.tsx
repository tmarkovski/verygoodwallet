/**
 * Inline passkey unlock — same session `login` the Home lock screen uses,
 * but rendered in place so the current route's search params (a credential
 * offer, a presentation request) are never lost to a redirect. When `login`
 * resolves, the session context re-renders the host page straight into its
 * consent state.
 */

import { useState } from "react";
import { useSession } from "../session";
import type { AccountRecord } from "../services/db";
import { Button, ErrorNote, PrfBadge, SectionTitle, describeError } from "./ui";

export function InlineUnlock({ accounts }: { accounts: AccountRecord[] }) {
  const { login, lastAccountId } = useSession();
  const [selectedId, setSelectedId] = useState<number>(() => {
    const preferred = accounts.find((a) => a.id === lastAccountId) ?? accounts[0];
    return preferred?.id ?? -1;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];

  const unlock = async () => {
    if (selected === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(selected);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-3xl border border-line bg-surface p-5">
      <SectionTitle>Unlock to continue</SectionTitle>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
        Your wallet is locked. Unlock with your passkey — you'll stay right
        here, and the request will still be waiting.
      </p>

      {accounts.length > 1 ? (
        <ul className="mt-4 space-y-2">
          {accounts.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                onClick={() => setSelectedId(account.id)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm transition-colors ${
                  account.id === selected?.id
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-canvas hover:border-line-strong"
                }`}
              >
                <span className="font-medium">{account.name}</span>
                <PrfBadge prfSupported={account.prfSupported} />
              </button>
            </li>
          ))}
        </ul>
      ) : selected !== undefined ? (
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-line bg-canvas px-4 py-3 text-sm">
          <span className="font-medium">{selected.name}</span>
          <PrfBadge prfSupported={selected.prfSupported} />
        </div>
      ) : null}

      <Button onClick={() => void unlock()} busy={busy} className="mt-4 w-full">
        {busy ? "Waiting for passkey…" : "Unlock with passkey"}
      </Button>
      {error !== null && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </div>
  );
}
