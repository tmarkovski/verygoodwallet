/**
 * Live end-to-end under workerd: the BUILT DMV Worker blind-issues a credkit
 * DL, the wallet-side crypto (holder binding, receipt check, params pinning,
 * presentGraph) runs in this process, and the BUILT rentals Worker verifies
 * the WHOLE presentation server-side — all over real HTTP.
 *
 * Gated behind VGW_E2E=1 because it boots `wrangler dev` from the deploy
 * artifacts (the exact bundles `wrangler deploy` uploads):
 *
 *   pnpm --filter @vgw/dmv build && pnpm --filter @vgw/rentals build
 *   VGW_E2E=1 pnpm --filter @vgw/rentals test
 *
 * Point VGW_E2E_DMV / VGW_E2E_RENTALS at already-running servers to skip the
 * self-boot. Ports are distinct from the shop e2e's so the two suites can
 * run back to back.
 *
 * What it proves that the unit suite cannot: the Workers agree on the wire
 * contracts over real HTTP under the real Cloudflare runtime, the rentals
 * Worker discovers the DMV's issuer DID from live metadata, identity
 * enforcement holds on the predicate route, and the cross-verifier exhibit
 * FLIPS: the presentation carries no holder identifier at all — nothing for
 * two verifiers to compare notes on (the pre-credkit suite pinned the
 * commitment as a joinable value; that value no longer exists).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveIssuancePopSeed, deriveLinkSecret, scalarToBase64Url, scalarFromBase64Url, toBase64Url } from "@vgw/keys";
import {
  CREDKIT_PARAMS_PATH,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  assertCredkitParamsDocument,
  commitmentDigest,
  createProofJwt,
  type CredentialOffer,
  type CredentialResponse,
  type IssuerMetadata,
  type PresentationRequest,
  type TokenResponse,
} from "@vgw/protocols";
import {
  createCredkitPresentation,
  createHolderBinding,
  rangeParamsFromBase64Url,
  rangeParamsHashBase64Url,
  verifyIssuedCredkitCredential,
  type RangeClaimRequest,
  type RangeParams,
  type VerifiableCredential,
} from "@vgw/vc-kit";
import type { VerificationSessionBody } from "./index.js";
import type { SessionOutcome, SessionStatus } from "./sessions.js";

const E2E = process.env.VGW_E2E === "1";

const DMV_PORT = 8793;
const RENTALS_PORT = 8794;
const DMV = process.env.VGW_E2E_DMV ?? `http://127.0.0.1:${DMV_PORT}`;
const RENTALS = process.env.VGW_E2E_RENTALS ?? `http://127.0.0.1:${RENTALS_PORT}`;

const MASTER_SECRET = new Uint8Array(32).fill(43);

const LICENSE = "/credentialSubject/driversLicense";
const BIRTH_DATE_POINTER = `${LICENSE}/birth_date`;
const IDENTITY_POINTERS = [
  `${LICENSE}/given_name`,
  `${LICENSE}/family_name`,
  `${LICENSE}/document_number`,
];
const FLAG_POINTER = `${LICENSE}/age_over_25`;

// ---------------------------------------------------------------------------
// workerd harness: boot the BUILT Worker artifacts via `wrangler dev`
// ---------------------------------------------------------------------------

interface BootedWorker {
  child: ChildProcess;
  output: () => string;
}

function repoRelative(...segments: string[]): string {
  const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return path.join(appDir, "..", "..", ...segments);
}

/** Strip deploy routes so workerd serves localhost, not the prod hostname. */
function routelessConfig(appDir: string, distName: string): string {
  const deployConfig = path.join(appDir, `dist/${distName}/wrangler.json`);
  if (!existsSync(deployConfig)) {
    throw new Error(`${deployConfig} missing — run \`pnpm build\` for the app first`);
  }
  const { routes: _routes, ...config } = JSON.parse(readFileSync(deployConfig, "utf8")) as {
    routes?: unknown;
  };
  const e2eConfig = path.join(appDir, `dist/${distName}/wrangler.e2e.json`);
  writeFileSync(e2eConfig, JSON.stringify(config, null, 2));
  return e2eConfig;
}

function bootWorker(options: {
  appDir: string;
  distName: string;
  port: number;
  vars?: Record<string, string>;
}): BootedWorker {
  const config = routelessConfig(options.appDir, options.distName);
  const args = [
    "exec",
    "wrangler",
    "dev",
    "--config",
    config,
    "--port",
    String(options.port),
    "--inspector-port",
    "0",
  ];
  for (const [key, value] of Object.entries(options.vars ?? {})) {
    args.push("--var", `${key}:${value}`);
  }
  const child = spawn("pnpm", args, {
    cwd: options.appDir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output };
}

function killWorker(worker: BootedWorker | undefined): void {
  const pid = worker?.child.pid;
  if (pid !== undefined) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function waitForHttp(url: string, worker: BootedWorker | undefined): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (worker?.output().includes("The Workers runtime failed to start")) {
      throw new Error(`workerd rejected the built bundle:\n${worker.output()}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`no response from ${url} within 90s\n${worker?.output() ?? ""}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

let dmvWorker: BootedWorker | undefined;
let rentalsWorker: BootedWorker | undefined;

// ---------------------------------------------------------------------------
// The wallet side, spoken over real HTTP
// ---------------------------------------------------------------------------

async function json<T>(response: Response): Promise<T> {
  expect(response.ok, `${response.url} -> HTTP ${response.status}`).toBe(true);
  return (await response.json()) as T;
}

interface IssuedCredential {
  vc: VerifiableCredential;
  /** scalar-encoded blind, exactly as the vault stores it. */
  secretProverBlind: string;
}

/** The wallet's N2 issuance flow (binding + digest-PoP + receipt check). */
async function issueCredential(persona: {
  givenName: string;
  familyName: string;
  birthDate: string;
}): Promise<IssuedCredential> {
  const offerBody = await json<{ credential_offer_uri: string }>(
    await fetch(`${DMV}/api/offers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...persona, documentNumber: "UDL-E2EB-TEST" }),
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

  const linkSecret = await deriveLinkSecret(MASTER_SECRET);
  const binding = createHolderBinding({ linkSecret });
  const popSeed = await deriveIssuancePopSeed(MASTER_SECRET, new URL(DMV).origin);
  const jwt = createProofJwt({
    seed: popSeed,
    audience: offer.credential_issuer,
    nonce: token.c_nonce,
    commitmentDigest: await commitmentDigest(binding.commitmentWithProof),
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
        vgw_holder_commitment: toBase64Url(binding.commitmentWithProof),
      }),
    }),
  );

  const vc = credentialResponse.credentials[0]!.credential as unknown as VerifiableCredential;
  expect(
    await verifyIssuedCredkitCredential({
      verifiableCredential: vc,
      holderBinding: { linkSecret, secretProverBlind: binding.secretProverBlind },
    }),
  ).toBe(true);

  return { vc, secretProverBlind: scalarToBase64Url(binding.secretProverBlind) };
}

/** The wallet's params pinning: fetch, validate, hash-check, decode. */
async function fetchRentalsParams(
  request: PresentationRequest,
): Promise<{ params: RangeParams; hash: string }> {
  const predicates = request.dcql_query.credentials[0]?.vgw_predicates;
  expect(predicates).toBeDefined();
  const paramsUri = new URL(predicates!.params_uri);
  expect(paramsUri.origin).toBe(new URL(request.response_uri).origin);
  expect(paramsUri.pathname).toBe(CREDKIT_PARAMS_PATH);

  const document = assertCredkitParamsDocument(await json(await fetch(paramsUri)));
  const params = rangeParamsFromBase64Url(document.range!.params);
  const hash = await rangeParamsHashBase64Url(params);
  expect(hash).toBe(document.range!.hash);
  for (const claim of predicates!.range ?? []) {
    expect(claim.params_hash).toBe(hash);
  }
  return { params, hash };
}

/** Answer the query's range predicate with the published params. */
function rangeClaimsFor(
  request: PresentationRequest,
  params: RangeParams,
): RangeClaimRequest[] {
  const range = request.dcql_query.credentials[0]?.vgw_predicates?.range ?? [];
  return range.map((entry) => ({
    pointer: BIRTH_DATE_POINTER,
    kind: entry.kind,
    bound: BigInt(entry.bound),
    digits: entry.digits,
    params,
  }));
}

/** The wallet's presentation flow (disclosure or predicate route). */
async function present(
  issued: IssuedCredential,
  session: VerificationSessionBody,
  options: { pointers?: string[]; rangeClaims?: RangeClaimRequest[] },
): Promise<Response> {
  const vp = await createCredkitPresentation({
    credentials: [
      {
        verifiableCredential: issued.vc,
        selectivePointers: options.pointers ?? [],
        ...(options.rangeClaims !== undefined ? { rangeClaims: options.rangeClaims } : {}),
        holderBinding: {
          linkSecret: await deriveLinkSecret(MASTER_SECRET),
          secretProverBlind: scalarFromBase64Url(issued.secretProverBlind),
        },
      },
    ],
    challenge: session.request.nonce,
    domain: session.request.client_id,
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

describe.skipIf(!E2E)("live end-to-end (built DMV + rentals Workers under workerd)", () => {
  beforeAll(async () => {
    if (process.env.VGW_E2E_DMV === undefined) {
      dmvWorker = bootWorker({
        appDir: repoRelative("apps", "dmv"),
        distName: "vgw_dmv",
        port: DMV_PORT,
      });
    }
    if (process.env.VGW_E2E_RENTALS === undefined) {
      rentalsWorker = bootWorker({
        appDir: repoRelative("apps", "rentals"),
        distName: "vgw_rentals",
        port: RENTALS_PORT,
        // Discovery, not a pin: the counter must find the DMV's DID live.
        vars: { DMV_ORIGIN: DMV },
      });
    }
    await waitForHttp(`${DMV}/.well-known/openid-credential-issuer`, dmvWorker);
    await waitForHttp(`${RENTALS}${CREDKIT_PARAMS_PATH}`, rentalsWorker);
  }, 180_000);

  afterAll(() => {
    killWorker(rentalsWorker);
    killWorker(dmvWorker);
  });

  it("issues at the DMV and rents at 25+ via identity + flag, via discovered trust", async () => {
    const issued = await issueCredential({
      givenName: "Marisol",
      familyName: "Deng",
      birthDate: "1958-06-21",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${RENTALS}/api/verification`, { method: "POST" }),
    );
    const posted = await present(issued, session, {
      pointers: [...IDENTITY_POINTERS, FLAG_POINTER],
    });
    const ack = await json<{ redirect_uri?: string }>(posted);
    expect(ack.redirect_uri).toContain(`session=${session.session_id}`);

    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({
      status: "verified",
      verdict: "allowed",
      disclosed: { given_name: "Marisol", age_over_25: true },
    });
    expect((status as SessionOutcome).disclosed["birth_date"]).toBeUndefined();
  }, 120_000);

  it("denies an under-25 driver on the same rails", async () => {
    const issued = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "2003-05-05",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${RENTALS}/api/verification`, { method: "POST" }),
    );
    const ack = await json<{ redirect_uri?: string }>(
      await present(issued, session, { pointers: [...IDENTITY_POINTERS, FLAG_POINTER] }),
    );
    expect(ack.redirect_uri).toBeDefined();
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({ status: "verified", verdict: "denied" });
  }, 120_000);

  it("rejects a replayed direct_post against the live Durable Object", async () => {
    const issued = await issueCredential({
      givenName: "Marisol",
      familyName: "Deng",
      birthDate: "1958-06-21",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${RENTALS}/api/verification`, { method: "POST" }),
    );
    const first = await present(issued, session, {
      pointers: [...IDENTITY_POINTERS, FLAG_POINTER],
    });
    expect(first.status).toBe(200);
    const replay = await present(issued, session, {
      pointers: [...IDENTITY_POINTERS, FLAG_POINTER],
    });
    expect(replay.status).toBe(400);
  }, 120_000);

  it("predicate route: identity + the 25+ range proof verify ON the Worker, and the VP carries no holder", async () => {
    const issued = await issueCredential({
      givenName: "Marisol",
      familyName: "Deng",
      birthDate: "1958-06-21",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${RENTALS}/api/verification`, { method: "POST" }),
    );
    const { params } = await fetchRentalsParams(session.request);
    const posted = await present(issued, session, {
      pointers: IDENTITY_POINTERS,
      rangeClaims: rangeClaimsFor(session.request, params),
    });
    const ack = await json<{ redirect_uri?: string }>(posted);
    expect(ack.redirect_uri).toBeDefined();

    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({ status: "verified", verdict: "allowed" });
    const outcome = status as SessionOutcome;
    // Identity disclosed (the rental agreement needs it); the age question
    // cost one live bit — no birthdate, no flag.
    expect(outcome.disclosed["given_name"]).toBe("Marisol");
    expect(outcome.disclosed["birth_date"]).toBeUndefined();
    expect(outcome.disclosed["age_over_25"]).toBeUndefined();
    expect(outcome.predicate?.pointer).toBe(BIRTH_DATE_POINTER);

    // The flipped cross-verifier exhibit: the recorded presentation carries
    // NO holder identifier — nothing for this counter and the shop to join.
    const vpToken = outcome.vpToken as Record<string, unknown[]>;
    const vp = vpToken[session.request.dcql_query.credentials[0]!.id]?.[0] as Record<
      string,
      unknown
    >;
    expect(vp["holder"]).toBeUndefined();
  }, 120_000);

  it("predicate route: a range proof without the identity disclosures fails the policy", async () => {
    const issued = await issueCredential({
      givenName: "Marisol",
      familyName: "Deng",
      birthDate: "1958-06-21",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${RENTALS}/api/verification`, { method: "POST" }),
    );
    const { params } = await fetchRentalsParams(session.request);
    const posted = await present(issued, session, {
      rangeClaims: rangeClaimsFor(session.request, params),
    });
    expect(posted.status).toBe(400);
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status.status).toBe("failed");
    expect((status as SessionOutcome).reason).toMatch(/driver's identity/);
  }, 120_000);

  it("predicate route: the under-25 holder's prover THROWS — nothing is posted", async () => {
    const issued = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "2003-05-05",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${RENTALS}/api/verification`, { method: "POST" }),
    );
    const { params } = await fetchRentalsParams(session.request);
    await expect(
      present(issued, session, {
        pointers: IDENTITY_POINTERS,
        rangeClaims: rangeClaimsFor(session.request, params),
      }),
    ).rejects.toThrow(/does not fit/);
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status.status).toBe("pending");
  }, 120_000);
});
