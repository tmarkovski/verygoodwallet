/**
 * /writeup/ — the long-form technical page: architecture first, then the
 * findings log (the things that fought back), then honest limitations.
 */

export function Writeup() {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-24">
      <header className="pt-12">
        <a
          href="/"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-stamp underline decoration-stamp/50 underline-offset-2 hover:decoration-stamp"
        >
          ← back to the cover
        </a>
        <h1 className="mt-6 font-display text-4xl font-bold leading-tight tracking-tight">
          How VeryGoodWallet works
        </h1>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-dim">
          A passkey-native identity wallet, an issuer, and two verifiers —
          real protocols, real cryptography, free-tier infrastructure. This is
          the architecture, followed by the field notes: the things that only
          became visible because everything actually runs.
        </p>
      </header>

      <article className="prose mt-4">
        <h2>The premise</h2>
        <p>
          Digital identity wallets keep re-inventing the enrollment problem:
          install an app, write down a seed phrase, trust a custodian. But the
          platforms already solved secret management — the passkey is a
          synced, hardware-backed, phishing-resistant credential that hundreds
          of millions of people quietly carry. The demo's thesis is that a
          passkey is not just a way to <em>log in to</em> a wallet.{" "}
          <strong>The passkey is the wallet.</strong>
        </p>
        <p>
          WebAuthn's <code>prf</code> extension returns a deterministic secret
          bound to the credential during authentication. Everything else is
          derivation:
        </p>
        <pre>
          <code>{`passkey PRF output
  └─ HKDF
      ├─ vault key            AES-GCM over everything at rest
      ├─ holder seed(issuer)  one keypair per issuer, for holder binding
      └─ presenter seed(verifier origin)
                              one keypair per verifier — pairwise identities`}</code>
        </pre>
        <p>
          There is no seed phrase because there is nothing to back up: the
          hierarchy is reproducible from the passkey alone, and passkey sync
          (iCloud Keychain, Google Password Manager) is the recovery story.
          Locking the wallet is simply forgetting the derived keys; refresh
          the page and it's locked. The wallet is a static web page — no app
          store, no server-side account, no custodian.
        </p>

        <h2>Credentials that reveal exactly what you choose</h2>
        <p>
          The Utopia DMV issues a driver's license as a W3C Verifiable
          Credential signed with <code>bbs-2023</code>. BBS signatures allow
          the holder to derive, per presentation, a proof over any subset of
          the signed claims — and each derived proof is cryptographically
          unlinkable from every other. Alongside the usual fields, the license
          carries mdoc-style age flags (<code>age_over_18/21/25</code>)
          stamped at issuance, and one unusual claim: a Poseidon commitment to
          the birth date, whose purpose is the zero-knowledge tier below.
        </p>
        <p>
          The first thing the demo taught us about bbs-2023:{" "}
          <strong>
            selective disclosure structurally reveals embedded node
            identifiers
          </strong>
          . If the issuer writes a <code>credentialSubject.id</code> (the
          holder's DID) into the credential, that id appears in{" "}
          <em>every</em> derived proof, at every disclosure tier — a
          correlation handle that quietly defeats unlinkability across
          verifiers. So the DMV doesn't embed one. Holder binding happens at
          issuance instead: the wallet proves possession of a
          per-issuer key via a proof-of-possession JWT, and the credential
          stays free of identifiers. The wallet's consent screen warns loudly
          if a legacy credential still carries one.
        </p>

        <h2>Issuance and presentation, on the real rails</h2>
        <p>
          Both ceremonies speak the actual protocols, end to end. Issuance is
          OpenID for Verifiable Credential Issuance (OID4VCI), pre-authorized
          code flow: the DMV Worker mints a one-time offer, the wallet redeems
          it for an access token (stateless, HMAC-signed — no session store),
          presents its proof-of-possession, and verifies the issuer's
          signature before storing the credential encrypted under the vault
          key.
        </p>
        <p>
          Presentation is OpenID for Verifiable Presentations (OID4VP) with
          DCQL. A verifier's request declares alternatives as{" "}
          <code>claim_sets</code> — the age flag, or the birth date, or the
          commitment plus a zero-knowledge proof — and the wallet renders that
          as a disclosure-tier picker: <em>show everything</em> /{" "}
          <em>share only what's asked</em> /{" "}
          <em>prove the age, never the date</em>. The response is a{" "}
          <code>direct_post</code> of a VP wrapped in an{" "}
          <code>eddsa-rdfc-2022</code> signature whose challenge is the
          request nonce and whose domain is the verifier — replay armor in
          both directions. The presenting key is derived from the verifier's{" "}
          <em>origin</em>, so The Nightcap and Utopia Wheels each see a
          different holder DID by construction. Cross-device flows poll a
          write-once, SQLite-backed Durable Object session that self-purges.
        </p>

        <h2>The zero-knowledge tier</h2>
        <p>
          The license's <code>birthDateCommitment</code> is{" "}
          <code>Poseidon2(dob_days, blinding)</code> — the birth date as days
          since the epoch, sealed with a blinding factor the wallet keeps in
          its vault. A Noir circuit proves, in about half a second:
        </p>
        <pre>
          <code>{`dob_days ≤ cutoff_days            // public: the verifier's age cutoff
Poseidon2(dob_days, blinding) == commitment   // public: the BBS-disclosed claim`}</code>
        </pre>
        <p>
          The proof (UltraHonk, via bb.js) travels inside the VP as a{" "}
          <code>zkAgeProof</code> bundle, covered by the VP's outer signature
          — tampering with the bundle is just a signature failure. The
          verifier re-derives the public inputs itself: the commitment must
          equal the claim BBS actually disclosed, and the cutoff must match
          its own policy computed at verification time (one day of clock skew
          allowed). Nothing prover-supplied is trusted beyond the proof bytes.
        </p>
        <p>
          The elegant part is what <em>doesn't</em> change: the shop checks
          "over 18", the rental counter checks "over 25", and both verify
          against the <strong>same commitment</strong> — the cutoff is a
          public input, not a property of the credential. One sealed birthdate
          answers any age policy, forever. And because each verifier's DCQL
          declares which claims ride alongside the proof (the claim set
          containing the commitment), the shop's proof arrives with nothing
          else while the rental's arrives with a name and license number —
          policy expressed in the query language, not in custom code.
        </p>

        <h2>Field notes: what fought back</h2>
        <h3>Cloudflare Workers cannot run the verifier</h3>
        <p>
          bb.js instantiates WASM from bytes at runtime, which Workers
          prohibit — and its WASM alone nearly fills the free plan's 3 MiB
          script budget. Rather than pretend, the tier-2 verdict is split
          honestly: the Worker verifies the BBS proof, the VP wrapper, and
          every binding on the bundle, then returns{" "}
          <code>zk_pending</code>; the verifier's <em>own page</em>{" "}
          lazy-loads bb.js and runs the UltraHonk check against a
          verification key checked into the verifier's build. The e2e suite
          runs the identical call in Node — exactly what a self-hosted
          verifier would run server-side. An exhibit panel on the result page
          explains the split instead of hiding it.
        </p>
        <h3>workers.dev doesn't route worker-to-worker</h3>
        <p>
          A fetch from one <code>*.workers.dev</code> Worker to another on
          the same account never arrives. The verifiers therefore can't
          discover the DMV's issuer DID at runtime in production; the deploy
          workflow discovers it and pins it as a deploy-time variable.
          Consequence: rotating the issuer's seed means redeploying the
          verifiers. Custom domains route normally, which is one of the quiet
          wins of moving off workers.dev.
        </p>
        <h3>Threads need headers</h3>
        <p>
          Without <code>crossOriginIsolated</code>, bb.js falls back to
          single-threaded WASM: proving measured 33&nbsp;s. Shipping{" "}
          <code>COOP: same-origin</code> + <code>COEP: require-corp</code> on
          the static assets brought it to ~3.5&nbsp;s (proving, wallet) and
          ~2.3&nbsp;s (verifying, shop) on an 8-core machine. Separately, the
          first-ever verification on a fresh origin pays a one-time WASM
          fetch-and-compile of ~26&nbsp;s — so the guided tour warms the
          verifier in the background the moment you arrive at a shop, and the
          real check lands in well under a second.
        </p>
        <h3>Bundle discipline is a feature</h3>
        <p>
          Importing poseidon-lite's package root defeats tree-shaking and
          ships ~400&nbsp;KB of unused round constants in every bundle;
          subpath imports cut the shop client from 817 to 247&nbsp;KB. The ZK
          package splits its exports the same way — Worker-safe subpaths
          (bundle checks, cutoff math) versus WASM-adjacent ones (prove,
          verify) — because Workers upload every lazy chunk toward the size
          cap whether they run it or not.
        </p>
        <h3>One bit identifies nobody</h3>
        <p>
          The wallet keeps an encrypted log of what each verifier was shown
          and renders the cross-verifier exhibit: presenter DIDs side by
          side, and the honest correlation surface — the claim/value pairs
          both verifiers hold. The first live run flagged{" "}
          <code>age_over_18: true</code> and <code>age_over_25: true</code> as
          a shared value. That's a bug in the correlation model, not a leak: a
          boolean shared with half the population joins no records. The
          comparison now requires the same claim <em>and</em> the same
          non-boolean value — which is also the honest answer to "what could
          they learn by comparing notes?": only the values you chose to
          disclose to both. The shop got none.
        </p>

        <h2>What this demo doesn't claim</h2>
        <ul>
          <li>
            <strong>Issuer trust is bootstrapped over TLS.</strong> The
            verifiers pin the DMV's DID discovered from its metadata endpoint;
            a production system wants <code>did:web</code> or a trust
            registry.
          </li>
          <li>
            <strong>Losing every copy of the passkey loses the wallet.</strong>{" "}
            That's the deal with deterministic derivation; passkey sync is the
            mitigation, and it's a real dependency.
          </li>
          <li>
            <strong>No revocation, no audit.</strong> The credentials have
            validity windows but no status lists, and none of this code has
            been audited. It's a demonstration of an architecture, not a
            product.
          </li>
          <li>
            <strong>The cast is fictional.</strong> The State of Utopia issues
            no real licenses, the shop sells nothing, and the rental fleet is
            six SVGs. The cryptography, the protocols, and the timings are
            real.
          </li>
        </ul>

        <h2>Colophon</h2>
        <p>
          pnpm monorepo; React + Vite + Tailwind on Cloudflare Workers (free
          tier), Hono for the Worker APIs, SQLite-backed Durable Objects for
          verification sessions. Cryptography:{" "}
          <code>@digitalbazaar</code> bbs-2023 / eddsa-rdfc-2022 suites,
          WebAuthn PRF + HKDF, poseidon-lite, Noir +
          UltraHonk (bb.js). Every ceremony has unit, integration, and live
          end-to-end coverage, and the ZK artifacts are checked in with a CI
          freshness guard. Source and history:{" "}
          <a href="https://github.com/tmarkovski/verygoodwallet">
            github.com/tmarkovski/verygoodwallet
          </a>
          .
        </p>
      </article>
    </div>
  );
}
