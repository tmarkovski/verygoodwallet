/**
 * Home: locked screen (passkey login) when there's no session, else the
 * credential card stack.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { decryptJson } from "@vgw/keys";
import { useSession } from "../session";
import {
  listCredentials,
  type AccountRecord,
  type CredentialPayload,
  type CredentialRecord,
} from "../services/db";
import { cardFace, type CardFace } from "../services/meta";
import { addDemoCredential } from "../services/demo";
import { CredentialCard } from "../components/CredentialCard";
import { VerifierViews } from "../components/VerifierViews";
import { Button, ErrorNote, PrfBadge, SectionTitle, Spinner, describeError } from "../components/ui";
import emblem from "../assets/utopia-emblem.png";

function LockScreen({ accounts }: { accounts: AccountRecord[] }) {
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
    <div className="mx-auto max-w-sm animate-rise pt-10 text-center">
      <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Wallet locked</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-dim">
        Your keys only exist while you're authenticated. Unlock with your
        passkey to re-derive them.
      </p>

      {accounts.length > 1 && (
        <ul className="mt-6 space-y-2 text-left">
          {accounts.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                onClick={() => setSelectedId(account.id)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm transition-colors ${
                  account.id === selected?.id
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-surface hover:border-line-strong"
                }`}
              >
                <span className="font-medium">{account.name}</span>
                <PrfBadge prfSupported={account.prfSupported} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {accounts.length === 1 && selected !== undefined && (
        <div className="mt-6 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <span className="font-medium">{selected.name}</span>
          <PrfBadge prfSupported={selected.prfSupported} />
        </div>
      )}

      <Button onClick={() => void unlock()} busy={busy} className="mt-6 w-full">
        {busy ? "Waiting for passkey…" : "Unlock with passkey"}
      </Button>
      {error !== null && <div className="mt-3 text-left"><ErrorNote>{error}</ErrorNote></div>}

      <p className="mt-6 text-xs text-muted">
        Need a fresh start?{" "}
        <Link
          to="/welcome"
          className="text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
        >
          Create another wallet
        </Link>
      </p>
    </div>
  );
}

function EmptyState({ onAdd, busy }: { onAdd: () => void; busy: boolean }) {
  return (
    <div className="animate-rise rounded-3xl border border-dashed border-line-strong px-8 py-14 text-center">
      <img src={emblem} alt="" className="mx-auto size-16 opacity-40 grayscale" draggable={false} />
      <h2 className="mt-5 text-lg font-semibold">No credentials yet</h2>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-dim">
        Until the Utopia DMV portal opens, issue yourself a demo driver's
        license — blind-signed locally on the credkit BBS suite and stored
        encrypted.
      </p>
      <Button onClick={onAdd} busy={busy} className="mt-6">
        {busy ? "Issuing…" : "Add demo credential"}
      </Button>
    </div>
  );
}

function CredentialList() {
  const { account, masterSecret, vaultKey } = useSession();
  const [records, setRecords] = useState<CredentialRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const accountId = account?.id;

  const refresh = useCallback(async () => {
    if (accountId === undefined) return;
    try {
      setRecords(await listCredentials(accountId));
      setLoadError(null);
    } catch (err) {
      // Surface a read failure instead of leaving the spinner up forever.
      setLoadError(describeError(err));
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Card faces (holder + document fields) come from the DECRYPTED payloads,
  // best-effort: with no vault key — or on any decrypt hiccup — the cards
  // simply render their generic plates from plaintext meta.
  const [faces, setFaces] = useState<Record<number, CardFace>>({});
  useEffect(() => {
    if (records === null || vaultKey === null) return;
    let cancelled = false;
    void (async () => {
      const loaded: Record<number, CardFace> = {};
      for (const record of records) {
        try {
          const payload = await decryptJson<CredentialPayload>(vaultKey, record.payload);
          const face = cardFace(payload.vc);
          if (face !== null) loaded[record.id] = face;
        } catch {
          // Face is a bonus — never fail the list over it.
        }
      }
      if (!cancelled) setFaces(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [records, vaultKey]);

  const addDemo = async () => {
    if (accountId === undefined || masterSecret === null || vaultKey === null || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addDemoCredential({ accountId, masterSecret, vaultKey });
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (records === null) {
    if (loadError !== null) {
      return (
        <div className="mx-auto max-w-sm pt-10">
          <ErrorNote>Couldn't load your credentials: {loadError}</ErrorNote>
        </div>
      );
    }
    return (
      <div className="flex justify-center pt-20 text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <SectionTitle>Credentials</SectionTitle>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {records.length === 0
              ? "Your wallet"
              : `${records.length} credential${records.length === 1 ? "" : "s"}`}
          </h1>
        </div>
        {records.length > 0 && (
          <Button variant="ghost" onClick={() => void addDemo()} busy={busy} className="shrink-0">
            {busy ? "Issuing…" : "+ Demo credential"}
          </Button>
        )}
      </div>

      {error !== null && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {records.length === 0 ? (
        <EmptyState onAdd={() => void addDemo()} busy={busy} />
      ) : (
        <ul className="mx-auto max-w-md">
          {records.map((record, index) => (
            <li
              key={record.id}
              className={index === 0 ? "" : "-mt-[46%]"}
              style={{ zIndex: index + 1, position: "relative" }}
            >
              <Link
                to={`/credentials/${record.id}`}
                className="block rounded-3xl transition-transform duration-300 ease-out hover:-translate-y-2 focus-visible:-translate-y-2 active:scale-[0.99]"
              >
                <CredentialCard meta={record.meta} face={faces[record.id]} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <VerifierViews />
    </div>
  );
}

export function Home() {
  const { accounts, accountsError, locked } = useSession();

  if (accounts === null) {
    if (accountsError !== null) {
      return (
        <div className="mx-auto max-w-sm pt-24">
          <ErrorNote>
            Couldn't open the wallet's local database: {accountsError}. The
            wallet needs IndexedDB — this browser or browsing mode may be
            blocking local storage.
          </ErrorNote>
        </div>
      );
    }
    return (
      <div className="flex justify-center pt-24 text-muted">
        <Spinner />
      </div>
    );
  }

  if (accounts.length === 0) {
    return <Navigate to="/welcome" replace />;
  }

  if (locked) {
    return <LockScreen accounts={accounts} />;
  }

  return <CredentialList />;
}
