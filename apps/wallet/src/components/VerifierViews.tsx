/**
 * The cross-verifier exhibit (M5): what each verifier actually saw, side by
 * side, from the only vantage point that has both — the wallet.
 *
 * The claim being demonstrated: presentations are pairwise (a different
 * presenter DID per verifier) and BBS derivations are unlinkable, so the
 * ONLY thing that can ever correlate two visits is a value the holder chose
 * to disclose to both. The comparison computes that intersection from the
 * real log and says so, honestly, in either direction.
 */

import { useEffect, useState } from "react";
import { useSession } from "../session";
import {
  latestPerVerifier,
  loadPresentations,
  sharedDisclosedValues,
  type PresentationLogEntry,
} from "../services/activity";
import { SectionTitle } from "./ui";

function shortValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 42 ? `${text.slice(0, 39)}…` : text;
}

function shortDid(did: string): string {
  return did.length > 32 ? `${did.slice(0, 24)}…${did.slice(-4)}` : did;
}

function VerifierCard({ entry }: { entry: PresentationLogEntry }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{entry.verifierName}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          tier {entry.tier}
        </p>
      </div>
      <p className="mt-0.5 break-all font-mono text-[11px] text-muted">
        {entry.verifierOrigin}
      </p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        Saw this presenter identifier
      </p>
      {entry.presenterDid === "" ? (
        // Entries since N3: the credkit presentation carries no holder key
        // or DID at all — there is no identifier to show, which IS the point.
        <p className="mt-1 text-[12px] text-ink-dim">
          None — the presentation carried no holder key or DID.
        </p>
      ) : (
        <p
          className="mt-1 inline-block rounded bg-gold-soft px-1.5 py-0.5 font-mono text-[11px] text-gold"
          title={entry.presenterDid}
        >
          {shortDid(entry.presenterDid)}
        </p>
      )}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        And learned
      </p>
      {Object.keys(entry.disclosed).length === 0 ? (
        <p className="mt-1 text-[12px] text-ink-dim">
          Only the issuer's mandatory fields.
        </p>
      ) : (
        <dl className="mt-1 space-y-1">
          {Object.entries(entry.disclosed).map(([claim, value]) => (
            <div key={claim} className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-[11px] text-ink-dim">{claim}</dt>
              <dd
                className="break-all text-right font-mono text-[11px] text-ink"
                title={typeof value === "string" ? value : JSON.stringify(value)}
              >
                {shortValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 text-[11px] text-muted">
        {new Date(entry.at).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>
    </div>
  );
}

export function VerifierViews() {
  const { account, vaultKey } = useSession();
  const [entries, setEntries] = useState<PresentationLogEntry[] | null>(null);

  const accountId = account?.id;
  useEffect(() => {
    if (accountId === undefined || vaultKey === null) return;
    let cancelled = false;
    void loadPresentations(accountId, vaultKey)
      .then((loaded) => {
        if (!cancelled) setEntries(loaded);
      })
      .catch(() => {
        // The exhibit is optional; a read failure just hides it.
        if (!cancelled) setEntries(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, vaultKey]);

  if (entries === null || entries.length === 0) return null;

  const verifiers = latestPerVerifier(entries);
  const [first, second] = verifiers;
  const shared =
    first !== undefined && second !== undefined
      ? sharedDisclosedValues(first, second)
      : null;

  return (
    <section className="mt-12 animate-fade">
      <SectionTitle>Across verifiers</SectionTitle>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">
        What each verifier saw
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
        Every presentation is signed by a presenter key that exists for one
        verifier only, and every BBS proof is a fresh, unlinkable derivation.
        This log is the wallet's own record — the verifiers can't see it, or
        each other's.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {verifiers.slice(0, 2).map((entry) => (
          <VerifierCard key={entry.verifierOrigin} entry={entry} />
        ))}
      </div>

      {shared === null ? (
        <p className="mt-3 rounded-2xl border border-dashed border-line-strong p-4 text-[12px] leading-relaxed text-ink-dim">
          One verifier so far. Present this credential somewhere else — the
          demo has both a bottle shop and a rental counter — and this panel
          will compare what the two of them could ever piece together.
        </p>
      ) : shared.length === 0 ? (
        <div className="mt-3 rounded-2xl bg-ok-soft p-4">
          <p className="text-[13px] font-semibold text-ok">Nothing to join.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
            Different presenter DIDs, unlinkable proofs, and no value disclosed
            to both — if {first!.verifierName} and {second!.verifierName}{" "}
            compared their records, nothing would line up.
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-danger-soft p-4">
          <p className="text-[13px] font-semibold text-danger">
            {shared.length} value{shared.length === 1 ? "" : "s"} could join
            these visits.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
            The cryptography adds no handles — but these disclosed values
            appear in both verifiers' records, so colluding verifiers could
            match them.
          </p>
          <dl className="mt-2 space-y-1">
            {shared.map(({ claim, value }) => (
              <div key={claim} className="flex items-baseline justify-between gap-3">
                <dt className="font-mono text-[11px] text-ink-dim">{claim}</dt>
                <dd className="break-all text-right font-mono text-[11px] text-danger">
                  {shortValue(value)}
                </dd>
              </div>
            ))}
          </dl>
          {shared.some(({ claim }) => claim === "birthDateCommitment") && (
            <p className="mt-2 border-t border-danger/20 pt-2 text-[12px] leading-relaxed text-ink-dim">
              The birthdate commitment is the subtle one: use the ZK tier at
              two verifiers and both see the same issuer-signed seal. Neither
              ever learns the date inside — but the seal itself is a stable
              value. Making even the seal presentation-unique is what full
              anonymous credentials would add on top of this demo.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
