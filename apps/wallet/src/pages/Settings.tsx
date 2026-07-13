/**
 * Settings: account info, PRF status, and the danger zone.
 */

import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { toBase64Url } from "@vgw/keys";
import { useSession } from "../session";
import { Button, PrfBadge, SectionTitle } from "../components/ui";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function formatDate(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Settings() {
  const { account, locked, logout, resetWallet } = useSession();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  if (locked || account === null) {
    return <Navigate to="/" replace />;
  }

  const credentialIdPreview = `${toBase64Url(account.credentialId).slice(0, 16)}…`;

  const wipe = async () => {
    setBusy(true);
    try {
      await resetWallet(() => setDeleteBlocked(true));
      await navigate("/welcome");
    } finally {
      setDeleteBlocked(false);
      setBusy(false);
    }
  };

  return (
    <div className="animate-rise">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-6">
        <SectionTitle>Account</SectionTitle>
        <div className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
          <Row label="Wallet name" value={account.name} />
          <Row
            label="Master secret"
            value={<PrfBadge prfSupported={account.prfSupported} />}
          />
          <Row
            label="Passkey credential id"
            value={<span className="font-mono text-xs">{credentialIdPreview}</span>}
          />
          <Row label="Created" value={formatDate(account.createdAt)} />
          <Row label="Last unlocked" value={formatDate(account.lastUsedAt)} />
        </div>
        {!account.prfSupported && (
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            This authenticator did not return PRF output, so the wallet uses a
            random master secret stored unencrypted on this device — in the
            same database as the encrypted credentials. That means anyone who
            can read this browser's data can decrypt them, and there is no
            passkey-sync recovery. Fine for the demo — not a real security
            model.
          </p>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle>Security model</SectionTitle>
        <div className="mt-3 rounded-2xl border border-line bg-surface px-5 py-4">
          <ul className="space-y-2 text-[13px] leading-relaxed text-ink-dim">
            {account.prfSupported ? (
              <li>
                The master secret is re-derived from the passkey on every
                unlock and held in memory only — refreshing the page locks the
                wallet.
              </li>
            ) : (
              <li>
                This account's master secret is loaded from this device's
                storage after passkey authentication — it is not derived
                inside the authenticator.
              </li>
            )}
            {account.prfSupported ? (
              <li>
                Credentials are stored AES-GCM-encrypted under a
                non-extractable vault key; only card titles are readable at
                rest.
              </li>
            ) : (
              <li>
                Credentials are AES-GCM-encrypted, but the vault key derives
                from the simulated master secret stored alongside them — so
                the encryption does not protect against anyone who can read
                this browser's data.
              </li>
            )}
            <li>Nothing ever leaves this device.</li>
          </ul>
          <Button variant="ghost" className="mt-4" onClick={() => { logout(); void navigate("/"); }}>
            Lock now
          </Button>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>Danger zone</SectionTitle>
        <div className="mt-3 rounded-2xl border border-danger/30 bg-surface px-5 py-4">
          <h3 className="text-sm font-semibold text-danger">Delete wallet data</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
            Removes every account and credential stored in this browser. The
            passkey itself stays in your password manager — remove it there if
            you want it gone too.
          </p>
          <div className="mt-4 flex gap-2">
            {confirming ? (
              <>
                <Button variant="danger" busy={busy} onClick={() => void wipe()}>
                  {busy ? "Deleting…" : "Yes, delete everything"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Delete wallet data
              </Button>
            )}
          </div>
          {deleteBlocked && (
            <p className="mt-3 text-[13px] leading-relaxed text-danger" role="alert">
              Another tab is holding the wallet database open — close other
              VeryGoodWallet tabs to finish deleting.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
