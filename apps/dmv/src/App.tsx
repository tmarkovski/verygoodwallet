/**
 * The DMV counter: one page, two documents. A clerk (you) confirms a
 * citizen record and issues either a Utopia Driver's License or (since N5)
 * a Utopia Resident Registration as an OID4VCI credential offer for
 * VeryGoodWallet to collect — same flow, separate offers, one credential
 * configuration each.
 */

import { useEffect, useState, type FormEvent } from "react";
import {
  CREDENTIAL_CONFIGURATION_ID,
  RESIDENT_CREDENTIAL_CONFIGURATION_ID,
  walletOfferLink,
  type CredentialOffer,
} from "@vgw/protocols";
import { UTOPIA_DISTRICTS, districtByFips } from "@vgw/vc-kit/geography";
import {
  TOUR_PERSONA,
  TourOverlay,
  adoptTourFromUrl,
  nextTourStop,
  useTourStop,
  withTourParam,
} from "@vgw/tour";
import { OfferResult } from "./components/OfferResult";
import { RegistryPanel } from "./components/RegistryPanel";
import { PERSONAS, type Persona } from "./personas";
import { clientWalletOrigin } from "./walletOrigin";

interface OfferResponseBody {
  credential_offer: CredentialOffer;
  credential_offer_uri: string;
  /** Omitted by the Worker when no wallet origin is configured (unused here — the link is rebuilt client-side). */
  wallet_link?: string;
}

const CONTROL_CLASS =
  "w-full rounded-xl border border-line-strong bg-raised px-4 py-2.5 text-sm text-ink placeholder:text-muted";
const INPUT_CLASS = `mt-1.5 ${CONTROL_CLASS}`;

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

/** Which of the DMV's two credential configurations the counter is issuing. */
type CredentialKind = "license" | "resident";

/** The two desks: issue documents, or manage the revocation registry. */
type DmvView = "issue" | "records";

export default function App() {
  const [view, setView] = useState<DmvView>("issue");
  const [kind, setKind] = useState<CredentialKind>("license");
  const [givenName, setGivenName] = useState(PERSONAS[0]?.givenName ?? "");
  const [familyName, setFamilyName] = useState(PERSONAS[0]?.familyName ?? "");
  const [birthDate, setBirthDate] = useState(PERSONAS[0]?.birthDate ?? "");
  const [documentNumber, setDocumentNumber] = useState("");
  const [districtFips, setDistrictFips] = useState(PERSONAS[0]?.districtFips ?? 11);
  const [postalCode, setPostalCode] = useState(String(PERSONAS[0]?.postalCode ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OfferResponseBody | null>(null);

  const walletOrigin = clientWalletOrigin();
  const tourStop = useTourStop();
  const district = districtByFips(districtFips);

  // A guided-tour arrival prefills the counter form with the tour persona —
  // the visitor should issue, not type. (Idempotent under StrictMode.)
  useEffect(() => {
    if (adoptTourFromUrl() === "issue") {
      setKind("license");
      setGivenName(TOUR_PERSONA.givenName);
      setFamilyName(TOUR_PERSONA.familyName);
      setBirthDate(TOUR_PERSONA.birthDate);
      setDocumentNumber("");
    }
  }, []);

  const applyPersona = (persona: Persona) => {
    setGivenName(persona.givenName);
    setFamilyName(persona.familyName);
    setBirthDate(persona.birthDate);
    setDocumentNumber("");
    setDistrictFips(persona.districtFips);
    setPostalCode(String(persona.postalCode));
    setError(null);
  };

  const switchKind = (next: CredentialKind) => {
    if (next === kind) return;
    setKind(next);
    setError(null);
    setResult(null);
  };

  const applyDistrict = (fips: number) => {
    setDistrictFips(fips);
    // Snap the postal code into the selected district's block so the two
    // fields can't disagree by default.
    const next = districtByFips(fips);
    const postal = Number(postalCode);
    if (next !== undefined && (postal < next.postal.lo || postal > next.postal.hi)) {
      setPostalCode(String(next.postal.lo + 25));
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload =
        kind === "resident"
          ? {
              credential_configuration_id: RESIDENT_CREDENTIAL_CONFIGURATION_ID,
              givenName,
              familyName,
              districtFips,
              postalCode: Number(postalCode),
            }
          : {
              credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
              givenName,
              familyName,
              birthDate,
              ...(documentNumber.trim() !== ""
                ? { documentNumber: documentNumber.trim() }
                : {}),
            };
      const response = await fetch("/api/offers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-xl items-center gap-4 px-5 py-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-authority-soft text-authority">
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-authority">
              State of Utopia
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              Department of Motor Vehicles
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-16 pt-8">
        {/* Which desk: the issuing counter or the records/revocation desk. */}
        <div
          role="group"
          aria-label="DMV desk"
          className="mb-6 inline-flex rounded-full border border-line-strong bg-surface p-1"
        >
          {(
            [
              ["issue", "Issue documents"],
              ["records", "Records & revocation"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                view === value
                  ? "bg-authority text-white"
                  : "text-ink-dim hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "records" && <RegistryPanel />}

        <section className={view === "issue" ? "animate-rise" : "hidden"}>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Citizen record
          </h2>

          {/* Which document this counter visit issues (two OID4VCI configurations). */}
          <div
            role="group"
            aria-label="Document to issue"
            className="mt-3 inline-flex rounded-full border border-line-strong bg-surface p-1"
          >
            {(
              [
                ["license", "Driver's license"],
                ["resident", "Resident registration"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                onClick={() => switchKind(value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  kind === value
                    ? "bg-accent text-accent-contrast"
                    : "text-ink-dim hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {PERSONAS.map((persona) => (
              <button
                key={`${persona.givenName}-${persona.familyName}`}
                type="button"
                onClick={() => applyPersona(persona)}
                className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs text-ink transition-colors hover:border-accent/50 hover:bg-accent-soft active:scale-[0.98]"
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
              {kind === "license" ? (
                <>
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
                </>
              ) : (
                <>
                  <Field id="district" label="Home district">
                    <div className="relative mt-1.5">
                      <select
                        id="district"
                        value={districtFips}
                        onChange={(e) => applyDistrict(Number(e.target.value))}
                        required
                        className={`${CONTROL_CLASS} block appearance-none truncate pr-10`}
                      >
                        {UTOPIA_DISTRICTS.map((d) => (
                          <option key={d.fips} value={d.fips}>
                            {d.name} — {d.coastal ? "coastal" : "inland"} (district {d.fips})
                          </option>
                        ))}
                      </select>
                      <svg
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                      >
                        <path
                          d="M4 6l4 4 4-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </Field>
                  <Field id="postal-code" label="Postal code">
                    <input
                      id="postal-code"
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value.replace(/[^0-9]/g, ""))}
                      inputMode="numeric"
                      pattern="[0-9]{5}"
                      required
                      title={
                        district !== undefined
                          ? `${district.name}'s block is ${district.postal.lo}–${district.postal.hi}`
                          : "5-digit postal code"
                      }
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </Field>
                </>
              )}
            </div>

            {kind === "resident" && district !== undefined && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                {district.name} is {district.coastal ? "a coastal" : "an inland"} district;
                its postal block is {district.postal.lo}–{district.postal.hi}. The
                registration seals the district code and postal code as hidden numeric
                twins — provable later without being shown.
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-contrast shadow-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {busy
                ? "Issuing…"
                : kind === "resident"
                  ? "Issue resident registration"
                  : "Issue driver's license"}
            </button>

            {error !== null && (
              <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </section>

        {view === "issue" && result !== null && (
          <OfferResult
            credentialOffer={result.credential_offer}
            credentialOfferUri={result.credential_offer_uri}
            issuedLabel={
              result.credential_offer.credential_configuration_ids[0] ===
              RESIDENT_CREDENTIAL_CONFIGURATION_ID
                ? "Registration issued"
                : "License issued"
            }
            walletLink={(() => {
              if (walletOrigin === null) return null;
              const link = walletOfferLink(walletOrigin, result.credential_offer_uri);
              // Carry the tour across to the wallet's /offer stop.
              const next = tourStop?.id === "issue" ? nextTourStop("issue") : null;
              return next !== null ? withTourParam(link, next.id) : link;
            })()}
            walletOrigin={walletOrigin}
          />
        )}
      </main>

      <footer className="border-t border-line py-6">
        <p className="mx-auto max-w-xl px-5 text-center text-[11px] leading-relaxed text-muted">
          Demo issuer — OID4VCI pre-authorized code flow. Both documents are
          blind-signed on the credkit BBS suite, bound to a holder secret the
          DMV never sees, with the predicate fields (birth date; district and
          postal code) sealed as hidden numeric twins; nothing issued here is
          a real credential.
        </p>
      </footer>

      <TourOverlay origins={{ wallet: walletOrigin }} />
    </div>
  );
}
