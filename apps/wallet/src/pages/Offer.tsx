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
import {
  ISSUANCE_STEPS,
  acceptCredentialOffer,
  isInsecureIssuerOrigin,
  parseOfferParams,
  previewCredentialOffer,
  type IssuanceStep,
  type OfferPreview,
} from "../services/issuance";
import { InlineUnlock } from "../components/InlineUnlock";
import { StepList } from "../components/StepList";
import { createPacedStepper } from "../components/pacedStepper";
import { Button, ErrorNote, SectionTitle, Spinner, describeError } from "../components/ui";

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
    // Pace the checklist: fast phases would otherwise checkmark in a blink.
    const stepper = createPacedStepper(setStep);
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
        onStep: stepper.step,
      });
      // Let the checklist finish playing before leaving the page.
      await stepper.settled();
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
              sends a blind commitment to your wallet's link secret (the
              issuer signs it without ever seeing it), proves possession of a
              fresh pairwise key derived only for this issuer, then verifies
              the issuer's blind signature before storing the credential
              encrypted in your vault.
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
            <StepList title="Issuing" steps={ISSUANCE_STEPS} current={step} />
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
