/**
 * Credential detail: ID-card-like claim layout, plus actions —
 * Verify (derive a minimal disclosure, then verify it, with timing),
 * Raw JSON (the decrypted VC), and Delete.
 */

import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { decryptJson } from "@vgw/keys";
import {
  deriveCredential,
  verifyCredential,
  type VerifiableCredential,
} from "@vgw/vc-kit";
import { useSession } from "../session";
import {
  deleteCredential,
  getCredential,
  type CredentialPayload,
  type CredentialRecord,
} from "../services/db";
import { issuerDid } from "../services/meta";
import { inspect } from "../inspector/events";
import { CredentialCard } from "../components/CredentialCard";
import { Button, ErrorNote, SectionTitle, Spinner, describeError } from "../components/ui";
import { JsonTree } from "../inspector/JsonTree";

/** Minimal disclosure: reveal only the birthdate commitment (the ZK teaser). */
const MINIMAL_POINTERS = ["/credentialSubject/driversLicense/birthDateCommitment"];

const CLAIM_LABELS: [key: string, label: string][] = [
  ["given_name", "Given name"],
  ["family_name", "Family name"],
  ["birth_date", "Date of birth"],
  ["document_number", "Document number"],
  ["issuing_authority", "Issuing authority"],
  ["issuing_country", "Issuing country"],
  ["issue_date", "Issued"],
  ["expiry_date", "Expires"],
  ["birthDateCommitment", "Birthdate commitment"],
];

function claimsOf(vc: VerifiableCredential): Record<string, unknown> | null {
  const subject = vc.credentialSubject;
  if (subject === undefined || Array.isArray(subject)) return null;
  const dl = subject["driversLicense"];
  if (typeof dl === "object" && dl !== null && !Array.isArray(dl)) {
    return dl as Record<string, unknown>;
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
  if (key === "birthDateCommitment" && value.length > 26) {
    return `${value.slice(0, 14)}…${value.slice(-10)}`;
  }
  return value;
}

interface VerifyOutcome {
  verified: boolean;
  error?: string;
  ms: number;
  derived: VerifiableCredential;
}

export function CredentialDetail() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { account, vaultKey, locked } = useSession();

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
  const claims = vc !== null ? claimsOf(vc) : null;

  // TODO(N3): this action still runs the bbs-2023 derive/verify roundtrip and
  // reports "Not verified" (gracefully) for the credkit credentials issued
  // since N2 — the wallet cannot derive credkit presentations until N3
  // rewires this to deriveProof/the receipt check (MIGRATION §12).
  const verify = async () => {
    if (vc === null || verifying) return;
    setVerifying(true);
    setOutcome(null);
    try {
      const start = performance.now();
      const derived = await deriveCredential({
        verifiableCredential: vc,
        selectivePointers: MINIMAL_POINTERS,
      });
      inspect.emit({
        label: "Derived proof created (selective disclosure)",
        data: { selectivePointers: MINIMAL_POINTERS },
      });
      const result = await verifyCredential({
        credential: derived,
        ...(issuerDid(vc) !== undefined ? { expectedIssuer: issuerDid(vc) } : {}),
      });
      const ms = Math.round(performance.now() - start);
      inspect.emit({
        label: "Derived proof verified",
        data: { verified: result.verified, ms, ...(result.error !== undefined ? { error: result.error } : {}) },
      });
      setOutcome({
        verified: result.verified,
        ...(result.error !== undefined ? { error: result.error } : {}),
        ms,
        derived,
      });
    } catch (err) {
      setOutcome({
        verified: false,
        error: describeError(err),
        ms: 0,
        derived: { "@context": [], type: [] },
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
        <CredentialCard meta={record.meta} />
      </div>

      {decryptError !== null && (
        <div className="mt-6"><ErrorNote>Could not decrypt this credential: {decryptError}</ErrorNote></div>
      )}

      {payload === null && decryptError === null ? (
        <div className="flex justify-center pt-10 text-muted">
          <Spinner />
        </div>
      ) : claims !== null ? (
        <section className="mt-8">
          <SectionTitle>Claims</SectionTitle>
          <dl className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {CLAIM_LABELS.filter(([key]) => claims[key] !== undefined).map(([key, label]) => (
              <div key={key} className="bg-surface px-4 py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {label}
                </dt>
                <dd
                  className={`mt-1 text-sm ${key === "birthDateCommitment" || key === "document_number" ? "font-mono text-[13px]" : "font-medium"}`}
                  title={typeof claims[key] === "string" ? (claims[key] as string) : undefined}
                >
                  {formatClaim(key, claims[key])}
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
                  ? "A derived proof disclosing only the birthdate commitment was created and checked against the issuer's DID. The verifier learned nothing else."
                  : outcome.error ?? "Verification failed."}
              </p>
              {outcome.verified && (
                <details className="mt-2">
                  <summary className="cursor-pointer select-none text-xs text-muted hover:text-ink-dim">
                    Derived credential (what a verifier would see)
                  </summary>
                  <div className="mt-2 max-h-80 overflow-y-auto rounded-xl bg-canvas p-3">
                    <JsonTree value={outcome.derived} defaultOpen={false} />
                  </div>
                </details>
              )}
            </div>
          )}

          {showRaw && (
            <div className="mt-4 animate-fade rounded-2xl border border-line bg-surface p-4">
              <p className="mb-2 text-[11px] text-muted">
                Decrypted verifiable credential (base proof — holder-only material).
              </p>
              <div className="max-h-96 overflow-y-auto rounded-xl bg-canvas p-3">
                <JsonTree value={vc} defaultOpen={false} />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
