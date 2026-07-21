/**
 * Figure 1: the anatomy of a credential. The specimen is a real signed
 * Utopia Driver's License produced by running the demo's actual issuance
 * stack (vc-kit + credkit); values are verbatim, with long base64/DID
 * strings shortened by ellipses. The byte strip decodes its proofValue.
 */
import { AnatomyFigure, ByteStrip, Mark, type AnatomyNote } from "./anatomy";

const NOTES: readonly AnatomyNote[] = [
  {
    id: "issuer",
    color: "wire",
    title: "Who signed it",
    body: "The issuer is a did:key — the DMV's public key spelled as an identifier. Checking the signature needs only this document and this key; the DMV is never contacted and never learns where the license is used.",
  },
  {
    id: "validity",
    color: "disclosed",
    title: "Always disclosed",
    body: "The issuer and validity window are the credential's only mandatory fields — every presentation reveals them. They are kept date-granular on purpose: a millisecond timestamp would be a unique value that follows the credential around.",
  },
  {
    id: "subject",
    color: "binding",
    title: "What's missing: you",
    body: "There is no id here — no DID, no holder key, nothing. An identifier in the subject would surface in every presentation and link them all. What ties the license to Jamie instead is a hidden link secret, explained below.",
  },
  {
    id: "birth",
    color: "proven",
    title: "One date, signed twice",
    body: "Signed as readable text, and again as a hidden numeric twin — day 35,136 counted from 1900. The twin never appears in the document; it is what age proofs compute against later, at any cutoff a verifier picks.",
  },
  {
    id: "flags",
    color: "hidden",
    title: "Frozen booleans",
    body: "Age flags computed once, on issuance day, and never again. They can only answer the questions the DMV anticipated — the demo keeps them to contrast with the live range proof over the hidden twin.",
  },
  {
    id: "status",
    color: "proven",
    title: "Revocation coordinates",
    body: "The registry URL is shared by every DMV credential, so it identifies nobody. The revocation id is signed as another hidden twin: presentations prove it is not on the revoked list without ever showing it.",
  },
  {
    id: "proof",
    color: "wire",
    title: "The engraving",
    body: "A W3C Data Integrity proof under credkit's experimental BBS suite. Everything cryptographic lives in the 447-byte proofValue — decoded in the strip below.",
  },
];

function CredentialJson() {
  return (
    <pre className="anat-pre" data-anat-scroll>
      {`{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://w3id.org/vdl/v1",
    "https://w3id.org/vdl/aamva/v1",
    "https://verygoodwallet.com/contexts/vgw/v1"
  ],
  "type": ["VerifiableCredential", "Iso18013DriversLicenseCredential"],
  "name": "Utopia Driver's License",
  "issuer": {
    `}
      <Mark note="issuer">{`"id": "did:key:zUC74Snr3hDGwENw4db3…oJfwUKdXiq"`}</Mark>
      {`,
    "name": "Utopia DMV"
  },
  `}
      <Mark note="validity">{`"validFrom": "2026-07-14T00:00:00Z"`}</Mark>
      {`,
  `}
      <Mark note="validity" quiet>{`"validUntil": "2032-07-14T00:00:00Z"`}</Mark>
      {`,
  `}
      <Mark note="subject">{`"credentialSubject"`}</Mark>
      {`: {
    "type": "LicensedDriver",
    "driversLicense": {
      "type": "Iso18013DriversLicense",
      "document_number": "UDL-2984-1156",
      "given_name": "Jamie",
      "family_name": "Voss",
      `}
      <Mark note="birth">{`"birth_date": "1996-03-14"`}</Mark>
      {`,
      `}
      <Mark note="flags">{`"age_over_18": true`}</Mark>
      {`,
      `}
      <Mark note="flags" quiet>{`"age_over_21": true`}</Mark>
      {`,
      `}
      <Mark note="flags" quiet>{`"age_over_25": true`}</Mark>
      {`,
      "issuing_authority": "UADMV",
      "issuing_country": "UA",
      "issue_date": "2026-07-14T00:00:00Z",
      "expiry_date": "2032-07-14T00:00:00Z"
    }
  },
  "credentialStatus": {
    "type": "VgwRevocationRegistryEntry",
    `}
      <Mark note="status">{`"revocationRegistry": "https://dmv.verygoodwallet.com/api/registry"`}</Mark>
      {`,
    `}
      <Mark note="status" quiet>{`"revocationId": "53685601770269079567…59075766165998"`}</Mark>
      {`
  },
  "proof": {
    "type": "DataIntegrityProof",
    `}
      <Mark note="proof">{`"cryptosuite": "credkit-bbs-sha-2026"`}</Mark>
      {`,
    "verificationMethod": "did:key:zUC74Snr3hDGwENw4db3…#zUC74Snr…",
    "proofPurpose": "assertionMethod",
    `}
      <Mark note="proof" quiet>{`"proofValue": "u2WMEhlhQjT7nv6WxLK9BfqRukmgnh5Uega…"`}</Mark>
      {`
  }
}`}
    </pre>
  );
}

export function CredentialAnatomy() {
  return (
    <AnatomyFigure
      id="credential-anatomy-figure"
      eyebrow="figure 1 · a signed credential, verbatim"
      title="The license as the wallet holds it"
      notes={NOTES}
      caption="The wallet keeps this document exactly as issued and never sends it to anyone. Everything a verifier ever sees is derived from it."
      footer={
        <>
          <ByteStrip
            title="Inside proofValue — 447 bytes, decoded"
            segments={[
              { label: "tag", bytes: "3 B", color: "hidden", grow: 1.4 },
              { label: "BBS signature", bytes: "80 B", color: "proven", grow: 5.2 },
              { label: "header", bytes: "96 B", color: "wire", grow: 5.6 },
              { label: "issuer public key", bytes: "96 B", color: "wire", grow: 5.6 },
              { label: "HMAC key", bytes: "32 B", color: "hidden", grow: 3.2 },
              { label: "mandatory pointers", bytes: "text", color: "disclosed", grow: 3.4 },
              { label: "twin declarations", bytes: "text", color: "proven", grow: 4.2 },
            ]}
          />
          <ByteStrip
            title="The 80-byte signature itself"
            segments={[
              { label: "A — a point on BLS12-381", bytes: "48 B", color: "proven", grow: 6 },
              { label: "e — a scalar", bytes: "32 B", color: "proven", grow: 4 },
            ]}
            legend={[
              {
                color: "hidden",
                label: "envelope tag",
                text: "a multibase u plus three tag bytes (d9 63 04) naming a credkit holder-bound base proof — a value that can never be mistaken for another suite's.",
              },
              {
                color: "proven",
                label: "BBS signature",
                text: "80 bytes whether it covers five messages or fifty. Here it covers 32 slots: the license's 28 canonicalized statements, the two hidden numeric twins, and the holder's blind link-secret commitment with its blinding factor.",
              },
              {
                color: "wire",
                label: "header",
                text: "three 32-byte hashes pinning the proof configuration, the mandatory-pointer set, and the twin declarations. Change any of them and the signature no longer verifies.",
              },
              {
                color: "wire",
                label: "issuer public key",
                text: "the DMV's BLS12-381 key, cross-checked against the did:key in the document.",
              },
              {
                color: "hidden",
                label: "HMAC key",
                text: "keys a pseudorandom shuffle of statement labels, so the numbering of statements never becomes a fingerprint of its own.",
              },
              {
                color: "disclosed",
                label: "mandatory pointers",
                text: "/issuer, /validFrom, /validUntil — the fields every future presentation must disclose.",
              },
              {
                color: "proven",
                label: "twin declarations",
                text: "birth_date → date1900, revocationId → frScalar: which hidden twins the signature carries and how each one is encoded. They sit as plain text in the base64 tail of proofValue.",
              },
            ]}
          />
        </>
      }
    >
      <CredentialJson />
    </AnatomyFigure>
  );
}
