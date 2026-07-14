/**
 * Live end-to-end: real DMV Worker → wallet-side crypto → real rentals
 * Worker (plus the real shop Worker for the cross-verifier exhibit).
 *
 * Gated behind VGW_E2E=1 because it needs the dev servers running:
 *
 *   pnpm --filter @vgw/dmv dev       # :5174
 *   pnpm --filter @vgw/shop dev     # :5175 (cross-verifier test only)
 *   pnpm --filter @vgw/rentals dev  # :5176
 *   VGW_E2E=1 pnpm --filter @vgw/rentals test
 *
 * What it proves that the unit suites cannot: the Workers agree on the wire
 * contracts over real HTTP, the rentals Worker discovers the DMV's issuer
 * DID from live metadata, a credential issued by the real issuance flow
 * verifies through the real direct_post — and, for M5, that the SAME
 * credential presented to the two live verifiers leaves them nothing to
 * correlate: different pairwise presenter DIDs, disjoint disclosures. The
 * one honest exception (found by the M6 guided tour): the ZK tier at BOTH
 * verifiers shows both the same issuer-signed commitment — the seal never
 * opens, but the seal itself is a joinable value, and the test pins that.
 */
import { describe, expect, it } from "vitest";
import { daysSinceEpoch, deriveHolderSeed, derivePresenterSeed, verifyCommitment } from "@vgw/keys";
import {
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  createProofJwt,
  type CredentialOffer,
  type CredentialResponse,
  type IssuerMetadata,
  type TokenResponse,
} from "@vgw/protocols";
import {
  deriveCredential,
  generateEd25519KeyPair,
  signPresentation,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import { VGW_CONTEXT_URL } from "@vgw/vc-kit/contexts";
import { ageCutoffDays, proveAgePredicate, verifyAgeProof } from "@vgw/zk";
import type { VerificationSessionBody } from "./index.js";
import type { SessionOutcome, SessionStatus } from "./sessions.js";

const DMV = process.env.VGW_E2E_DMV ?? "http://localhost:5174";
const SHOP = process.env.VGW_E2E_SHOP ?? "http://localhost:5175";
const RENTALS = process.env.VGW_E2E_RENTALS ?? "http://localhost:5176";

const MASTER_SECRET = new Uint8Array(32).fill(42);

const LICENSE = "/credentialSubject/driversLicense";
const IDENTITY_POINTERS = [
  `${LICENSE}/given_name`,
  `${LICENSE}/family_name`,
  `${LICENSE}/document_number`,
];

async function json<T>(response: Response): Promise<T> {
  expect(response.ok, `${response.url} -> HTTP ${response.status}`).toBe(true);
  return (await response.json()) as T;
}

interface IssuedCredential {
  vc: VerifiableCredential;
  opening: { value: number; blinding: string; commitment: string };
}

/** The wallet's issuance flow, spoken over real HTTP against the dev DMV. */
async function issueCredential(persona: {
  givenName: string;
  familyName: string;
  birthDate: string;
}): Promise<IssuedCredential> {
  const offerBody = await json<{ credential_offer_uri: string }>(
    await fetch(`${DMV}/api/offers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...persona, documentNumber: "UDL-E2EB-RENT" }),
    }),
  );
  const offer = await json<CredentialOffer>(await fetch(offerBody.credential_offer_uri));
  const metadata = await json<IssuerMetadata>(
    await fetch(`${offer.credential_issuer}/.well-known/openid-credential-issuer`),
  );

  const token = await json<TokenResponse>(
    await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: PRE_AUTHORIZED_CODE_GRANT_TYPE,
        "pre-authorized_code":
          offer.grants[PRE_AUTHORIZED_CODE_GRANT_TYPE]["pre-authorized_code"],
      }).toString(),
    }),
  );

  const holderSeed = await deriveHolderSeed(MASTER_SECRET, new URL(DMV).origin);
  const jwt = createProofJwt({
    seed: holderSeed,
    audience: offer.credential_issuer,
    nonce: token.c_nonce,
  });
  const credentialResponse = await json<CredentialResponse>(
    await fetch(metadata.credential_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token.access_token}`,
      },
      body: JSON.stringify({
        credential_configuration_id: offer.credential_configuration_ids[0],
        proof: { proof_type: "jwt", jwt },
      }),
    }),
  );

  const opening = credentialResponse.vgw_commitment_opening;
  expect(opening).toBeDefined();
  expect(opening!.value).toBe(daysSinceEpoch(persona.birthDate));
  expect(verifyCommitment(opening!.value, opening!.blinding, opening!.commitment)).toBe(true);

  return {
    vc: credentialResponse.credentials[0]!.credential as unknown as VerifiableCredential,
    opening: opening!,
  };
}

/**
 * The wallet's presentation flow against a live verifier: pairwise presenter
 * key for THAT verifier's origin, multi-pointer BBS derivation, signed VP,
 * direct_post. Returns the response and the presenter DID used.
 */
async function present(options: {
  vc: VerifiableCredential;
  session: VerificationSessionBody;
  verifierOrigin: string;
  pointers: string[];
  zkAgeProof?: unknown;
}): Promise<{ response: Response; presenterDid: string }> {
  const derived = await deriveCredential({
    verifiableCredential: options.vc,
    selectivePointers: options.pointers,
  });
  const presenterSeed = await derivePresenterSeed(MASTER_SECRET, options.verifierOrigin);
  const presenter = await generateEd25519KeyPair(presenterSeed);
  const vp = await signPresentation({
    credentials: [derived],
    keyPair: presenter,
    challenge: options.session.request.nonce,
    domain: options.session.request.client_id,
    ...(options.zkAgeProof !== undefined
      ? { contexts: [VGW_CONTEXT_URL], properties: { zkAgeProof: options.zkAgeProof } }
      : {}),
  });
  const response = await fetch(options.session.request.response_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      vp_token: JSON.stringify({
        [options.session.request.dcql_query.credentials[0]!.id]: [vp],
      }),
      state: options.session.request.state,
    }).toString(),
  });
  return { response, presenterDid: presenter.controller };
}

async function createSession(verifier: string): Promise<VerificationSessionBody> {
  return json<VerificationSessionBody>(
    await fetch(`${verifier}/api/verification`, { method: "POST" }),
  );
}

describe.skipIf(process.env.VGW_E2E !== "1")("live end-to-end (DMV + rentals dev servers)", () => {
  it("issues at the DMV and clears an over-25 driver at the counter, identity disclosed", async () => {
    const { vc } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });

    const session = await createSession(RENTALS);
    const { response } = await present({
      vc,
      session,
      verifierOrigin: new URL(RENTALS).origin,
      pointers: [...IDENTITY_POINTERS, `${LICENSE}/age_over_25`],
    });
    const ack = await json<{ redirect_uri?: string }>(response);
    expect(ack.redirect_uri).toContain(`session=${session.session_id}`);

    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({
      status: "verified",
      verdict: "allowed",
      disclosed: {
        given_name: "Jamie",
        family_name: "Voss",
        document_number: "UDL-E2EB-RENT",
        age_over_25: true,
      },
    });
    // The counter needs identity, but the birthdate stays undisclosed.
    const disclosed = (status as { disclosed: Record<string, unknown> }).disclosed;
    expect(disclosed["birth_date"]).toBeUndefined();
    expect(disclosed["subject_id"]).toBeUndefined();
  }, 120_000);

  it("denies a 22-year-old — over 18 is not over 25", async () => {
    const { vc } = await issueCredential({
      givenName: "Riley",
      familyName: "Mercer",
      birthDate: "2004-05-01",
    });
    const session = await createSession(RENTALS);
    const { response } = await present({
      vc,
      session,
      verifierOrigin: new URL(RENTALS).origin,
      pointers: [...IDENTITY_POINTERS, `${LICENSE}/age_over_25`],
    });
    expect(response.status).toBe(200);
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({ status: "verified", verdict: "denied" });
    expect((status as SessionOutcome).disclosed["age_over_25"]).toBe(false);
  }, 120_000);

  it("rejects a replayed direct_post against the live Durable Object", async () => {
    const { vc } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });
    const session = await createSession(RENTALS);
    const pointers = [...IDENTITY_POINTERS, `${LICENSE}/age_over_25`];
    const origin = new URL(RENTALS).origin;
    const first = await present({ vc, session, verifierOrigin: origin, pointers });
    expect(first.response.status).toBe(200);
    const replay = await present({ vc, session, verifierOrigin: origin, pointers });
    expect(replay.response.status).toBe(400);
  }, 120_000);

  it("tier 2: a real over-25 UltraHonk proof round-trips — same commitment as the shop's 18+ tier", async () => {
    const { vc, opening } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });

    const session = await createSession(RENTALS);
    const query = session.request.dcql_query.credentials[0]!;
    expect(query.vgw_zk).toMatchObject({ predicate: "age_over", years: 25 });

    const { bundle } = await proveAgePredicate({
      dobDays: opening.value,
      blinding: opening.blinding,
      commitment: opening.commitment,
      cutoffDays: ageCutoffDays(query.vgw_zk!.years),
      years: query.vgw_zk!.years,
    });

    const { response } = await present({
      vc,
      session,
      verifierOrigin: new URL(RENTALS).origin,
      pointers: [...IDENTITY_POINTERS, `${LICENSE}/birthDateCommitment`],
      zkAgeProof: bundle,
    });
    const ack = await json<{ redirect_uri?: string }>(response);
    expect(ack.redirect_uri).toContain(`session=${session.session_id}`);

    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({ status: "verified", verdict: "zk_pending" });
    const outcome = status as SessionOutcome;
    // The live counter learned identity + the opaque commitment — no age data.
    expect(outcome.disclosed["given_name"]).toBe("Jamie");
    expect(outcome.disclosed["birthDateCommitment"]).toBe(opening.commitment);
    expect(outcome.disclosed["age_over_25"]).toBeUndefined();
    expect(outcome.disclosed["birth_date"]).toBeUndefined();

    // The rentals client's final check, byte-for-byte (Node runs the same code).
    expect(outcome.zk).toBeDefined();
    const zkResult = await verifyAgeProof({
      proof: outcome.zk!.proof,
      commitment: outcome.zk!.commitment,
      cutoffDays: outcome.zk!.cutoffDays,
    });
    expect(zkResult.verified).toBe(true);
  }, 120_000);

  it("tier 2: the live Worker rejects a cutoff later than today's over-25 policy", async () => {
    const { vc, opening } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });
    const session = await createSession(RENTALS);
    // A cutoff 30 days in the future is a strictly weaker statement
    // (would admit 24.9-year-olds). Proving succeeds; policy must not.
    const { bundle } = await proveAgePredicate({
      dobDays: opening.value,
      blinding: opening.blinding,
      commitment: opening.commitment,
      cutoffDays: ageCutoffDays(25) + 30,
      years: 25,
    });
    const { response } = await present({
      vc,
      session,
      verifierOrigin: new URL(RENTALS).origin,
      pointers: [...IDENTITY_POINTERS, `${LICENSE}/birthDateCommitment`],
      zkAgeProof: bundle,
    });
    expect(response.status).toBe(400);
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status.status).toBe("failed");
    expect((status as SessionOutcome).reason).toMatch(/cutoff/);
  }, 120_000);

  it("unlinkability: one credential, two live verifiers, nothing to join — except the seal when both take the ZK tier (needs the shop dev server too)", async () => {
    const { vc, opening } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });

    // Same wallet, same credential — the shop's 18+ gate and the rentals
    // counter, each with its own pairwise presenter key.
    const shopSession = await createSession(SHOP);
    const rentalsSession = await createSession(RENTALS);

    const shop = await present({
      vc,
      session: shopSession,
      verifierOrigin: new URL(SHOP).origin,
      pointers: [`${LICENSE}/age_over_18`],
    });
    const rentals = await present({
      vc,
      session: rentalsSession,
      verifierOrigin: new URL(RENTALS).origin,
      pointers: [...IDENTITY_POINTERS, `${LICENSE}/age_over_25`],
    });
    expect(shop.response.status).toBe(200);
    expect(rentals.response.status).toBe(200);

    const shopOutcome = (await json<SessionStatus>(
      await fetch(shopSession.status_url),
    )) as SessionOutcome;
    const rentalsOutcome = (await json<SessionStatus>(
      await fetch(rentalsSession.status_url),
    )) as SessionOutcome;
    expect(shopOutcome.verdict).toBe("allowed");
    expect(rentalsOutcome.verdict).toBe("allowed");

    // 1. Each verifier RECORDED a different presenter DID (from its own
    // vpToken) — the pairwise keys, as seen from the relying parties' side.
    const recordedHolder = (outcome: SessionOutcome): string => {
      const vpToken = outcome.vpToken as Record<string, VerifiablePresentation[]>;
      const vp = Object.values(vpToken)[0]![0]!;
      return String(vp.holder);
    };
    const shopHolder = recordedHolder(shopOutcome);
    const rentalsHolder = recordedHolder(rentalsOutcome);
    expect(shopHolder).toMatch(/^did:key:z6Mk/);
    expect(rentalsHolder).toMatch(/^did:key:z6Mk/);
    expect(shopHolder).not.toBe(rentalsHolder);
    expect(shopHolder).toBe(shop.presenterDid);
    expect(rentalsHolder).toBe(rentals.presenterDid);

    // 2. The disclosures are disjoint: the counter knows who Jamie is; the
    // shop knows only "someone over 18". No identifying claim/value pair
    // appears in both records (bare booleans are one bit shared with half
    // the population — not a correlation handle).
    expect(rentalsOutcome.disclosed["given_name"]).toBe("Jamie");
    expect(shopOutcome.disclosed["given_name"]).toBeUndefined();
    expect(shopOutcome.disclosed["document_number"]).toBeUndefined();
    const sharedPairs = Object.entries(shopOutcome.disclosed).filter(
      ([claim, value]) =>
        typeof value !== "boolean" &&
        claim in rentalsOutcome.disclosed &&
        JSON.stringify(rentalsOutcome.disclosed[claim]) === JSON.stringify(value),
    );
    expect(sharedPairs).toEqual([]);

    // 3. The honest exception (the guided tour's own path): the ZK tier at
    // BOTH counters. Each proof binds to the same issuer-signed commitment
    // and both verifiers must see it — the seal never opens, but the seal
    // itself is the one stable value colluding verifiers could match. Pin
    // it so the exhibit's claim stays true in both directions.
    const zkShopSession = await createSession(SHOP);
    const zkRentalsSession = await createSession(RENTALS);
    const zkShop = await present({
      vc,
      session: zkShopSession,
      verifierOrigin: new URL(SHOP).origin,
      pointers: [`${LICENSE}/birthDateCommitment`],
      zkAgeProof: (
        await proveAgePredicate({
          dobDays: opening.value,
          blinding: opening.blinding,
          commitment: opening.commitment,
          cutoffDays: ageCutoffDays(18),
          years: 18,
          threads: 1,
        })
      ).bundle,
    });
    const zkRentals = await present({
      vc,
      session: zkRentalsSession,
      verifierOrigin: new URL(RENTALS).origin,
      pointers: [...IDENTITY_POINTERS, `${LICENSE}/birthDateCommitment`],
      zkAgeProof: (
        await proveAgePredicate({
          dobDays: opening.value,
          blinding: opening.blinding,
          commitment: opening.commitment,
          cutoffDays: ageCutoffDays(25),
          years: 25,
          threads: 1,
        })
      ).bundle,
    });
    expect(zkShop.response.status).toBe(200);
    expect(zkRentals.response.status).toBe(200);
    const zkShopOutcome = (await json<SessionStatus>(
      await fetch(zkShopSession.status_url),
    )) as SessionOutcome;
    const zkRentalsOutcome = (await json<SessionStatus>(
      await fetch(zkRentalsSession.status_url),
    )) as SessionOutcome;
    expect(zkShopOutcome.verdict).toBe("zk_pending");
    expect(zkRentalsOutcome.verdict).toBe("zk_pending");
    const zkSharedPairs = Object.entries(zkShopOutcome.disclosed).filter(
      ([claim, value]) =>
        typeof value !== "boolean" &&
        claim in zkRentalsOutcome.disclosed &&
        JSON.stringify(zkRentalsOutcome.disclosed[claim]) === JSON.stringify(value),
    );
    expect(zkSharedPairs.map(([claim]) => claim)).toEqual(["birthDateCommitment"]);
  }, 180_000);
});
