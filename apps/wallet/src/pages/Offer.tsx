/**
 * /offer — the wallet half of the OID4VCI issuance ceremony.
 *
 * An issuer's wallet_link lands here with `credential_offer_uri` in the query
 * string. The page previews who is offering what BEFORE any key material is
 * touched, and the offer params survive the whole ceremony: unlocking happens
 * inline (no redirect) so a locked wallet can still accept the offer it was
 * opened with.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useSession } from "../session";
import type { AccountRecord } from "../services/db";
import {
  ISSUANCE_STEPS,
  acceptCredentialOffer,
  isInsecureIssuerOrigin,
  parseOfferParams,
  previewCredentialOffer,
  type IssuanceStep,
  type OfferPreview,
} from "../services/issuance";
import {
  Button,
  ErrorNote,
  PrfBadge,
  SectionTitle,
  Spinner,
  describeError,
} from "../components/ui";

/**
 * Inline passkey unlock — same session `login` the Home lock screen uses,
 * but rendered in place so the offer's search params are never lost to a
 * redirect. When `login` resolves, the session context re-renders this page
 * straight into the consent state.
 */
function InlineUnlock({ accounts }: { accounts: AccountRecord[] }) {
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
        here, and the offer will still be waiting.
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

/** In-flight protocol progress, driven by `acceptCredentialOffer`'s onStep. */
function StepList({ current }: { current: IssuanceStep | null }) {
  const activeIndex =
    current === null ? -1 : ISSUANCE_STEPS.findIndex((s) => s.id === current);
  return (
    <div className="mt-6 animate-fade rounded-3xl border border-line bg-surface p-5">
      <SectionTitle>Issuing</SectionTitle>
      <ol className="mt-3 space-y-2.5">
        {ISSUANCE_STEPS.map((s, index) => {
          const state =
            index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
          return (
            <li
              key={s.id}
              className={`flex items-center gap-2.5 text-[13px] ${
                state === "pending" ? "text-muted" : "text-ink"
              }`}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {state === "done" ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className="text-ok"
                  >
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : state === "active" ? (
                  <Spinner />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              {s.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Offer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    accounts,
    accountsError,
    locked,
    account,
    masterSecret,
    vaultKey,
    lockSignal,
  } = useSession();

  const params = useMemo(() => parseOfferParams(searchParams), [searchParams]);

  const [preview, setPreview] = useState<OfferPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<IssuanceStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Preview loads immediately — even while locked — so the user can see who
  // is asking before deciding whether to unlock at all.
  useEffect(() => {
    if (params.kind !== "uri" && params.kind !== "inline") return;
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    void (async () => {
      try {
        const loaded = await previewCredentialOffer(
          params.kind === "uri" ? { offerUri: params.offerUri } : { offer: params.offer },
        );
        if (!cancelled) setPreview(loaded);
      } catch (err) {
        if (!cancelled) setPreviewError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, previewAttempt]);

  const accept = async () => {
    if (
      preview === null ||
      account === null ||
      masterSecret === null ||
      vaultKey === null ||
      running
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setStep(null);
    try {
      const record = await acceptCredentialOffer({
        offer: preview.offer,
        metadata: preview.metadata,
        accountId: account.id,
        masterSecret,
        vaultKey,
        // Locking the wallet mid-ceremony aborts the flow before it can sign
        // or store anything with the (now zeroed) session secret.
        signal: lockSignal ?? undefined,
        onStep: setStep,
      });
      await navigate(`/credentials/${record.id}`);
    } catch (err) {
      setError(describeError(err));
      setRunning(false);
    }
  };

  if (params.kind === "missing" || params.kind === "invalid") {
    return (
      <div className="mx-auto max-w-sm animate-rise pt-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          No credential offer here
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          This page accepts credential offers from an issuer — it expects a{" "}
          <span className="font-mono text-[12px]">credential_offer_uri</span>{" "}
          link, usually opened from an issuer's site or QR code.
        </p>
        {params.kind === "invalid" && (
          <p className="mt-3 break-all font-mono text-[12px] text-danger">
            {params.reason}
          </p>
        )}
        <Link
          to="/"
          className="mt-5 inline-block text-sm text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
        >
          Back to wallet
        </Link>
      </div>
    );
  }

  if (accounts === null) {
    if (accountsError !== null) {
      return (
        <div className="mx-auto max-w-sm pt-24">
          <ErrorNote>
            Couldn't open the wallet's local database: {accountsError}.
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

  const insecure = preview !== null && isInsecureIssuerOrigin(preview.issuerOrigin);

  return (
    <div className="mx-auto max-w-md animate-rise">
      <SectionTitle>Credential offer</SectionTitle>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Add a credential
      </h1>

      {previewError !== null ? (
        <div className="mt-6">
          <ErrorNote>Couldn't load the offer: {previewError}</ErrorNote>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setPreviewAttempt((n) => n + 1)}>Try again</Button>
            <Button variant="ghost" onClick={() => void navigate("/")}>
              Decline
            </Button>
          </div>
        </div>
      ) : preview === null ? (
        <div className="flex justify-center pt-16 text-muted">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-3xl border border-line bg-surface p-6">
            {/* Gold marks authority — the issuer's name is an eyebrow, never a control. */}
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
              {preview.issuerName}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              {preview.credentialName}
            </h2>
            <p className="mt-2 break-all font-mono text-[13px] text-ink-dim">
              {preview.issuerOrigin}
            </p>

            {insecure && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-[13px] leading-relaxed text-danger"
              >
                This issuer uses plain{" "}
                <span className="font-mono">http://</span> on a non-local
                address — the access token and your new credential would cross
                the network unencrypted. Only continue if you trust it.
              </p>
            )}

            <p className="mt-4 text-[13px] leading-relaxed text-ink-dim">
              Accepting redeems the offer's one-time code for an access token,
              proves possession of a fresh pairwise key derived only for this
              issuer, then verifies the issuer's signature on the credential
              before storing it encrypted in your vault.
            </p>
          </div>

          {accounts.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-line-strong p-5 text-sm leading-relaxed text-ink-dim">
              You need a wallet on this device before you can accept.{" "}
              <Link
                to="/welcome"
                className="font-medium text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
              >
                Create your wallet
              </Link>
              , then open this offer link again.
            </div>
          ) : locked ? (
            <InlineUnlock accounts={accounts} />
          ) : running ? (
            <StepList current={step} />
          ) : (
            <div className="mt-6">
              {error !== null && (
                <div className="mb-4">
                  <ErrorNote>{error}</ErrorNote>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={() => void accept()}>
                  {error !== null ? "Try again" : "Add to wallet"}
                </Button>
                <Button variant="ghost" onClick={() => void navigate("/")}>
                  Decline
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
