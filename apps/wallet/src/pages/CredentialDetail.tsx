/**
 * Credential detail: ID-card-like claim layout, plus actions —
 * Verify (the credkit holder receipt check: re-run the whole issuance
 * pipeline and check the issuer's blind signature against this wallet's own
 * link secret and stored blind, with timing), Raw JSON (the decrypted VC),
 * and Delete.
 */

import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { decryptJson, deriveLinkSecret, scalarFromBase64Url } from "@vgw/keys";
import { JsonCode } from "@vgw/tour";
import { verifyIssuedCredkitCredential, type VerifiableCredential } from "@vgw/vc-kit";
import { useSession } from "../session";
import {
  deleteCredential,
  getCredential,
  type CredentialPayload,
  type CredentialRecord,
} from "../services/db";
import { inspect } from "../inspector/events";
import { cardFace } from "../services/meta";
import { CredentialCard } from "../components/CredentialCard";
import { Button, ErrorNote, SectionTitle, Spinner, describeError } from "../components/ui";

const DL_CLAIM_LABELS: [key: string, label: string][] = [
  ["given_name", "Given name"],
  ["family_name", "Family name"],
  ["birth_date", "Date of birth"],
  ["document_number", "Document number"],
  ["issuing_authority", "Issuing authority"],
  ["issuing_country", "Issuing country"],
  ["issue_date", "Issued"],
  ["expiry_date", "Expires"],
];

// The resident registration's subject is flat (citizenship-style camelCase);
// stateFips and postalCode double as hidden uint64 twins at presentation.
const RESIDENT_CLAIM_LABELS: [key: string, label: string][] = [
  ["givenName", "Given name"],
  ["familyName", "Family name"],
  ["districtName", "District"],
  ["stateFips", "District code (FIPS)"],
  ["postalCode", "Postal code"],
];

/** A credential's claim object plus the label set that knows how to name it. */
interface ClaimView {
  labels: [key: string, label: string][];
  claims: Record<string, unknown>;
}

function claimsOf(vc: VerifiableCredential): ClaimView | null {
  const subject = vc.credentialSubject;
  if (subject === undefined || Array.isArray(subject)) return null;
  // Utopia DL: the claims live under the driversLicense node.
  const dl = subject["driversLicense"];
  if (typeof dl === "object" && dl !== null && !Array.isArray(dl)) {
    return { labels: DL_CLAIM_LABELS, claims: dl as Record<string, unknown> };
  }
  // Utopia Resident Registration: flat subject typed ['Person', 'UtopiaResident'].
  const types = subject["type"];
  const typeList = Array.isArray(types) ? types : [types];
  if (typeList.includes("UtopiaResident")) {
    return { labels: RESIDENT_CLAIM_LABELS, claims: subject as Record<string, unknown> };
  }
  return null;
}

function formatClaim(key: string, value: unknown): string {
  if (typeof value !== "string") return String(value);
  if (key === "issue_date" || key === "expiry_date") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  return value;
}

interface VerifyOutcome {
  verified: boolean;
  error?: string;
  ms: number;
}

export function CredentialDetail() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { account, masterSecret, vaultKey, locked } = useSession();

  const [record, setRecord] = useState<CredentialRecord | null | undefined>(undefined);
  const [payload, setPayload] = useState<CredentialPayload | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const id = Number(params.id);
  const accountId = account?.id;

  useEffect(() => {
    if (locked || !Number.isInteger(id)) return;
    let cancelled = false;
    void (async () => {
      const found = await getCredential(id);
      if (cancelled) return;
      if (found === undefined || found.accountId !== accountId) {
        setRecord(null);
        return;
      }
      setRecord(found);
      if (vaultKey === null) return;
      try {
        const envelope = await decryptJson<CredentialPayload>(vaultKey, found.payload);
        if (cancelled) return;
        setPayload(envelope);
        inspect.emit({
          label: "Credential decrypted",
          data: { id: found.id, name: found.meta.name },
        });
      } catch (err) {
        if (!cancelled) setDecryptError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, accountId, vaultKey, locked]);

  if (locked) return <Navigate to="/" replace />;
  if (!Number.isInteger(id) || record === null) {
    return (
      <div className="animate-rise pt-16 text-center">
        <h1 className="text-xl font-semibold">Credential not found</h1>
        <Link
          to="/"
          className="mt-3 inline-block text-sm text-ink underline decoration-accent/70 underline-offset-2 hover:decoration-accent"
        >
          Back to wallet
        </Link>
      </div>
    );
  }
  if (record === undefined) {
    return (
      <div className="flex justify-center pt-24 text-muted">
        <Spinner />
      </div>
    );
  }

  const vc = payload?.vc ?? null;
  const claimView = vc !== null ? claimsOf(vc) : null;

  // The credkit holder receipt check (MIGRATION §6): recompute the whole
  // issuance pipeline from the stored credential and verify the issuer's
  // blind signature against this wallet's own re-derived link secret and the
  // credential's stored blind. Green means "authentic, and bound to THIS
  // wallet's secret" — a check only the holder can run, because only the
  // holder has both halves.
  const verify = async () => {
    if (vc === null || payload === null || masterSecret === null || verifying) return;
    setVerifying(true);
    setOutcome(null);
    try {
      const start = performance.now();
      const linkSecret = await deriveLinkSecret(masterSecret);
      const secretProverBlind = scalarFromBase64Url(payload.secretProverBlind);
      const verified = await verifyIssuedCredkitCredential({
        verifiableCredential: vc,
        holderBinding: { linkSecret, secretProverBlind },
      });
      const ms = Math.round(performance.now() - start);
      inspect.emit({
        label: "Holder receipt check re-run",
        data: { verified, ms },
      });
      setOutcome({
        verified,
        ...(verified
          ? {}
          : {
              error:
                "The issuer's blind signature did not verify against this wallet's link secret and this credential's stored blind.",
            }),
        ms,
      });
    } catch (err) {
      setOutcome({
        verified: false,
        error: describeError(err),
        ms: 0,
      });
    } finally {
      setVerifying(false);
    }
  };

  const remove = async () => {
    await deleteCredential(record.id);
    inspect.emit({ label: "Credential deleted", data: { id: record.id } });
    await navigate("/");
  };

  return (
    <div className="animate-rise">
      <Link
        to="/"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M14 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Wallet
      </Link>

      <div className="mx-auto max-w-md">
        <CredentialCard
          meta={record.meta}
          face={payload !== null ? cardFace(payload.vc) : undefined}
        />
      </div>

      {decryptError !== null && (
        <div className="mt-6"><ErrorNote>Could not decrypt this credential: {decryptError}</ErrorNote></div>
      )}

      {payload === null && decryptError === null ? (
        <div className="flex justify-center pt-10 text-muted">
          <Spinner />
        </div>
      ) : claimView !== null ? (
        <section className="mt-8">
          <SectionTitle>Claims</SectionTitle>
          <dl className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {claimView.labels
              .filter(([key]) => claimView.claims[key] !== undefined)
              .map(([key, label]) => (
                <div key={key} className="bg-surface px-4 py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                    {label}
                  </dt>
                  <dd
                    className={`mt-1 text-sm ${key === "document_number" || key === "stateFips" || key === "postalCode" ? "font-mono text-[13px]" : "font-medium"}`}
                    title={
                      typeof claimView.claims[key] === "string"
                        ? (claimView.claims[key] as string)
                        : undefined
                    }
                  >
                    {formatClaim(key, claimView.claims[key])}
                  </dd>
                </div>
              ))}
          </dl>
          {payload !== null && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              The blind-issuance share (secretProverBlind) is stored inside
              this credential's encrypted envelope — it never leaves the
              vault, and together with the wallet's link secret it is what
              makes this credential presentable as yours.
            </p>
          )}
        </section>
      ) : null}

      {vc !== null && (
        <section className="mt-8">
          <SectionTitle>Actions</SectionTitle>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void verify()} busy={verifying}>
              {verifying ? "Verifying…" : "Verify"}
            </Button>
            <Button variant="ghost" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "Hide raw JSON" : "Raw JSON"}
            </Button>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-2">
                <Button variant="danger" onClick={() => void remove()}>
                  Confirm delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>

          {outcome !== null && (
            <div
              className={`mt-4 animate-fade rounded-2xl border px-5 py-4 ${
                outcome.verified
                  ? "border-ok/30 bg-ok-soft"
                  : "border-danger/30 bg-danger-soft"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {/* The proof moment: the authority's seal and a gold wordmark. */}
                {outcome.verified && (
                  <span aria-hidden="true" className="seal-authority size-6 shrink-0" />
                )}
                {outcome.verified ? (
                  <span className="text-[13px] font-semibold uppercase tracking-[0.22em] text-gold">
                    Verified
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-danger">Not verified</span>
                )}
                <span className="font-mono text-xs text-muted">{outcome.ms} ms</span>
              </div>
              <p
                className={`mt-2 text-[13px] leading-relaxed ${
                  outcome.verified ? "text-ok" : "text-ink-dim"
                }`}
              >
                {outcome.verified
                  ? "The whole issuance pipeline was recomputed and the DMV's blind signature verified against this wallet's own link secret and this credential's stored blind — authentic, and bound to this wallet. Only the holder can run this check: no one else has both halves."
                  : outcome.error ?? "Verification failed."}
              </p>
            </div>
          )}

        </section>
      )}

      {vc !== null && showRaw && (
        <section className="mt-8 animate-fade">
          <SectionTitle>Credential JSON</SectionTitle>
          <div className="vgw-json-frame mt-3 rounded-3xl border border-line bg-surface p-5">
            <p className="text-[11px] leading-relaxed text-muted">
              Decrypted verifiable credential (base proof — holder-only material).
            </p>
            <JsonCode value={vc} className="mt-3 max-h-96" />
          </div>
        </section>
      )}
    </div>
  );
}
