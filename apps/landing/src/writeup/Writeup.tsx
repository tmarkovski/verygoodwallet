/**
 * /writeup/ is the canonical long-form article about the ideas, history, and
 * implementation behind VeryGoodWallet. It is written for newcomers and
 * practitioners alike.
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
          VeryGoodWallet: the identity wallet I wanted to build years ago
        </h1>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-dim">
          The story and technology behind a passkey-native identity wallet, an
          issuer, and two verifiers. The setting is fictional, but the protocols
          and cryptography are real. You do not need a background in
          zero-knowledge proofs to follow along, but there is enough detail here
          if you already have one.
        </p>
      </header>

      <article className="prose mt-4">
        <h2>Where the idea came from</h2>
        <p>
          I have been thinking about versions of this project for a long time.
          The idea goes back to what first excited me about decentralized
          identity and to the conversations that eventually led my two
          co-founders and me to start Trinsic.
        </p>
        <p>
          We met through the early decentralized identity community, at a
          conference where people were building and promoting technologies such
          as AnonCreds and the work happening around the Sovrin Foundation. The
          three of us shared a belief that people should have more control over
          how their identity information was held and used.
        </p>
        <p>
          The part of that vision that especially captured my imagination was
          the wallet. I was excited by the possibility that a person could hold
          trusted credentials, decide when to use them, and prove what was
          necessary without routinely handing over an entire identity document.
        </p>
        <p>
          That idea shaped our earliest work at Trinsic and stayed with me
          throughout the five years I spent there. We were able to explore
          important parts of it using the technologies available at the time,
          but several pieces that now feel essential were not ready yet.
        </p>
        <p>
          Passkeys did not exist. Key management was difficult. Credential
          issuance and presentation protocols were still developing.
          Browser-based cryptography came with significant practical
          constraints. Building the experience I imagined meant asking users
          and developers to carry much more complexity than I wanted.
        </p>
        <p>
          This particular question stayed with me: what should a private,
          user-controlled identity wallet actually feel like?
        </p>
        <p>
          VeryGoodWallet is my personal return to that question. It is not an
          attempt to recreate an earlier product or prescribe where identity
          technology should go. It is an exploration of what the wallet vision
          that originally excited me looks like with the technologies available
          now.
        </p>

        <h2>The pieces have caught up</h2>
        <p>
          Passkeys offer a practical foundation for wallet key management.
          OpenID for Verifiable Credential Issuance and OpenID for Verifiable
          Presentations provide much better plumbing between issuers, wallets,
          and verifiers. W3C Verifiable Credentials provide a recognizable
          document model for signed claims, and BBS signatures give us a strong
          cryptographic foundation for selective disclosure and freshly
          randomized presentations.
        </p>
        <p>
          Modern browsers have also become capable cryptographic runtimes. All
          of the cryptography on this site, including BBS signatures, range and
          membership proofs, cross-credential equality, and non-revocation
          proofs, runs in plain TypeScript on ordinary web infrastructure. There
          is no WASM, circuit compiler, proving key, or trusted setup.
        </p>
        <p>
          The individual pieces come from different parts of the identity, web,
          and cryptography communities. What interested me was whether they
          could now be pulled together into one coherent, browser-native
          experience.
        </p>

        <h2>Verifiable credentials, briefly</h2>
        <p>
          A verifiable credential is a signed set of claims. An issuer, such as
          a DMV, university, or employer, signs those claims and gives the
          credential to you. Later, you can show it to a verifier, who checks
          the signature with the issuer&apos;s public key. The verifier does not
          need to call the issuer, so the issuer never learns where you use the
          credential. The format is a W3C standard, and the demo&apos;s Utopia
          driver&apos;s license is a W3C Verifiable Credential.
        </p>
        <p>
          With a typical digital signature, though, you run into two problems
          right away:
        </p>
        <ul>
          <li>
            <strong>You have to show everything.</strong> The signature covers
            the whole document, so removing one field breaks it. Proving that
            you are over 18 means sharing your name, address, and exact birthday
            too, which is the same problem you have with a physical ID card.
          </li>
          <li>
            <strong>Presentations can be linked.</strong> If the same signature
            is shown in two places, the bytes match. Two verifiers can compare
            them and connect their records, even if you shared different fields
            with each one. The issuer can recognize its own signature too.
          </li>
        </ul>
        <p>
          The question, then, is whether you can prove that an issuer signed
          your credential without showing the whole thing or giving verifiers
          something they can compare later. That is where zero-knowledge proofs
          come in.
        </p>

        <h2>Your passkey is the wallet</h2>
        <p>
          Most identity wallets need some way to manage a long-lived secret.
          Historically, that often meant installing a native application,
          creating a custodial account, backing up keys, or asking someone to
          write down a seed phrase. VeryGoodWallet starts with something you may
          already have: a synced, phishing-resistant passkey.
        </p>
        <p>
          On supported authenticators, WebAuthn&apos;s <code>prf</code> extension
          gives the wallet the same secret material whenever you authenticate.
          The wallet passes that through HKDF to derive the keys it needs:
        </p>
        <pre>
          <code>{`passkey PRF output
  └─ HKDF
      ├─ vault key      AES-GCM over everything stored at rest
      ├─ link secret    one secret for life, blind-committed into
      │                 every credential, no issuer ever sees it
      └─ issuance keys  one per issuer, for request freshness only`}</code>
        </pre>
        <p>
          The passkey is more than a login mechanism. It is the root of the
          wallet&apos;s key hierarchy. The derived keys live only in memory while
          the wallet is unlocked, credentials are encrypted in the browser, and
          locking the wallet clears the key material. Recovery follows the
          passkey&apos;s existing synchronization model, such as iCloud Keychain or
          Google Password Manager.
        </p>
        <p>
          The link secret in the middle of that tree is what binds a credential
          to its holder. We will come back to that shortly.
        </p>

        <h2>The browser is part of the thesis</h2>
        <p>
          VeryGoodWallet is partly an identity experiment, but it is also a
          browser-cryptography experiment. I wanted to see how far an ordinary
          web application could go without depending on a native cryptographic
          library, a heavy WASM build, a SNARK runtime, or a backend-only
          cryptographic service.
        </p>
        <p>
          The wallet is a static browser application. Its keys are derived
          locally from the passkey, and its credentials remain encrypted
          locally. Issuance checks, selective disclosure, range and membership
          proofs, cross-credential equality, and non-revocation proof generation
          all happen on the holder side in the browser. No private credential
          needs to be sent to a wallet backend to construct a presentation.
        </p>
        <p>
          The demo still has issuer and verifier services, of course. Credential
          protocols require counterparties, and those services need somewhere
          to keep session state, apply trust policy, and publish registry
          information. VeryGoodWallet uses Cloudflare Workers for those
          responsibilities.
        </p>
        <p>
          The important distinction is that the cryptography is not tied to a
          privileged backend environment. Credkit is written in pure TypeScript,
          and the same implementation can run in the wallet&apos;s browser or in an
          issuer or verifier Worker. Presentation verification happens in each
          verifier&apos;s Worker in this demo. That is an architectural choice, not
          a limitation of the cryptographic implementation.
        </p>
        <p>
          Lightweight does not necessarily mean every JavaScript bundle is
          tiny. It means there is no native library to install, no language
          binding to maintain, no WASM compilation pipeline, and no separate
          cryptographic service required simply because the proof system cannot
          run in a browser.
        </p>

        <h2>BBS: a signature you can quote from</h2>
        <p>
          The license uses BBS, named for Boneh, Boyen, and Shacham. It grew out
          of their 2004 work on group signatures and is now specified in an{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-bbs-signatures/">
            IETF draft
          </a>
          . BBS signs a <em>list</em> of messages rather than one blob, and you
          never show the signature itself. Instead, the wallet creates a new{" "}
          <em>proof</em> for each presentation. That proof confirms that the
          wallet holds a valid signature from the issuer while revealing only
          the messages you choose. The verifier knows the hidden messages were
          signed, but does not learn what they say.
        </p>
        <p>This gives us two useful properties:</p>
        <ul>
          <li>
            <strong>Selective disclosure.</strong> Reveal a birth date to one
            verifier and only an over-18 flag to another, all from the same
            credential. The wallet&apos;s consent screen lets you make that choice.
          </li>
          <li>
            <strong>Unlinkability.</strong> Each proof is randomized, so two
            presentations of the same credential do not share anything that can
            be matched. The only possible overlap comes from values you choose
            to disclose in both places.
          </li>
        </ul>
        <p>
          If you want the cryptographic detail, a BBS-derived proof is a
          zero-knowledge proof that the wallet knows the signature. It uses a
          sigma protocol with the same commit, challenge, and response steps as
          Schnorr identification, then makes it non-interactive by hashing the
          transcript with Fiat-Shamir. There is no circuit compiler, proving
          key, or setup ceremony. It is pairing arithmetic on BLS12-381, all
          running in plain TypeScript.
        </p>
        <p>
          There is an important limit: unlinkability is only as good as the
          information you disclose. If an issuer adds a holder identifier such
          as <code>credentialSubject.id</code>, it appears in every derived proof
          and can be used to link them. The DMV deliberately leaves out holder
          identifiers, so presentations contain no DID, public key, or{" "}
          <code>holder</code> property. That leads to the next question.
        </p>
        <p className="spec-credit">
          A quick shoutout to the people behind these drafts: Tobias Looker,
          Vasilis Kalos, Andrew Whitehead, and Mike Lodder on the{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-bbs-signatures/">
            core BBS specification
          </a>
          , and Vasilis Kalos and Greg M. Bernstein on the{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-bbs-blind-signatures/">
            blind BBS specification
          </a>
          . Thanks as well to the wider CFRG community that helped move both
          forward.
        </p>

        <h2>Whose credential is it, then?</h2>
        <p>
          If the credential does not identify its holder, what stops someone
          else from presenting a copy? This is where the link secret and blind
          issuance come in. When the credential is issued, the wallet derives
          one lifelong link secret from the passkey and sends the DMV a{" "}
          <em>commitment</em> to it, along with proof that the wallet knows the
          secret. Following the IETF&apos;s blind BBS extension, the DMV includes
          that committed value in the signed credential without seeing the
          secret itself. Only your passkey can reproduce the secret, and the DMV
          never learns it.
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
          while the claim itself stays hidden. When the DMV issues a license, it
          encodes the birth date as a number, measured in days since 1900, and
          includes that hidden value in the signature alongside the readable
          date. The wallet can then add a range proof to a presentation:
        </p>
        <pre>
          <code>{`prove:  birth_date ≤ cutoff

        birth_date   hidden, signed at issuance
        cutoff       public, computed by the verifier per request`}</code>
        </pre>
        <p>
          Earlier birth dates have smaller numbers, so at least 18 is a ≤
          comparison. The Nightcap checks an 18-year cutoff, while Utopia Wheels
          checks 25 against the same credential. The verifier chooses the cutoff
          for each request, so the credential does not need a separate field for
          every possible age rule.
        </p>
        <p>
          The demo license also includes <code>age_over_18/21/25</code> flags to
          show the difference. Those flags can answer only the questions chosen
          when the credential was issued, while a range proof can use any cutoff
          when it is presented. If the condition is false, as it is for the
          demo&apos;s under-18 persona at the bottle shop, the wallet cannot create
          the proof.
        </p>
        <p>
          Set membership works in a similar way. The Utopia Resident
          Registration contains a numeric district code, and a proof can show
          that the code belongs to a set chosen by the verifier, such as the
          coastal districts, without revealing which district it is.
        </p>
        <p>
          Both the range and membership proofs come from a 2008 protocol by
          Camenisch, Chaabouni, and Shelat, in the same sigma-protocol family as
          the BBS proof. They share one Fiat-Shamir transcript with the BBS
          proof, which ties each predicate directly to the signed hidden value
          it checks.
        </p>
        <p>
          Each verifier publishes its proof parameters at a well-known URL, and
          the wallet checks their hash before creating a proof. Otherwise, a
          verifier could return slightly different parameters to each visitor
          and use them as tags. The verifier&apos;s Cloudflare Worker checks the BBS
          presentation and its predicates in plain TypeScript, then returns the
          final verdict.
        </p>

        <h2>Linking as a choice</h2>
        <p>
          Presentations are unlinkable by default, but sometimes you may want to
          prove that two credentials belong to the same person. Utopia
          Wheels&apos; resident-rate check needs to confirm three things: the
          customer is over 25, lives in a coastal district, and is the holder of
          both credentials. You could prove the last part by disclosing a name
          from each credential, but this demo does it without sharing one:
        </p>
        <pre>
          <code>{`statement 1  driver's license       prove: birth_date ≤ cutoff(25)
statement 2  resident registration  prove: district ∈ coastal set
linkage      both credentials hide the SAME link secret

disclosed: nothing`}</code>
        </pre>
        <p>
          The wallet combines all three checks in one presentation. The
          equality proof confirms that both credentials contain the same hidden
          link secret, which is possible because the wallet committed the same
          passkey-derived secret to each one when they were issued.
        </p>
        <p>
          The verifier learns only the intended result, which is over 25,
          coastal resident, and same holder, plus the issuer and validity window
          included in every presentation. The holder chooses when to prove this
          link. Verifiers cannot discover it later from separate presentations.
        </p>

        <h2>What two verifiers can compare</h2>
        <p>
          The wallet keeps an encrypted log of every presentation. At the end of
          the demo, it puts what each verifier received side by side and shows
          any claim-and-value pairs they have in common.
        </p>
        <p>
          The proofs themselves do not add anything matchable because no holder
          identifier is included and every proof is randomized. Only values you
          choose to disclose to both verifiers can overlap. If you visit the
          shop with a range proof, then share your name and license number only
          with the rental counter, their databases have no common value they can
          use to connect the records.
        </p>

        <h2>Privacy-preserving revocation</h2>
        <p>
          A private credential still needs a way to stop being valid. Every
          credential the Utopia DMV signs is enrolled in an accumulator-backed
          revocation registry. The credential contains a fresh revocation id as
          a permanently hidden signed value, while the wallet keeps a separate
          membership witness showing that the id belongs to the issuer&apos;s current
          unrevoked set.
        </p>
        <p>
          When the DMV revokes a credential, the registry publishes a new epoch
          and public update records. Every non-revoked wallet can update its
          witness from the same published data. The wallet downloads the
          registry state as a whole, so the registry does not learn which
          credential is asking.
        </p>
        <p>
          During presentation, the verifier requires a non-revocation proof
          against the registry state it trusts. That proof is bound to the BBS
          credential proof and the rest of the presentation under the same
          challenge. The verifier learns exactly one fact, that the credential
          is still valid, but never sees the hidden revocation id or which
          registry entry produced the proof.
        </p>

        <h2>How it fits with existing standards</h2>
        <p>
          The demo brings these privacy features to protocols and formats that
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
            <strong>
              OpenID for Verifiable Presentations (OID4VP) with DCQL.
            </strong>{" "}
            Verifiers make requests in the standard query language. Predicate,
            linkage, and non-revocation requirements are small, documented
            extensions. Requests are passed by reference to keep QR codes
            scannable, responses return through <code>direct_post</code>, and
            each proof is bound to the request&apos;s one-time nonce and the
            verifier&apos;s identity so it cannot be replayed somewhere else.
          </li>
          <li>
            <strong>W3C Verifiable Credentials.</strong> Credentials are VC Data
            Model 2.0 documents with Data Integrity proofs, using standard
            JSON-LD processing and envelopes.
          </li>
          <li>
            <strong>IETF BBS.</strong> The signature core implements the CFRG BBS
            draft and its blind-issuance companion. The implementation is
            checked against the drafts&apos; published test fixtures.
          </li>
        </ul>
        <p>
          There is one important exception: the cryptosuite itself is
          experimental. The W3C&apos;s candidate BBS suite, <code>bbs-2023</code>,
          supports selective disclosure, but not predicates, multi-credential
          presentations, or a link secret. This demo uses{" "}
          <code>credkit-bbs-sha-2026</code>, an experimental Data Integrity suite
          from <a href="https://github.com/tmarkovski/credkit">credkit</a>, a
          companion project of mine.
        </p>
        <p>
          People who have worked with earlier privacy-preserving credential
          systems will recognize many of these goals. Some of those systems,
          including AnonCreds, were an important part of my own history in this
          field. Credkit approaches the problem through today&apos;s BBS, Verifiable
          Credential, OpenID4VC, passkey, and browser ecosystem.
        </p>
        <p>
          Credkit keeps <code>bbs-2023</code>&apos;s document pipeline, including
          canonicalization, selection, and mandatory pointers, and replaces the
          proof layer with the composite construction described above. Its
          identifiers are deliberately distinct, and a{" "}
          <a href="https://tmarkovski.github.io/credkit/">
            draft specification
          </a>{" "}
          documents the construction.
        </p>
        <p>
          It is research work, not a standard. The proofs use the same commit,
          challenge, and response phases and the same disciplined transcript
          that the CFRG&apos;s emerging{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-sigma-protocols/">
            sigma-protocols
          </a>{" "}
          and{" "}
          <a href="https://datatracker.ietf.org/doc/draft-irtf-cfrg-fiat-shamir/">
            Fiat-Shamir
          </a>{" "}
          drafts describe. What those drafts do not yet cover, composing several
          statements under one challenge, is the gap the credkit draft
          documents.
        </p>

        <h2>What is real and what remains experimental</h2>
        <p>
          VeryGoodWallet is a real implementation, not a clickable mockup. The
          issuer signs credentials. The wallet encrypts and stores them.
          OpenID4VCI and OpenID4VP move them between parties. The wallet
          constructs real zero-knowledge proofs, and the verifier checks them.
          Credentials can be revoked, witnesses can be updated from published
          registry records, and non-revocation is enforced during presentation.
        </p>
        <p>But it is not a production wallet.</p>
        <ul>
          <li>
            <strong>It is research software.</strong> Neither credkit nor this
            site has been independently audited. The custom proof and
            cryptosuite layers do not have an independent implementation or
            external interoperability test suite.
          </li>
          <li>
            <strong>Issuer trust starts with TLS.</strong> The verifiers pin the
            DMV&apos;s DID from its metadata endpoint. A production system would need
            <code>did:web</code> or a trust registry.
          </li>
          <li>
            <strong>Privacy still has edges.</strong> Information the holder
            deliberately discloses can still be compared. Credential validity
            windows create a small correlation surface, and registry access
            needs appropriate caching and distribution to reduce timing signals.
          </li>
          <li>
            <strong>Losing every copy of the passkey means losing the wallet.</strong>{" "}
            Passkey sync is the recovery mechanism, so the wallet depends on it.
          </li>
          <li>
            <strong>The cast is fictional.</strong> The State of Utopia issues no
            real licenses, the shop sells nothing, and the rental fleet is six
            SVGs. The cryptography and protocols are real.
          </li>
        </ul>

        <h2>A vision I have carried with me</h2>
        <p>
          I built VeryGoodWallet and much of credkit over a couple of weekends,
          with modern coding models helping me explore, implement, test, and
          document the system at a pace that would have been hard to imagine
          when I first entered this space.
        </p>
        <p>
          The mathematics behind many of these ideas is not new. The privacy
          goals are not new. What has changed is how accessible the pieces have
          become, and how quickly one person can now turn a long-held
          architecture into running software.
        </p>
        <p>
          I do not see VeryGoodWallet as the finished answer to digital identity.
          It is research software, and there is plenty here that deserves
          scrutiny. But it is the first time I have been able to put this
          particular idea together in the form I originally imagined: a wallet
          managed by something people already use, credentials exchanged through
          recognizable protocols, and privacy-preserving proofs running directly
          in an ordinary web environment.
        </p>
        <p>
          For me, it feels like finally exploring the wallet vision that first
          excited me about this space with tools that can now do it justice.
        </p>

        <h2>Colophon</h2>
        <p>
          The project is a pnpm monorepo built with React, Vite, and Tailwind on
          Cloudflare Workers&apos; free tier. The Worker APIs use Hono, and
          verification sessions live in SQLite-backed Durable Objects. Credkit
          handles the BBS core, range and membership proofs, accumulator
          revocation, composite presentations, and the JSON-LD cryptosuite in
          pure TypeScript over BLS12-381. WebAuthn PRF and HKDF provide the key
          hierarchy, with no WASM anywhere. Every major flow has unit,
          integration, and live end-to-end tests. Source:{" "}
          <a href="https://github.com/tmarkovski/verygoodwallet">
            github.com/tmarkovski/verygoodwallet
          </a>{" "}
          and <a href="https://github.com/tmarkovski/credkit">
            github.com/tmarkovski/credkit
          </a>
          .
        </p>
      </article>
    </div>
  );
}
