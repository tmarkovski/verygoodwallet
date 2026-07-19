/**
 * /writeup/ — the long-form page: an explainer of the ideas the demo runs on
 * (verifiable credentials, BBS signatures, zero-knowledge predicates),
 * written for newcomers and practitioners alike.
 */

export function Writeup() {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-24">
      <header className="pt-12">
        <a
          href="/"
          className="font-label text-[11px] uppercase tracking-[0.2em] text-stamp underline decoration-stamp/50 underline-offset-2 hover:decoration-stamp"
        >
          ← back to the cover
        </a>
        <h1 className="mt-6 font-display text-4xl font-bold leading-tight tracking-tight">
          How VeryGoodWallet works
        </h1>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-dim">
          A passkey-native identity wallet, an issuer, and two verifiers —
          real protocols, real cryptography, free-tier infrastructure. This
          page explains how it all works, starting with verifiable credentials
          and moving through range proofs and holder binding. You don't need a
          background in zero-knowledge proofs, but there's enough detail here
          if you already have one.
        </p>
      </header>

      <article className="prose mt-4">
        <h2>Why this site exists</h2>
        <p>
          I used to work in digital identity, so this project is partly a
          return to an area I still care about. It brings together two ideas
          that people in my corner of the field spent years working toward:
          credentials that can keep claims private, and presentations that
          different verifiers can't link to one another. The math already
          existed. These proof systems are sigma protocols, a family that
          dates back to the late eighties. What was missing was everything
          around them: implementations that ran in a browser, protocols for
          moving credentials between parties, and a practical way for people
          to manage keys without seed phrases.
        </p>
        <p>
          Those pieces are much more practical now. All of the cryptography on
          this site — including BBS signatures, range proofs, and membership
          proofs — runs in plain TypeScript on ordinary web infrastructure,
          with no WASM, circuits, or trusted setup. Passkeys also turn out to
          be a good fit for key management. This demo puts it all together in
          a working wallet, an issuer, and two verifiers.
        </p>

        <h2>Verifiable credentials, briefly</h2>
        <p>
          A verifiable credential is a signed set of claims. An issuer — a
          DMV, a university, or an employer — signs those claims and gives the
          credential to you. Later, you can show it to a verifier, who checks
          the signature with the issuer's public key. The verifier doesn't
          need to call the issuer, so the issuer never learns where you use
          the credential. The format is a W3C standard, and the demo's Utopia
          driver's license is a W3C Verifiable Credential.
        </p>
        <p>
          With a typical digital signature, though, you run into two problems
          right away:
        </p>
        <ul>
          <li>
            <strong>You have to show everything.</strong> The signature covers
            the whole document, so removing one field breaks it. Proving that
            you're over 18 means sharing your name, address, and exact birthday
            too — the same problem you have with a physical ID card.
          </li>
          <li>
            <strong>Presentations can be linked.</strong> If the same signature
            is shown in two places, the bytes match. Two verifiers can compare
            them and connect their records, even if you shared different
            fields with each one. The issuer can recognize its own signature
            too.
          </li>
        </ul>
        <p>
          The question, then, is whether you can prove that an issuer signed
          your credential without showing the whole thing or giving verifiers
          something they can compare later. That's where zero-knowledge proofs
          come in.
        </p>

        <h2>Your passkey is the wallet</h2>
        <p>
          Before getting into credentials, it helps to explain how the wallet
          handles its secret. Most identity wallets ask you to install an app,
          write down a seed phrase, or trust a custodian. VeryGoodWallet starts
          with something you may already have: a synced, hardware-backed,
          phishing-resistant passkey. WebAuthn's <code>prf</code> extension
          lets the wallet ask that passkey for the same secret each time you
          authenticate. From there, it derives the keys it needs:
        </p>
        <pre>
          <code>{`passkey PRF output
  └─ HKDF
      ├─ vault key      AES-GCM over everything stored at rest
      ├─ link secret    one secret for life, blind-committed into
      │                 every credential — no issuer ever sees it
      └─ issuance keys  one per issuer, for request freshness only`}</code>
        </pre>
        <p>
          Those keys don't need a separate backup because the wallet can
          derive them again from the passkey. Recovery depends on passkey sync,
          such as iCloud Keychain or Google Password Manager. The wallet itself
          is a static web page, and locking it simply clears the derived keys.
          The link secret in the middle of that tree is what binds a credential
          to its holder. We'll come back to that shortly.
        </p>

        <h2>BBS: a signature you can quote from</h2>
        <p>
          The license uses BBS, named for Boneh, Boyen, and Shacham. It grew
          out of their 2004 work on group signatures and is now specified in an{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-bbs-signatures/">
            IETF draft
          </a>. BBS signs a <em>list</em> of messages rather than one blob, and
          you never show the signature itself. Instead, the wallet creates a
          new <em>proof</em> for each presentation. That proof confirms that the
          wallet holds a valid signature from the issuer while revealing only
          the messages you choose. The verifier knows the hidden messages were
          signed, but doesn't learn what they say. This gives us two useful
          properties:
        </p>
        <ul>
          <li>
            <strong>Selective disclosure.</strong> Reveal a birth date to one
            verifier and only an over-18 flag to another, all from the same
            credential. The wallet's consent screen lets you make that choice.
          </li>
          <li>
            <strong>Unlinkability.</strong> Each proof is randomized, so two
            presentations of the same credential don't share anything that
            can be matched. The only possible overlap comes from values you
            choose to disclose in both places.
          </li>
        </ul>
        <p>
          If you want the cryptographic detail, a BBS-derived proof is a
          zero-knowledge proof that the wallet knows the signature. It uses a
          sigma protocol with the same commit, challenge, and response steps
          as Schnorr identification, then makes it non-interactive by hashing
          the transcript with Fiat–Shamir. There is no circuit compiler,
          proving key, or setup ceremony — just pairing arithmetic on
          BLS12-381, all running in plain TypeScript.
        </p>
        <p>
          There is an important limit: unlinkability is only as good as the
          information you disclose. If an issuer adds a holder identifier such
          as <code>credentialSubject.id</code>, it appears in every derived
          proof and can be used to link them. The DMV deliberately leaves out
          holder identifiers, so presentations contain no DID, public key, or{" "}
          <code>holder</code> property. That leads to the next question.
        </p>
        <p className="spec-credit">
          A quick shoutout to the people behind these drafts: Tobias Looker,
          Vasilis Kalos, Andrew Whitehead, and Mike Lodder on the{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-bbs-signatures/">
            core BBS specification
          </a>, and Vasilis Kalos and Greg M. Bernstein on the{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-bbs-blind-signatures/">
            blind BBS specification
          </a>. Thanks as well to the wider CFRG community that helped move both
          forward.
        </p>

        <h2>Whose credential is it, then?</h2>
        <p>
          If the credential doesn't identify its holder, what stops someone
          else from presenting a copy? This is where the link secret and blind
          issuance come in. When the credential is issued, the wallet derives
          one lifelong link secret from the passkey and sends the DMV a{" "}
          <em>commitment</em> to it, along with proof that the wallet knows the
          secret. Following the IETF's blind BBS extension, the DMV includes
          that committed value in the signed credential without seeing the
          secret itself. Only your passkey can reproduce the secret, and the
          DMV never learns it.
        </p>
        <p>
          From then on, the wallet has to prove that it knows the same hidden
          secret whenever it uses the credential. That shows the presenter
          controls the credential without revealing an identifier, even a
          pairwise one. Because the wallet commits the <em>same</em> secret to
          every credential it collects, it can also prove that two credentials
          belong to the same holder when needed.
        </p>

        <h2>Proving facts about hidden values</h2>
        <p>
          Selective disclosure lets you reveal or hide whole claims. Range
          proofs go a step further: they prove something <em>about</em> a claim
          while the claim itself stays hidden. When the DMV issues a license,
          it encodes the birth date as a number (days since 1900) and includes
          that hidden value in the signature alongside the readable date. The
          wallet can then add a range proof to a presentation:
        </p>
        <pre>
          <code>{`prove:  birth_date ≤ cutoff

        birth_date — hidden, signed at issuance
        cutoff     — public, computed by the verifier per request`}</code>
        </pre>
        <p>
          Earlier birth dates have smaller numbers, so "at least 18" is a ≤
          comparison. The Nightcap checks an 18-year cutoff, while Utopia
          Wheels checks 25 against the same credential. The verifier chooses
          the cutoff for each request, so the credential doesn't need a
          separate field for every possible age rule. The demo license also
          includes <code>age_over_18/21/25</code> flags to show the difference:
          those flags can answer only the questions chosen when the credential
          was issued, while a range proof can use any cutoff when it is
          presented. If the condition is false — as it is for the demo's
          under-18 persona at the bottle shop — the wallet can't create the
          proof.
        </p>
        <p>
          Set membership works in a similar way. The Utopia Resident
          Registration contains a numeric district code, and a proof can show
          that the code belongs to a set chosen by the verifier — the coastal
          districts, for example — without revealing which district it is.
          Both the range and membership proofs come from a 2008 protocol by
          Camenisch, Chaabouni, and Shelat, in the same sigma-protocol family
          as the BBS proof. They share one Fiat–Shamir transcript with the BBS
          proof, which ties each predicate directly to the signed hidden value
          it checks.
        </p>
        <p>
          Two implementation details matter here. Each verifier publishes its
          proof parameters at a well-known URL, and the wallet checks their
          hash before creating a proof. Otherwise, a verifier could return
          slightly different parameters to each visitor and use them as tags.
          Verification happens on the verifier's Cloudflare Worker. It checks
          the BBS presentation and its predicates in plain TypeScript, then
          returns the final verdict. The same cryptography could run in a
          browser, but this demo keeps verification server-side and requires
          no WASM.
        </p>

        <h2>Linking as a choice</h2>
        <p>
          Presentations are unlinkable by default, but sometimes you may want
          to prove that two credentials belong to the same person. Utopia
          Wheels' resident-rate check needs to confirm three things: the
          customer is over 25, lives in a coastal district, and is the holder
          of both credentials. You could prove the last part by disclosing a
          name from each credential, but this demo does it without sharing one:
        </p>
        <pre>
          <code>{`statement 1  driver's license       prove: birth_date ≤ cutoff(25)
statement 2  resident registration  prove: district ∈ coastal set
linkage      both credentials hide the SAME link secret

disclosed: nothing`}</code>
        </pre>
        <p>
          The wallet combines all three checks in one presentation. The
          equality proof confirms that both credentials contain the same
          hidden link secret, which is possible because the wallet committed
          the same passkey-derived secret to each one when they were issued.
          The verifier learns only the intended result — over 25, coastal
          resident, same holder — plus the issuer and validity window included
          in every presentation. The holder chooses when to prove this link;
          verifiers can't discover it later from separate presentations.
        </p>

        <h2>What two verifiers can compare</h2>
        <p>
          The wallet keeps an encrypted log of every presentation. At the end
          of the demo, it puts what each verifier received side by side and
          shows any claim-and-value pairs they have in common. The proofs
          themselves don't add anything matchable because no identifier is
          included and every proof is randomized. Only values you choose to
          disclose to both verifiers can overlap. If you visit the shop with a
          range proof, then share your name and license number only with the
          rental counter, their databases have no common value they can use to
          connect the records.
        </p>

        <h2>How it fits with existing standards</h2>
        <p>
          The demo adds these privacy features to protocols and formats that
          are already used for verifiable credentials:
        </p>
        <ul>
          <li>
            <strong>OpenID for Verifiable Credential Issuance (OID4VCI).</strong>{" "}
            The DMV uses the pre-authorized code flow. The holder-binding
            commitment is an extension field in the credential request,
            alongside the standard proof-of-possession JWT.
          </li>
          <li>
            <strong>OpenID for Verifiable Presentations (OID4VP) with DCQL.</strong>{" "}
            Verifiers make requests in the standard query language. Predicate
            and linkage requirements (<code>vgw_predicates</code>,{" "}
            <code>vgw_equalities</code>) are small, documented extensions.
            Requests are passed by reference to keep QR codes scannable,
            responses return through <code>direct_post</code>, and each proof
            is bound to the request's one-time nonce and the verifier's
            identity so it can't be replayed somewhere else.
          </li>
          <li>
            <strong>W3C Verifiable Credentials.</strong> Credentials are VC
            Data Model 2.0 documents with Data Integrity proofs, using
            standard JSON-LD processing and envelopes.
          </li>
          <li>
            <strong>IETF BBS.</strong> The signature core implements the
            CFRG BBS draft and its blind-issuance companion. The implementation
            is checked against the drafts' published test fixtures.
          </li>
        </ul>
        <p>
          There is one important exception: the cryptosuite itself is
          experimental. The W3C's candidate BBS suite, <code>bbs-2023</code>,
          supports selective disclosure, but not predicates,
          multi-credential presentations, or a link secret. This demo uses{" "}
          <code>credkit-bbs-sha-2026</code>, an experimental Data Integrity
          suite from{" "}
          <a href="https://github.com/tmarkovski/credkit">credkit</a>, a
          companion project of mine. It keeps bbs-2023's document pipeline —
          canonicalization, selection, mandatory pointers — and replaces the
          proof layer with the composite construction described above. The
          suite has deliberately distinct identifiers to avoid confusion, and a{" "}
          <a href="https://tmarkovski.github.io/credkit/">
            draft specification
          </a>{" "}
          documents the construction. It is research work, not a standard —
          though it is written to line up with where the CFRG is heading: the
          proofs use the same commit/challenge/response phases and the same
          disciplined transcript that the research group's emerging{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-sigma-protocols/">
            sigma-protocols
          </a>{" "}
          and{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-fiat-shamir/">
            Fiat–Shamir
          </a>{" "}
          drafts standardize. What those drafts don't yet cover — composing
          several statements under one challenge — is exactly the gap the
          credkit draft documents.
        </p>

        <h2>What this demo doesn't claim</h2>
        <ul>
          <li>
            <strong>It is research software.</strong> Neither credkit nor
            this site has been independently audited. The demo is here to show
            how the architecture works, not to protect real credentials.
          </li>
          <li>
            <strong>Issuer trust starts with TLS.</strong> The verifiers pin the
            DMV's DID from its metadata endpoint. A production system would
            need <code>did:web</code> or a trust registry.
          </li>
          <li>
            <strong>Revocation is privacy-preserving — but the registry is
            one URL.</strong> Every credential enrolls in the DMV's
            accumulator-backed registry; verifiers check a non-revocation
            proof against the registry's current state and learn one bit,
            never which entry. What remains a limitation: the validity window
            is always disclosed (a small comparable surface), and fetching
            registry state at presentation time has a timing surface a
            production deployment would blunt with CDN-cached update records.
          </li>
          <li>
            <strong>Losing every copy of the passkey means losing the wallet.</strong>{" "}
            Passkey sync is the recovery mechanism, so the wallet depends on
            it.
          </li>
          <li>
            <strong>The cast is fictional.</strong> The State of Utopia
            issues no real licenses, the shop sells nothing, and the rental
            fleet is six SVGs. The cryptography and the protocols are real.
          </li>
        </ul>

        <h2>Colophon</h2>
        <p>
          The project is a pnpm monorepo built with React, Vite, and Tailwind
          on Cloudflare Workers' free tier. The Worker APIs use Hono, and
          verification sessions live in SQLite-backed Durable Objects. Credkit
          handles the BBS core, range and membership proofs, composite
          presentations, and the JSON-LD cryptosuite in pure TypeScript over
          BLS12-381. WebAuthn PRF and HKDF provide the key hierarchy, with no
          WASM anywhere. Every major flow has unit, integration, and live
          end-to-end tests. Source:{" "}
          <a href="https://github.com/tmarkovski/verygoodwallet">
            github.com/tmarkovski/verygoodwallet
          </a>{" "}
          and{" "}
          <a href="https://github.com/tmarkovski/credkit">
            github.com/tmarkovski/credkit
          </a>.
        </p>
      </article>
    </div>
  );
}
