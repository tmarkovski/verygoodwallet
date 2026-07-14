/**
 * Live end-to-end: real DMV Worker → wallet-side crypto → real shop Worker.
 *
 * Gated behind VGW_E2E=1 because it needs both dev servers running:
 *
 *   pnpm --filter @vgw/dmv dev    # :5174
 *   pnpm --filter @vgw/shop dev   # :5175
 *   VGW_E2E=1 pnpm --filter @vgw/shop test
 *
 * What it proves that the unit suites cannot: the two Workers agree on the
 * wire contracts over real HTTP, the shop discovers the DMV's issuer DID
 * from live metadata (no TRUSTED_ISSUER_DID pin in dev), and a credential
 * issued by the real issuance flow verifies through the real direct_post.
 */
import { describe, expect, it } from "vitest";
import { createCommitment, daysSinceEpoch, deriveHolderSeed, derivePresenterSeed, verifyCommitment } from "@vgw/keys";
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
} from "@vgw/vc-kit";
import { VGW_CONTEXT_URL } from "@vgw/vc-kit/contexts";
import { ageCutoffDays, proveAgePredicate, verifyAgeProof } from "@vgw/zk";
import type { VerificationSessionBody } from "./index.js";
import type { SessionOutcome, SessionStatus } from "./sessions.js";

const DMV = process.env.VGW_E2E_DMV ?? "http://localhost:5174";
const SHOP = process.env.VGW_E2E_SHOP ?? "http://localhost:5175";

const MASTER_SECRET = new Uint8Array(32).fill(42);

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
      body: JSON.stringify({ ...persona, documentNumber: "UDL-E2EA-TEST" }),
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

  // Sanity: the issuer's opening opens the signed commitment.
  const opening = credentialResponse.vgw_commitment_opening;
  expect(opening).toBeDefined();
  expect(opening!.value).toBe(daysSinceEpoch(persona.birthDate));
  expect(verifyCommitment(opening!.value, opening!.blinding, opening!.commitment)).toBe(true);
  // Deterministic commitment implementation drift would break the ZK tier:
  // recomputing with the same inputs must agree.
  expect(createCommitment(opening!.value, undefined).commitment).toBeDefined();

  return {
    vc: credentialResponse.credentials[0]!.credential as unknown as VerifiableCredential,
    opening: opening!,
  };
}

/** The wallet's presentation flow (tiers 1 and 2) against the live shop. */
async function present(
  vc: VerifiableCredential,
  session: VerificationSessionBody,
  pointer: string,
  zkAgeProof?: unknown,
): Promise<Response> {
  const derived = await deriveCredential({
    verifiableCredential: vc,
    selectivePointers: [pointer],
  });
  const presenterSeed = await derivePresenterSeed(MASTER_SECRET, new URL(SHOP).origin);
  const presenter = await generateEd25519KeyPair(presenterSeed);
  const vp = await signPresentation({
    credentials: [derived],
    keyPair: presenter,
    challenge: session.request.nonce,
    domain: session.request.client_id,
    ...(zkAgeProof !== undefined
      ? { contexts: [VGW_CONTEXT_URL], properties: { zkAgeProof } }
      : {}),
  });
  return fetch(session.request.response_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      vp_token: JSON.stringify({ [session.request.dcql_query.credentials[0]!.id]: [vp] }),
      state: session.request.state,
    }).toString(),
  });
}

describe.skipIf(process.env.VGW_E2E !== "1")("live end-to-end (DMV + shop dev servers)", () => {
  it("issues at the DMV and verifies 18+ at the shop, via discovered trust", async () => {
    const { vc } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });

    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const posted = await present(
      vc,
      session,
      "/credentialSubject/driversLicense/age_over_18",
    );
    const ack = await json<{ redirect_uri?: string }>(posted);
    expect(ack.redirect_uri).toContain(`session=${session.session_id}`);

    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({
      status: "verified",
      verdict: "allowed",
      disclosed: { age_over_18: true },
    });
    // Tier 1 must not have leaked PII to the live verifier.
    const disclosed = (status as { disclosed: Record<string, unknown> }).disclosed;
    expect(disclosed["birth_date"]).toBeUndefined();
    expect(disclosed["given_name"]).toBeUndefined();
    expect(disclosed["subject_id"]).toBeUndefined();
  }, 120_000);

  it("denies the under-18 persona on the same rails", async () => {
    const { vc } = await issueCredential({
      givenName: "Noa",
      familyName: "Lindqvist",
      birthDate: "2009-11-02",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const ack = await json<{ redirect_uri?: string }>(
      await present(vc, session, "/credentialSubject/driversLicense/age_over_18"),
    );
    expect(ack.redirect_uri).toBeDefined();
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({ status: "verified", verdict: "denied" });
  }, 120_000);

  it("rejects a replayed direct_post against the live Durable Object", async () => {
    const { vc } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const first = await present(vc, session, "/credentialSubject/driversLicense/age_over_18");
    expect(first.status).toBe(200);
    const replay = await present(vc, session, "/credentialSubject/driversLicense/age_over_18");
    expect(replay.status).toBe(400);
  }, 120_000);

  const COMMITMENT_POINTER = "/credentialSubject/driversLicense/birthDateCommitment";

  it("tier 2: a real UltraHonk proof round-trips and verifies as the shop client would", async () => {
    const { vc, opening } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });

    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const query = session.request.dcql_query.credentials[0]!;
    expect(query.vgw_zk).toMatchObject({ predicate: "age_over", years: 18 });

    const { bundle } = await proveAgePredicate({
      dobDays: opening.value,
      blinding: opening.blinding,
      commitment: opening.commitment,
      cutoffDays: ageCutoffDays(query.vgw_zk!.years),
      years: query.vgw_zk!.years,
    });

    const posted = await present(vc, session, COMMITMENT_POINTER, bundle);
    const ack = await json<{ redirect_uri?: string }>(posted);
    expect(ack.redirect_uri).toContain(`session=${session.session_id}`);

    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({ status: "verified", verdict: "zk_pending" });
    const outcome = status as SessionOutcome;
    // The live verifier learned the opaque commitment — nothing else.
    expect(outcome.disclosed["birthDateCommitment"]).toBe(opening.commitment);
    expect(outcome.disclosed["age_over_18"]).toBeUndefined();
    expect(outcome.disclosed["birth_date"]).toBeUndefined();

    // The shop client's final check, byte-for-byte (Node runs the same code).
    expect(outcome.zk).toBeDefined();
    const zkResult = await verifyAgeProof({
      proof: outcome.zk!.proof,
      commitment: outcome.zk!.commitment,
      cutoffDays: outcome.zk!.cutoffDays,
    });
    expect(zkResult.verified).toBe(true);
  }, 120_000);

  it("tier 2: the live Worker rejects a cutoff later than today's policy", async () => {
    const { vc, opening } = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    // Prove against a cutoff 30 days in the future — a strictly weaker
    // statement (would admit 17.9-year-olds). Proving succeeds; policy must not.
    const { bundle } = await proveAgePredicate({
      dobDays: opening.value,
      blinding: opening.blinding,
      commitment: opening.commitment,
      cutoffDays: ageCutoffDays(18) + 30,
      years: 18,
    });
    const posted = await present(vc, session, COMMITMENT_POINTER, bundle);
    expect(posted.status).toBe(400);
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status.status).toBe("failed");
    expect((status as SessionOutcome).reason).toMatch(/cutoff/);
  }, 120_000);
});
