/**
 * Figures 2 and 3: the anatomy of a presentation, using the demo's
 * resident-rate rental check. Figure 2 shows the two source credentials
 * side by side, showing what stays hidden, what is proven about hidden values,
 * and the link-secret equality connecting them. Figure 3 shows the Verifiable
 * Presentation that actually crosses the wire, with its proof bytes
 * decoded. All values come from running the real stack; the generated
 * presentation verifies against restated verifier policy.
 */
import {
  AnatomyFigure,
  ByteStrip,
  CredentialCard,
  InlineNote,
  Mark,
  StatusKey,
  type AnatomyNote,
  type CardRow,
} from "./anatomy";

// ---------------------------------------------------------------------------
// Figure 2: the two credentials, side by side
// ---------------------------------------------------------------------------

const CARD_NOTES: readonly AnatomyNote[] = [
  {
    id: "mandatory",
    color: "disclosed",
    title: "The only disclosures",
    body: "The issuer and validity window from each credential form the mandatory set. In this particular presentation, no other field is revealed at all.",
  },
  {
    id: "range",
    color: "proven",
    title: "Over 25, proven live",
    body: "Utopia Wheels computes today's cutoff: born on or before 2001-07-21 (day 37,091). The wallet then proves hidden birth date ≤ cutoff. Same hidden twin, any cutoff: the bottle shop asked for 18 with a different bound.",
  },
  {
    id: "membership",
    color: "proven",
    title: "Somewhere coastal",
    body: "The registration's hidden district code is proven to belong to the verifier's published set {11, 12, 13} (Port Azure, Meridian Shores, and Coral Landing) without revealing which one.",
  },
  {
    id: "revocation",
    color: "proven",
    title: "Still valid, both of them",
    body: "Each credential proves its hidden revocation id still belongs to the DMV registry's current accumulator. The ids themselves never appear. The registry section below explains the machinery.",
  },
  {
    id: "link",
    color: "binding",
    title: "Same holder",
    placement: "inline",
    body: null,
  },
];

const LICENSE_ROWS: readonly CardRow[] = [
  { label: "document_number", value: '"UDL-2984-1156"', status: "hidden" },
  { label: "given_name", value: '"Jamie"', status: "hidden" },
  { label: "family_name", value: '"Voss"', status: "hidden" },
  {
    label: "birth_date",
    value: '"1996-03-14"',
    status: "proven",
    badge: "proved ≤ day 37,091",
    note: "range",
  },
  { label: "age_over_18 · 21 · 25", value: "true, true, true", status: "hidden" },
  { label: "issuing_authority", value: '"UADMV"', status: "hidden" },
  { label: "issuer", value: '"Utopia DMV"', status: "disclosed", note: "mandatory" },
  { label: "validFrom → validUntil", value: "2026-07-14 → 2032-07-14", status: "disclosed" },
  {
    label: "revocationId",
    value: '"53685…65998"',
    status: "proven",
    badge: "proved unrevoked",
    note: "revocation",
  },
  { label: "link secret", value: "committed inside the signature", status: "binding", note: "link" },
];

const RESIDENT_ROWS: readonly CardRow[] = [
  { label: "givenName", value: '"Jamie"', status: "hidden" },
  { label: "familyName", value: '"Voss"', status: "hidden" },
  { label: "districtName", value: '"Port Azure"', status: "hidden" },
  {
    label: "stateFips",
    value: '"11"',
    status: "proven",
    badge: "proved ∈ {11, 12, 13}",
    note: "membership",
  },
  { label: "postalCode", value: '"40125"', status: "hidden" },
  { label: "issuer", value: '"Utopia DMV"', status: "disclosed", note: "mandatory" },
  { label: "validFrom → validUntil", value: "2026-07-14 → 2028-07-14", status: "disclosed" },
  {
    label: "revocationId",
    value: '"48445…99756"',
    status: "proven",
    badge: "proved unrevoked",
    note: "revocation",
  },
  { label: "link secret", value: "committed inside the signature", status: "binding", note: "link" },
];

export function PresentationCards() {
  return (
    <AnatomyFigure
      id="presentation-cards-figure"
      eyebrow="figure 2 · the resident-rate check"
      title="Two credentials, one statement about their holder"
      notes={CARD_NOTES}
      railPosition="below"
      caption="Utopia Wheels asked for three things: over 25, coastal resident, both credentials held by the same person. Every row marked hidden stays home."
    >
      <StatusKey />
      <div className="anat-duo">
        <CredentialCard title="Utopia Driver's License" rows={LICENSE_ROWS} />
        <InlineNote note="link">
          <span className="anat-chip-title">equality proof</span>
          <span className="anat-chip-body">
            both signatures hide the <em>same</em> link secret: one holder, no name
          </span>
        </InlineNote>
        <CredentialCard title="Utopia Resident Registration" rows={RESIDENT_ROWS} />
      </div>
    </AnatomyFigure>
  );
}

// ---------------------------------------------------------------------------
// Figure 3: the presentation on the wire
// ---------------------------------------------------------------------------

const WIRE_NOTES: readonly AnatomyNote[] = [
  {
    id: "nobody",
    color: "binding",
    title: "Still nobody named",
    body: "No holder property, DID, or key appears anywhere. Control of both credentials is proven inside the proof, never asserted beside it.",
  },
  {
    id: "survived",
    color: "hidden",
    title: "Stripped to the mandatory",
    body: "Of the license's thirty-odd signed statements, three fields survive: issuer, validFrom, and validUntil. Compare this embedded document with figure 1. Everything else is simply gone.",
  },
  {
    id: "descriptor",
    color: "wire",
    title: "A map, not a signature",
    body: "155 characters telling the verifier how the revealed statements line up with signed message slots and which hidden twins exist. birth_date and date1900 are readable in the base64. The 80-byte signature itself never leaves the wallet.",
  },
  {
    id: "challenge",
    color: "wire",
    title: "The verifier's nonce",
    body: "A one-time session nonce, folded into the proof's transcript. Replay the presentation at any other session and verification fails.",
  },
  {
    id: "domain",
    color: "wire",
    title: "Locked to one counter",
    body: "The proof's audience is this verifier's response endpoint. A presentation minted for Utopia Wheels convinces nobody else.",
  },
  {
    id: "proofvalue",
    color: "proven",
    title: "Six proofs, one challenge",
    body: "3,162 bytes carrying two credential proofs, a range proof, a membership proof, and two non-revocation proofs, all bound under a single merged challenge. The strip below decodes it.",
  },
];

function PresentationJson() {
  return (
    <pre className="anat-pre" data-anat-scroll>
      {`{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  `}
      <Mark note="nobody">{`"type": "VerifiablePresentation"`}</Mark>
      {`,
  "verifiableCredential": [
    {
      "@context": [ …as issued… ],
      "type": ["VerifiableCredential", "Iso18013DriversLicenseCredential"],
      `}
      <Mark note="survived">{`"issuer": { "id": "did:key:zUC74Snr…", "name": "Utopia DMV" }`}</Mark>
      {`,
      `}
      <Mark note="survived" quiet>{`"validFrom": "2026-07-14T00:00:00Z"`}</Mark>
      {`,
      `}
      <Mark note="survived" quiet>{`"validUntil": "2032-07-14T00:00:00Z"`}</Mark>
      {`,
      "proof": {
        "type": "DataIntegrityProof",
        "cryptosuite": "credkit-bbs-sha-2026",
        "verificationMethod": "did:key:zUC74Snr…",
        `}
      <Mark note="descriptor">{`"proofValue": "u2WMHhaEAA4YAAQIDBAWAFoKCeCwvY3JlZGVud…"`}</Mark>
      {`
      }
    },
    { …the resident registration, reduced the same way… }
  ],
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "credkit-bbs-presentation-sha-2026",
    "proofPurpose": "authentication",
    `}
      <Mark note="challenge">{`"challenge": "LARp0Qf79jMVN_LHoiyhBw"`}</Mark>
      {`,
    `}
      <Mark note="domain">{`"domain": "redirect_uri:https://rentals.verygoodwallet.com/…"`}</Mark>
      {`,
    `}
      <Mark note="proofvalue">{`"proofValue": "u2WMIhVkLKAAAAAAAAAACAAAAAAAABDCNdv9qjsXk…"`}</Mark>
      {`
  }
}`}
    </pre>
  );
}

function VerifierVerdict() {
  return (
    <div className="anat-verdict">
      <div>
        <p className="anat-verdict-title c-disclosed">the verifier learns</p>
        <ul>
          <li>born on or before 2001-07-21 (over 25)</li>
          <li>lives in one of the three coastal districts</li>
          <li>both credentials belong to the presenter</li>
          <li>neither credential is revoked</li>
          <li>both issued by Utopia DMV, currently valid</li>
        </ul>
      </div>
      <div>
        <p className="anat-verdict-title c-binding">it never sees</p>
        <ul>
          <li>name or license number</li>
          <li>the birth date itself</li>
          <li>which district, or the postal code</li>
          <li>the revocation ids or the link secret</li>
          <li>anything it could match at another verifier</li>
        </ul>
      </div>
    </div>
  );
}

export function PresentationWire() {
  return (
    <AnatomyFigure
      id="presentation-wire-figure"
      eyebrow="figure 3 · what actually crosses the wire"
      title="The presentation, byte for byte"
      notes={WIRE_NOTES}
      caption="This is not a mock-up: the presentation shown here was generated by the demo's real stack and verifies against the rental verifier's restated policy."
      footer={
        <>
          <ByteStrip
            title="Inside the presentation proofValue: 3,162 bytes"
            segments={[
              { label: "tag", bytes: "3 B", color: "hidden", grow: 1.6 },
              { label: "license proof", bytes: "1,072 B", color: "wire", grow: 8.2 },
              { label: "registration proof", bytes: "848 B", color: "wire", grow: 7.3 },
              { label: "range", bytes: "456 B", color: "proven", grow: 5.4 },
              { label: "set", bytes: "112 B", color: "proven", grow: 2.7 },
              { label: "non-revocation", bytes: "2 × 128 B", color: "proven", grow: 4 },
              { label: "challenge", bytes: "32 B", color: "binding", grow: 2.2 },
              { label: "claim records", bytes: "~300 B", color: "hidden", grow: 4.4 },
            ]}
          />
          <ByteStrip
            title="One credential proof up close: the license's 1,072 bytes"
            segments={[
              { label: "Ā", bytes: "48 B", color: "wire", grow: 2.4 },
              { label: "B̄", bytes: "48 B", color: "wire", grow: 2.4 },
              { label: "D", bytes: "48 B", color: "wire", grow: 2.4 },
              { label: "ê, r̂₁, r̂₃", bytes: "3 × 32 B", color: "wire", grow: 3.4 },
              {
                label: "m̂₁ … m̂₂₆",
                bytes: "26 × 32 B",
                color: "proven",
                grow: 10,
              },
            ]}
            legend={[
              {
                color: "wire",
                label: "credential proofs",
                text: "one per credential: three freshly randomized curve points, then 32-byte response scalars consisting of ê, r̂₁, r̂₃ plus one per hidden message (26 for the license, 19 for the registration). New randomness every presentation, so no two ever share a byte.",
              },
              {
                color: "proven",
                label: "predicate proofs",
                text: "the range proof splits the birth-date twin into four base-16 digits proven against the cutoff (a 2008 Camenisch–Chaabouni–Shelat construction); the set proof matches the district twin against the coastal alphabet; the non-revocation proofs place each hidden revocation id in the registry's current accumulator.",
              },
              {
                color: "binding",
                label: "merged challenge",
                text: "one Fiat–Shamir hash over every commitment above plus the nonce, the domain, and the link-secret equality. Every sub-proof must verify against this same value, so the pieces cannot be re-mixed, replayed, or presented separately.",
              },
              {
                color: "hidden",
                label: "claim records",
                text: "the public statement of what was proven: bound day 37,091, four digits, the set and parameter hashes, the accumulator value and epoch, and the equality. The verifier restates every one from its own policy rather than trusting the wire.",
              },
            ]}
          />
          <VerifierVerdict />
        </>
      }
    >
      <PresentationJson />
    </AnatomyFigure>
  );
}
