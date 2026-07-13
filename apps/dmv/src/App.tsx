/**
 * The DMV counter: one page, one job. A clerk (you) confirms a citizen
 * record and issues a Utopia Driver's License as an OID4VCI credential
 * offer for VeryGoodWallet to collect.
 */

import { useState, type FormEvent } from "react";
import { walletOfferLink, type CredentialOffer } from "@vgw/protocols";
import { OfferResult } from "./components/OfferResult";
import { PERSONAS, type Persona } from "./personas";
import { clientWalletOrigin } from "./walletOrigin";

interface OfferResponseBody {
  credential_offer: CredentialOffer;
  credential_offer_uri: string;
  /** Omitted by the Worker when no wallet origin is configured (unused here — the link is rebuilt client-side). */
  wallet_link?: string;
}

const INPUT_CLASS =
  "mt-1.5 w-full rounded-xl border border-line-strong bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-muted";

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-dim">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function App() {
  const [givenName, setGivenName] = useState(PERSONAS[0]?.givenName ?? "");
  const [familyName, setFamilyName] = useState(PERSONAS[0]?.familyName ?? "");
  const [birthDate, setBirthDate] = useState(PERSONAS[0]?.birthDate ?? "");
  const [documentNumber, setDocumentNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OfferResponseBody | null>(null);

  const walletOrigin = clientWalletOrigin();

  const applyPersona = (persona: Persona) => {
    setGivenName(persona.givenName);
    setFamilyName(persona.familyName);
    setBirthDate(persona.birthDate);
    setDocumentNumber("");
    setError(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/offers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          givenName,
          familyName,
          birthDate,
          ...(documentNumber.trim() !== "" ? { documentNumber: documentNumber.trim() } : {}),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const description = (body as { error_description?: string }).error_description;
        throw new Error(description ?? `Request failed (${response.status})`);
      }
      setResult(body as OfferResponseBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-xl items-center gap-4 px-5 py-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold">
            {/* Utopia crest — shield with star */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3.5l6.5 2.3v5.4c0 4.2-2.8 7.1-6.5 8.8-3.7-1.7-6.5-4.6-6.5-8.8V5.8Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M12 8.2l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
              State of Utopia
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              Department of Motor Vehicles
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-16 pt-8">
        <section className="animate-rise">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Citizen record
          </h2>

          <div className="mt-3 flex flex-wrap gap-2">
            {PERSONAS.map((persona) => (
              <button
                key={`${persona.givenName}-${persona.familyName}`}
                type="button"
                onClick={() => applyPersona(persona)}
                className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-ink transition-colors hover:bg-surface active:scale-[0.98]"
              >
                {persona.givenName} {persona.familyName}
                <span className="ml-1.5 text-muted">{persona.note}</span>
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => void onSubmit(e)}
            className="mt-4 rounded-3xl border border-line bg-surface p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="given-name" label="Given name">
                <input
                  id="given-name"
                  type="text"
                  value={givenName}
                  onChange={(e) => setGivenName(e.target.value)}
                  autoComplete="off"
                  maxLength={80}
                  required
                  className={INPUT_CLASS}
                />
              </Field>
              <Field id="family-name" label="Family name">
                <input
                  id="family-name"
                  type="text"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  autoComplete="off"
                  maxLength={80}
                  required
                  className={INPUT_CLASS}
                />
              </Field>
              <Field id="birth-date" label="Date of birth">
                <input
                  id="birth-date"
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  required
                  className={INPUT_CLASS}
                />
              </Field>
              <Field id="document-number" label="Document number">
                <input
                  id="document-number"
                  type="text"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value.toUpperCase())}
                  placeholder="auto-assigned"
                  autoComplete="off"
                  pattern="UDL-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}"
                  title="UDL-XXXX-XXXX (A-Z/2-9, excluding I, L, O, 0, 1)"
                  className={`${INPUT_CLASS} font-mono`}
                />
              </Field>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-contrast shadow-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {busy ? "Issuing…" : "Issue driver's license"}
            </button>

            {error !== null && (
              <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </section>

        {result !== null && (
          <OfferResult
            credentialOffer={result.credential_offer}
            credentialOfferUri={result.credential_offer_uri}
            walletLink={
              walletOrigin !== null
                ? walletOfferLink(walletOrigin, result.credential_offer_uri)
                : null
            }
            walletOrigin={walletOrigin}
          />
        )}
      </main>

      <footer className="border-t border-line py-6">
        <p className="mx-auto max-w-xl px-5 text-center text-[11px] leading-relaxed text-muted">
          Demo issuer — OID4VCI pre-authorized code flow. The license is signed
          with bbs-2023 and carries a Poseidon commitment to the birth date;
          nothing issued here is a real credential.
        </p>
      </footer>
    </div>
  );
}
