/**
 * /present — the wallet half of the OID4VP presentation ceremony.
 *
 * A verifier's wallet link lands here with the whole unsigned authorization
 * request in the query string. The page shows who is asking and for what
 * BEFORE any key material is touched, matches the DCQL query against the
 * vault, and offers the demo's disclosure-tier picker: full disclosure,
 * selective disclosure, or (disabled until M4) the ZK predicate.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { nextTourStop, useTourStop, withTourParam } from "@vgw/tour";
import { useSession } from "../session";
import { decryptJson } from "@vgw/keys";
import type { VerifiableCredential } from "@vgw/vc-kit";
import { isInsecureIssuerOrigin } from "../services/issuance";
import {
  disclosurePreview,
  hasEmbeddedSubjectId,
  matchCredentials,
  parsePresentParams,
  presentCredential,
  presentationSteps,
  previewPresentationRequest,
  zkAgeOption,
  type CandidateCredential,
  type DisclosureTier,
  type PresentCredentialResult,
  type PresentationStep,
  type QueryCandidates,
  type ZkAgeOption,
} from "../services/presentation";
// TODO(N3): the presentation path still speaks the legacy envelope; v3
// (credkit) payloads decrypt fine but cannot be presented until N3 rewires
// presentation.ts to credkit deriveProof/presentGraph (MIGRATION §12).
import { listCredentials, type LegacyCredentialPayload } from "../services/db";
import { recordPresentation } from "../services/activity";
import { inspect } from "../inspector/events";
import { InlineUnlock } from "../components/InlineUnlock";
import { StepList } from "../components/StepList";
import { Button, ErrorNote, SectionTitle, Spinner, describeError } from "../components/ui";

/** The tier picker's rows; tier 2 depends on the request and the credential. */
function tierRows(zk: ZkAgeOption | null): {
  tier: DisclosureTier;
  title: string;
  detail: string;
  disabled?: boolean;
}[] {
  return [
    {
      tier: 0,
      title: "Show everything",
      detail:
        "Full disclosure — every field on the license. Today's status quo: handing over the card.",
    },
    {
      tier: 1,
      title: "Share only what's asked",
      detail:
        "BBS selective disclosure — just the claims below, unlinkable across presentations.",
    },
    zk !== null && zk.available
      ? {
          tier: 2,
          title: "Prove the age, never the date",
          detail: `A zero-knowledge proof that you're over ${zk.years}, computed against today's cutoff. The verifier gets the claims listed below plus that one proven bit — your birthdate never leaves this wallet. Proving takes a few seconds in this tab.`,
        }
      : {
          tier: 2,
          title: "Prove the age, never the date",
          disabled: true,
          detail:
            zk?.reason ??
            "A zero-knowledge predicate over the committed birthdate — unavailable for this request.",
        },
  ];
}

/**
 * The verifier's redirect back, carrying the tour forward when this ceremony
 * was one of the tour's presentation stops. The param is how the tour crosses
 * origins — the verifier's page picks it up; its Worker never reads it.
 */
function returnHref(redirectUri: string, tourStopId: string | undefined): string {
  if (tourStopId !== "present-shop" && tourStopId !== "present-rentals") {
    return redirectUri;
  }
  const next = nextTourStop(tourStopId);
  if (next === null) return redirectUri;
  try {
    return withTourParam(redirectUri, next.id);
  } catch {
    return redirectUri; // not an absolute URL — leave it untouched
  }
}

function DisclosureList({ entries }: { entries: Record<string, unknown> }) {
  const items = Object.entries(entries);
  if (items.length === 0) {
    return (
      <p className="text-[12px] text-muted">
        Nothing beyond the issuer's mandatory fields (issuer identity, validity window).
      </p>
    );
  }
  return (
    <dl className="space-y-1">
      {items.map(([claim, value]) => (
        <div key={claim} className="flex items-baseline justify-between gap-3">
          <dt className="font-mono text-[12px] text-ink-dim">{claim}</dt>
          <dd className="break-all text-right font-mono text-[12px] text-ink">
            {typeof value === "string" ? value : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Present() {
  const [searchParams] = useSearchParams();
  const {
    accounts,
    accountsError,
    locked,
    account,
    masterSecret,
    vaultKey,
    lockSignal,
  } = useSession();

  const params = useMemo(() => parsePresentParams(searchParams), [searchParams]);
  const tourStop = useTourStop();
  const preview = useMemo(
    () => (params.kind === "request" ? previewPresentationRequest(params.request) : null),
    [params],
  );

  // Emit the request to the inspector once per page load — it is the first
  // protocol message of the ceremony and arrived with the navigation itself.
  useEffect(() => {
    if (preview !== null) {
      inspect.emit({
        label: "Presentation request received",
        data: { verifierOrigin: preview.verifierOrigin, request: preview.request },
      });
    }
  }, [preview]);

  const [matches, setMatches] = useState<QueryCandidates | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tier, setTier] = useState<DisclosureTier>(1);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<PresentationStep | null>(null);
  const [outcome, setOutcome] = useState<PresentCredentialResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Matching needs the vault open; it runs (and re-runs) once unlocked.
  useEffect(() => {
    if (params.kind !== "request" || account === null || vaultKey === null) return;
    let cancelled = false;
    setMatches(null);
    setMatchError(null);
    void (async () => {
      try {
        const records = await listCredentials(account.id);
        const decrypted = await Promise.all(
          records.map(async (record) => ({
            record,
            payload: await decryptJson<LegacyCredentialPayload>(vaultKey, record.payload),
          })),
        );
        const result = matchCredentials(decrypted, params.request);
        if (!cancelled) {
          setMatches(result);
          setSelectedId(result.candidates[0]?.record.id ?? null);
          inspect.emit({
            label: "DCQL query matched against vault",
            data: {
              queryId: result.queryId,
              candidates: result.candidates.length,
              query: result.query,
            },
          });
        }
      } catch (err) {
        if (!cancelled) setMatchError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, account, vaultKey]);

  const selected: CandidateCredential | null =
    matches?.candidates.find((c) => c.record.id === selectedId) ?? null;

  // Tier 2 availability is per-candidate; a switch to an ineligible
  // credential falls back to selective disclosure rather than a dead button.
  const zk: ZkAgeOption | null =
    matches !== null && selected !== null ? zkAgeOption(matches.query, selected) : null;
  const zkAvailable = zk !== null && zk.available;
  useEffect(() => {
    if (!zkAvailable) setTier((current) => (current === 2 ? 1 : current));
  }, [zkAvailable]);

  const share = async () => {
    if (
      params.kind !== "request" ||
      matches === null ||
      selected === null ||
      masterSecret === null ||
      running
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setStep(null);
    try {
      const result = await presentCredential({
        request: params.request,
        queryId: matches.queryId,
        candidate: selected,
        tier,
        masterSecret,
        signal: lockSignal ?? undefined,
        onStep: setStep,
      });
      // Log the ceremony for the cross-verifier exhibit (encrypted, local).
      // Best-effort: the verifier already has its answer, so a storage
      // failure must not turn a successful presentation into an error.
      if (preview !== null && account !== null && vaultKey !== null) {
        const holder = result.presentation.holder;
        try {
          await recordPresentation({
            accountId: account.id,
            vaultKey,
            entry: {
              verifierOrigin: preview.verifierOrigin,
              verifierName: preview.verifierName,
              presenterDid: typeof holder === "string" ? holder : "",
              tier,
              disclosed: disclosurePreview(tier, selected.vc, selected.match, zk ?? undefined),
              ...(tier === 2 && zk !== null && zk.available ? { zkYears: zk.years } : {}),
              at: Date.now(),
            },
          });
        } catch {
          // Exhibit only — never fail the share over it.
        }
      }
      setOutcome(result);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setRunning(false);
    }
  };

  if (params.kind === "missing" || params.kind === "invalid") {
    return (
      <div className="mx-auto max-w-sm animate-rise pt-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          No presentation request here
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          This page answers verification requests — it expects an OpenID4VP
          authorization request in its link, usually opened from a verifier's
          site or QR code.
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

  const insecure = preview !== null && isInsecureIssuerOrigin(preview.verifierOrigin);

  // Success recap — shown in place of the consent card once shared.
  if (outcome !== null && preview !== null) {
    return (
      <div className="mx-auto max-w-md animate-rise">
        <SectionTitle>Presentation shared</SectionTitle>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {preview.verifierName} has its answer
        </h1>
        <div className="mt-6 rounded-3xl border border-line bg-surface p-6">
          <p className="text-[13px] leading-relaxed text-ink-dim">
            The presentation was signed with a presenter key that exists only
            for <span className="font-mono text-[12px]">{preview.verifierOrigin}</span>{" "}
            and bound to this request's nonce — it cannot be replayed
            elsewhere. The inspector holds every message that crossed the wire.
          </p>
          {selected !== null && (
            <div className="mt-4 rounded-2xl border border-line bg-canvas p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                What was disclosed (tier {tier})
              </p>
              <div className="mt-2">
                <DisclosureList
                  entries={disclosurePreview(tier, selected.vc, selected.match, zk ?? undefined)}
                />
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex gap-2">
          {outcome.redirectUri !== undefined && (
            <Button
              onClick={() =>
                window.location.assign(
                  returnHref(outcome.redirectUri as string, tourStop?.id),
                )
              }
            >
              Return to {preview.verifierName}
            </Button>
          )}
          <Link
            to="/"
            className="inline-flex items-center px-3 text-sm text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
          >
            Back to wallet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md animate-rise">
      <SectionTitle>Verification request</SectionTitle>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Share a credential
      </h1>

      {preview !== null && (
        <div className="mt-6 rounded-3xl border border-line bg-surface p-6">
          {/* Verifiers are counterparties, not authorities — no gold here. */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-dim">
            {preview.verifierName}
          </p>
          <p className="mt-2 break-all font-mono text-[13px] text-ink-dim">
            {preview.verifierOrigin}
          </p>

          {insecure && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-[13px] leading-relaxed text-danger"
            >
              This verifier uses plain <span className="font-mono">http://</span> on
              a non-local address — your presentation would cross the network
              unencrypted. Only continue if you trust it.
            </p>
          )}

          <p className="mt-4 text-[13px] leading-relaxed text-ink-dim">
            Sharing derives a one-off proof from your stored credential and
            sends it directly to the verifier. The issuer is never contacted
            and never learns where you presented.
          </p>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-line-strong p-5 text-sm leading-relaxed text-ink-dim">
          You need a wallet on this device before you can share anything.{" "}
          <Link
            to="/welcome"
            className="font-medium text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
          >
            Create your wallet
          </Link>
          , then open this request link again.
        </div>
      ) : locked ? (
        <InlineUnlock accounts={accounts} />
      ) : running ? (
        <StepList title="Presenting" steps={presentationSteps(tier)} current={step} />
      ) : matchError !== null ? (
        <div className="mt-6">
          <ErrorNote>Couldn't check your credentials: {matchError}</ErrorNote>
        </div>
      ) : matches === null ? (
        <div className="flex justify-center pt-10 text-muted">
          <Spinner />
        </div>
      ) : matches.candidates.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-line-strong p-5 text-sm leading-relaxed text-ink-dim">
          None of your credentials can answer this request — it asks for a{" "}
          <span className="font-mono text-[12px]">
            {matches.query.meta?.type_values?.[0]?.join(", ") ?? "credential"}
          </span>
          . Visit the Utopia DMV to be issued one, then open this link again.
        </div>
      ) : (
        <>
          {matches.candidates.length > 1 && (
            <div className="mt-6">
              <SectionTitle>Which credential</SectionTitle>
              <ul className="mt-2 space-y-2">
                {matches.candidates.map((candidate) => (
                  <li key={candidate.record.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(candidate.record.id)}
                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm transition-colors ${
                        candidate.record.id === selectedId
                          ? "border-accent bg-accent-soft"
                          : "border-line bg-canvas hover:border-line-strong"
                      }`}
                    >
                      <span className="font-medium">{candidate.record.meta.name}</span>
                      <span className="text-[12px] text-muted">
                        {candidate.record.meta.issuerName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6">
            <SectionTitle>How much to reveal</SectionTitle>
            <ul className="mt-2 space-y-2" role="radiogroup" aria-label="Disclosure tier">
              {tierRows(zk).map((option) => {
                const active = !option.disabled && option.tier === tier;
                return (
                  <li key={option.tier}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={option.disabled === true}
                      onClick={() => {
                        if (option.disabled !== true) setTier(option.tier);
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? "border-accent bg-accent-soft"
                          : option.disabled === true
                            ? "cursor-not-allowed border-line opacity-55"
                            : "border-line bg-canvas hover:border-line-strong"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
                        {option.title}
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                          tier {option.tier}
                        </span>
                      </span>
                      <span className="mt-1 block text-[12px] leading-relaxed text-ink-dim">
                        {option.detail}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {selected !== null && (
            <div className="mt-6 rounded-3xl border border-line bg-surface p-5">
              <SectionTitle>This will reveal</SectionTitle>
              <div className="mt-3">
                <DisclosureList
                  entries={disclosurePreview(tier, selected.vc, selected.match, zk ?? undefined)}
                />
              </div>
              {hasEmbeddedSubjectId(selected.vc) && (
                <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[12px] leading-relaxed text-danger">
                  This credential embeds a subject identifier, and the proof
                  math reveals it at every tier — verifiers that compare notes
                  can link your visits with it. Newer Utopia DMV licenses omit
                  it; re-issuing yours restores unlinkable presentations.
                </p>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                Plus the issuer's mandatory fields: who issued it and its
                validity window.
              </p>
            </div>
          )}

          <div className="mt-6">
            {error !== null && (
              <div className="mb-4">
                <ErrorNote>{error}</ErrorNote>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => void share()} disabled={selected === null}>
                {error !== null ? "Try again" : "Share"}
              </Button>
              <Link
                to="/"
                className="inline-flex items-center rounded-2xl border border-line px-4 text-sm text-ink-dim hover:border-line-strong"
              >
                Decline
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
