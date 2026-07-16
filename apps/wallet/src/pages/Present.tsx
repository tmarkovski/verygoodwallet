/**
 * /present — the wallet half of the OID4VP presentation ceremony.
 *
 * A verifier's wallet link lands here with the whole unsigned authorization
 * request in the query string. The page shows who is asking and for what
 * BEFORE any key material is touched, matches the DCQL query against the
 * vault, and offers the demo's disclosure-tier picker: full disclosure,
 * selective disclosure, or the credkit predicate proofs over hidden twins.
 *
 * Composite requests (multi-query / equality-linked, N5b) get a different
 * consent: the request's shape is FIXED — per-statement sections show what
 * each credential proves and discloses, plus one linkage line when the
 * verifier demands the statements belong to one holder. No tier picker.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { nextTourStop, useTourStop, withTourParam } from "@vgw/tour";
import { useSession } from "../session";
import { decryptJson } from "@vgw/keys";
import type { VerifiableCredential } from "@vgw/vc-kit";
import { isInsecureIssuerOrigin } from "../services/issuance";
import { DEMO_SITE_ORIGINS } from "../services/demoSites";
import {
  compositePresentationSteps,
  compositeStatements,
  disclosurePreview,
  hasEmbeddedSubjectId,
  matchCredentials,
  parsePresentParams,
  predicateOption,
  presentComposite,
  presentCredential,
  presentationSteps,
  previewPresentationRequest,
  type CandidateCredential,
  type CompositeStatement,
  type DisclosureTier,
  type MatchedRequest,
  type PredicateOption,
  type PresentCredentialResult,
  type PresentationStep,
} from "../services/presentation";
import {
  listCredentials,
  type CredentialPayload,
  type CredentialRecord,
} from "../services/db";
import { recordPresentation } from "../services/activity";
import { inspect } from "../inspector/events";
import { InlineUnlock } from "../components/InlineUnlock";
import { StepList } from "../components/StepList";
import { Button, ErrorNote, SectionTitle, Spinner, describeError } from "../components/ui";

/** The tier picker's rows; tier 2 depends on the request and the credential. */
function tierRows(predicate: PredicateOption | null): {
  tier: DisclosureTier;
  title: string;
  detail: string;
  disabled?: boolean;
}[] {
  const available = predicate !== null && predicate.available;
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
        "Selective disclosure — just the claims below, unlinkable across presentations.",
    },
    available
      ? {
          tier: 2,
          title: "Prove the answer, never the value",
          detail: `A proof over the hidden ${
            [...predicate.range, ...predicate.membership]
              .map((claim) => claim.description)
              .join("; ") || "value"
          } — the verifier learns that one bit against its own live requirement and verifies it entirely on its server. Disclosed alongside: ${
            predicate.pointers.length === 0
              ? "nothing beyond the issuer's mandatory fields"
              : "only the claims listed below"
          }. No proving wait, no WASM.`,
        }
      : {
          tier: 2,
          title: "Prove the answer, never the value",
          disabled: true,
          detail:
            (predicate !== null && !predicate.available ? predicate.reason : undefined) ??
            "A predicate proof over a hidden value — unavailable for this request.",
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

/**
 * Cross-site link to the DMV for "you don't hold this credential" dead
 * ends — opens in a new window so the pending request stays on this page.
 */
function DmvLink({ label }: { label: string }) {
  return (
    <a
      href={DEMO_SITE_ORIGINS.dmv}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-baseline gap-1 text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
    >
      {label}
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-3 w-3 shrink-0 self-center"
      >
        <path
          d="M6.25 4H4.5A1.5 1.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13h6a1.5 1.5 0 0 0 1.5-1.5V9.75M9.75 3H13v3.25M12.5 3.5 7.75 8.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">(opens in a new window)</span>
    </a>
  );
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

/**
 * The composite consent/recap body: one section per statement (credential,
 * what's proven, what's disclosed) plus the linkage line when the verifier
 * demands the statements belong to one holder.
 */
function CompositeSections({
  statements,
  linked,
}: {
  statements: CompositeStatement[];
  linked: boolean;
}) {
  return (
    <div className="mt-3 space-y-3">
      {statements.map((statement, index) => (
        <div
          key={statement.queryId}
          className="rounded-2xl border border-line bg-canvas p-4"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-ink">
              {statement.candidate.record.meta.name}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              statement {index + 1} of {statements.length}
            </span>
          </div>
          {statement.proven.length > 0 && (
            <div className="mt-2.5">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Proves — the values stay hidden
              </p>
              <ul className="mt-1.5 space-y-1">
                {statement.proven.map((line) => (
                  <li key={line} className="text-[12px] leading-relaxed text-ink-dim">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-2.5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Discloses
            </p>
            <div className="mt-1.5">
              <DisclosureList entries={statement.disclosed} />
            </div>
          </div>
          {hasEmbeddedSubjectId(statement.candidate.vc) && (
            <p className="mt-2.5 rounded-xl bg-danger-soft px-3 py-2.5 text-[12px] leading-relaxed text-danger">
              This credential embeds a subject identifier, and the proof math
              reveals it — re-issuing at the Utopia DMV restores unlinkable
              presentations.
            </p>
          )}
        </div>
      ))}
      {linked && (
        <p className="rounded-xl bg-accent-soft px-3 py-2.5 text-[12px] leading-relaxed text-ink">
          Linked: these {statements.length === 2 ? "two credentials" : "credentials"} will
          be proven to belong to <span className="font-semibold">one holder</span> — through
          the wallet's hidden link secret, without revealing who that holder is.
        </p>
      )}
      <p className="text-[12px] leading-relaxed text-muted">
        Plus each issuer's mandatory fields: who issued it and its validity
        window.
      </p>
    </div>
  );
}

/** Merge a composite plan into one claim→value map for the activity log. */
function compositeDisclosurePreview(
  statements: CompositeStatement[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const statement of statements) {
    Object.assign(merged, statement.disclosed);
    for (const claim of statement.predicate?.range ?? []) {
      merged[claim.pointer.slice(claim.pointer.lastIndexOf("/") + 1)] =
        `proven, not shown: ${claim.description} — the value never leaves this wallet`;
    }
    for (const claim of statement.predicate?.membership ?? []) {
      merged[claim.pointer.slice(claim.pointer.lastIndexOf("/") + 1)] =
        `proven, not shown: ${claim.description}`;
    }
  }
  return merged;
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

  const [matches, setMatches] = useState<MatchedRequest | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  /** Set when the request itself can't be answered (missing credential, unsupported linkage). */
  const [unanswerable, setUnanswerable] = useState<string | null>(null);
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
    setUnanswerable(null);
    void (async () => {
      let decrypted: { record: CredentialRecord; payload: CredentialPayload }[];
      try {
        const records = await listCredentials(account.id);
        decrypted = await Promise.all(
          records.map(async (record) => ({
            record,
            payload: await decryptJson<CredentialPayload>(vaultKey, record.payload),
          })),
        );
      } catch (err) {
        if (!cancelled) setMatchError(describeError(err));
        return;
      }
      try {
        const result = matchCredentials(decrypted, params.request);
        if (!cancelled) {
          setMatches(result);
          setSelectedId(result.queries[0]?.candidates[0]?.record.id ?? null);
          inspect.emit({
            label: "DCQL query matched against vault",
            data: {
              composite: result.composite,
              queries: result.queries.map((entry) => ({
                queryId: entry.queryId,
                candidates: entry.candidates.length,
              })),
              query: params.request.dcql_query,
            },
          });
        }
      } catch (err) {
        // The vault is fine — the REQUEST is unanswerable (a composite query
        // this wallet holds no credential for, or an unsupported linkage).
        if (!cancelled) setUnanswerable(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, account, vaultKey]);

  const composite = matches !== null && matches.composite;
  /** The single credential query, when the request is not composite. */
  const single = matches !== null && !matches.composite ? matches.queries[0]! : null;

  const selected: CandidateCredential | null =
    single?.candidates.find((c) => c.record.id === selectedId) ?? null;

  // Tier 2 availability is per-candidate; a switch to an ineligible
  // credential falls back to selective disclosure rather than a dead button.
  const predicate: PredicateOption | null =
    single !== null && selected !== null ? predicateOption(single.query, selected) : null;
  const predicateAvailable = predicate !== null && predicate.available;
  useEffect(() => {
    if (!predicateAvailable) setTier((current) => (current === 2 ? 1 : current));
  }, [predicateAvailable]);

  // The composite plan: first candidate auto-picked per query (the service
  // notes why), resolved once for consent, ceremony, and recap alike.
  const compositePlan = useMemo<
    { statements: CompositeStatement[] } | { error: string } | null
  >(() => {
    if (matches === null || !matches.composite) return null;
    try {
      return { statements: compositeStatements(matches) };
    } catch (err) {
      return { error: describeError(err) };
    }
  }, [matches]);
  const compositeStatementsResolved =
    compositePlan !== null && "statements" in compositePlan ? compositePlan.statements : null;
  const compositeLinked =
    params.kind === "request" &&
    (params.request.dcql_query.vgw_equalities?.length ?? 0) > 0;
  const compositeFetchesParams =
    compositeStatementsResolved?.some((statement) => statement.predicate !== undefined) ??
    false;

  const share = async () => {
    if (
      params.kind !== "request" ||
      matches === null ||
      masterSecret === null ||
      running
    ) {
      return;
    }
    if (!composite && selected === null) return;
    if (composite && compositeStatementsResolved === null) return;
    setRunning(true);
    setError(null);
    setStep(null);
    try {
      const result = composite
        ? await presentComposite({
            request: params.request,
            matches,
            masterSecret,
            signal: lockSignal ?? undefined,
            onStep: setStep,
          })
        : await presentCredential({
            request: params.request,
            queryId: single!.queryId,
            candidate: selected!,
            tier,
            masterSecret,
            signal: lockSignal ?? undefined,
            onStep: setStep,
          });
      // Log the ceremony for the cross-verifier exhibit (encrypted, local).
      // Best-effort: the verifier already has its answer, so a storage
      // failure must not turn a successful presentation into an error.
      if (preview !== null && account !== null && vaultKey !== null) {
        const disclosed = composite
          ? compositeDisclosurePreview(compositeStatementsResolved!)
          : disclosurePreview(tier, selected!.vc, selected!.match, predicate ?? undefined);
        const predicateYears = composite
          ? compositeStatementsResolved!
              .flatMap((statement) => statement.predicate?.range ?? [])
              .find((claim) => claim.years !== undefined)?.years
          : tier === 2 && predicate !== null && predicate.available
            ? predicate.range.find((claim) => claim.years !== undefined)?.years
            : undefined;
        try {
          await recordPresentation({
            accountId: account.id,
            vaultKey,
            entry: {
              verifierOrigin: preview.verifierOrigin,
              verifierName: preview.verifierName,
              // The credkit VP carries NO holder identifier — record that
              // honestly rather than a key nobody saw.
              presenterDid: "",
              // A composite is the predicate route by construction (its
              // shape is fixed by the verifier's vgw_predicates).
              tier: composite ? 2 : tier,
              disclosed,
              ...(predicateYears !== undefined ? { zkYears: predicateYears } : {}),
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
        <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
          The proof was bound to this request's nonce and to{" "}
          <span className="font-mono text-[12px]">{preview.verifierOrigin}</span>{" "}
          — it cannot be replayed elsewhere — and it carried no holder key
          or identifier of any kind. The inspector holds every message that
          crossed the wire.
        </p>
        {composite && compositeStatementsResolved !== null ? (
          <div className="mt-6 rounded-3xl border border-line bg-surface p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              What was shared (one linked presentation)
            </p>
            <CompositeSections
              statements={compositeStatementsResolved}
              linked={compositeLinked}
            />
          </div>
        ) : (
          selected !== null && (
            <div className="mt-6 rounded-3xl border border-line bg-surface p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                What was disclosed (tier {tier})
              </p>
              <div className="mt-2">
                <DisclosureList
                  entries={disclosurePreview(tier, selected.vc, selected.match, predicate ?? undefined)}
                />
              </div>
            </div>
          )
        )}
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
        {composite ? "Share a linked presentation" : "Share a credential"}
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
            Sharing derives a one-off proof from your stored credential
            {composite ? "s" : ""} and sends it directly to the verifier. The
            issuer is never contacted and never learns where you presented.
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
        <StepList
          title="Presenting"
          steps={
            composite
              ? compositePresentationSteps(compositeFetchesParams)
              : presentationSteps(tier)
          }
          current={step}
        />
      ) : matchError !== null ? (
        <div className="mt-6">
          <ErrorNote>Couldn't check your credentials: {matchError}</ErrorNote>
        </div>
      ) : unanswerable !== null ? (
        <div className="mt-6 rounded-3xl border border-dashed border-line-strong p-5 text-sm leading-relaxed text-ink-dim">
          {unanswerable}
          <p className="mt-3">
            <DmvLink label="Open the Utopia DMV" />
          </p>
        </div>
      ) : matches === null ? (
        <div className="flex justify-center pt-10 text-muted">
          <Spinner />
        </div>
      ) : composite ? (
        compositePlan !== null && "error" in compositePlan ? (
          <div className="mt-6 rounded-3xl border border-dashed border-line-strong p-5 text-sm leading-relaxed text-ink-dim">
            {compositePlan.error}
          </div>
        ) : (
          <>
            <div className="mt-6">
              <SectionTitle>What this request proves</SectionTitle>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                This verifier asks for {compositeStatementsResolved!.length} credentials
                in one linked presentation. The request's shape is fixed — no
                disclosure tiers: each credential proves exactly what's listed,
                and nothing else leaves this wallet.
              </p>
              <CompositeSections
                statements={compositeStatementsResolved!}
                linked={compositeLinked}
              />
            </div>

            <div className="mt-6">
              {error !== null && (
                <div className="mb-4">
                  <ErrorNote>{error}</ErrorNote>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={() => void share()}>
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
        )
      ) : single!.candidates.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-line-strong p-5 text-sm leading-relaxed text-ink-dim">
          None of your credentials can answer this request — it asks for a{" "}
          <span className="font-mono text-[12px]">
            {single!.query.meta?.type_values?.[0]?.join(", ") ?? "credential"}
          </span>
          . Visit the <DmvLink label="Utopia DMV" /> to be issued one, then
          open this link again.
        </div>
      ) : (
        <>
          {single!.candidates.length > 1 && (
            <div className="mt-6">
              <SectionTitle>Which credential</SectionTitle>
              <ul className="mt-2 space-y-2">
                {single!.candidates.map((candidate) => (
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
              {tierRows(predicate).map((option) => {
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
                  entries={disclosurePreview(tier, selected.vc, selected.match, predicate ?? undefined)}
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
