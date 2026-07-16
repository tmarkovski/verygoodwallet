/**
 * Live end-to-end under workerd: the BUILT DMV Worker blind-issues a credkit
 * DL, the wallet-side crypto (holder binding, receipt check, params pinning,
 * presentGraph) runs in this process, and the BUILT shop Worker verifies the
 * WHOLE presentation server-side — all over real HTTP.
 *
 * Gated behind VGW_E2E=1 because it boots `wrangler dev` from the deploy
 * artifacts (the exact bundles `wrangler deploy` uploads):
 *
 *   pnpm --filter @vgw/dmv build && pnpm --filter @vgw/shop build
 *   VGW_E2E=1 pnpm --filter @vgw/shop test
 *
 * Point VGW_E2E_DMV / VGW_E2E_SHOP at already-running servers to skip the
 * self-boot (e.g. `vite dev` on :5174/:5175, or production origins).
 *
 * What it proves that the unit suite cannot: the two Workers agree on the
 * wire contracts over real HTTP under the real Cloudflare runtime, the shop
 * discovers the DMV's issuer DID from live metadata (no TRUSTED_ISSUER_DID
 * pin), and the credkit verify path — pairings and all — returns one verdict
 * inside workerd with no WASM and no client hand-off.
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

const DMV_PORT = 8791;
const SHOP_PORT = 8792;
const DMV = process.env.VGW_E2E_DMV ?? `http://127.0.0.1:${DMV_PORT}`;
const SHOP = process.env.VGW_E2E_SHOP ?? `http://127.0.0.1:${SHOP_PORT}`;

const MASTER_SECRET = new Uint8Array(32).fill(42);

const BIRTH_DATE_POINTER = "/credentialSubject/driversLicense/birth_date";

// ---------------------------------------------------------------------------
// workerd harness: boot the BUILT Worker artifacts via `wrangler dev`
// (the DMV pattern from N2, committed). Skipped for externally-provided
// origins.
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
  // detached: the child leads its own process group, so killing -pid takes
  // the workerd children wrangler spawns down with it.
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
let shopWorker: BootedWorker | undefined;

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

  // Binding: the ONE master-derived link secret, blind-committed. Freshness:
  // the pairwise PoP signing c_nonce + the commitment digest (option c).
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
  // The holder receipt check — nothing enters the "vault" without it.
  expect(
    await verifyIssuedCredkitCredential({
      verifiableCredential: vc,
      holderBinding: { linkSecret, secretProverBlind: binding.secretProverBlind },
    }),
  ).toBe(true);

  return { vc, secretProverBlind: scalarToBase64Url(binding.secretProverBlind) };
}

/** The wallet's params pinning: fetch, validate, hash-check, decode. */
async function fetchShopParams(
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
  boundShift = 0n,
): RangeClaimRequest[] {
  const range = request.dcql_query.credentials[0]?.vgw_predicates?.range ?? [];
  return range.map((entry) => ({
    pointer: BIRTH_DATE_POINTER,
    kind: entry.kind,
    bound: BigInt(entry.bound) + boundShift,
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

const FLAG_POINTER = "/credentialSubject/driversLicense/age_over_18";

describe.skipIf(!E2E)("live end-to-end (built DMV + shop Workers under workerd)", () => {
  beforeAll(async () => {
    if (process.env.VGW_E2E_DMV === undefined) {
      dmvWorker = bootWorker({
        appDir: repoRelative("apps", "dmv"),
        distName: "vgw_dmv",
        port: DMV_PORT,
      });
    }
    if (process.env.VGW_E2E_SHOP === undefined) {
      shopWorker = bootWorker({
        appDir: repoRelative("apps", "shop"),
        distName: "vgw_shop",
        port: SHOP_PORT,
        // Discovery, not a pin: the shop must find the DMV's DID live.
        vars: { DMV_ORIGIN: DMV },
      });
    }
    await waitForHttp(`${DMV}/.well-known/openid-credential-issuer`, dmvWorker);
    await waitForHttp(`${SHOP}${CREDKIT_PARAMS_PATH}`, shopWorker);
  }, 180_000);

  afterAll(() => {
    killWorker(shopWorker);
    killWorker(dmvWorker);
  });

  it("issues at the DMV and verifies 18+ at the shop, via discovered trust", async () => {
    const issued = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });

    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const posted = await present(issued, session, { pointers: [FLAG_POINTER] });
    const ack = await json<{ redirect_uri?: string }>(posted);
    expect(ack.redirect_uri).toContain(`session=${session.session_id}`);

    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({
      status: "verified",
      verdict: "allowed",
      disclosed: { age_over_18: true },
    });
    // The disclosure route must not have leaked PII to the live verifier.
    const disclosed = (status as { disclosed: Record<string, unknown> }).disclosed;
    expect(disclosed["birth_date"]).toBeUndefined();
    expect(disclosed["given_name"]).toBeUndefined();
    expect(disclosed["subject_id"]).toBeUndefined();
  }, 120_000);

  it("denies the under-18 persona on the same rails", async () => {
    const issued = await issueCredential({
      givenName: "Noa",
      familyName: "Lindqvist",
      birthDate: "2009-11-02",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const ack = await json<{ redirect_uri?: string }>(
      await present(issued, session, { pointers: [FLAG_POINTER] }),
    );
    expect(ack.redirect_uri).toBeDefined();
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status).toMatchObject({ status: "verified", verdict: "denied" });
  }, 120_000);

  it("rejects a replayed direct_post against the live Durable Object", async () => {
    const issued = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const first = await present(issued, session, { pointers: [FLAG_POINTER] });
    expect(first.status).toBe(200);
    const replay = await present(issued, session, { pointers: [FLAG_POINTER] });
    expect(replay.status).toBe(400);
  }, 120_000);

  it("predicate route: the range proof over the hidden birth_date verifies ON the Worker", async () => {
    const issued = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const { params } = await fetchShopParams(session.request);

    const posted = await present(issued, session, {
      rangeClaims: rangeClaimsFor(session.request, params),
    });
    const ack = await json<{ redirect_uri?: string }>(posted);
    expect(ack.redirect_uri).toContain(`session=${session.session_id}`);

    const status = await json<SessionStatus>(await fetch(session.status_url));
    // ONE verdict from the server — no zk_pending, no client hand-off.
    expect(status).toMatchObject({ status: "verified", verdict: "allowed" });
    const outcome = status as SessionOutcome;
    // The live verifier learned one proven bit — nothing else.
    expect(outcome.disclosed).toEqual({});
    expect(outcome.predicate).toMatchObject({
      pointer: BIRTH_DATE_POINTER,
      kind: "lessOrEqual",
    });
    expect(outcome.predicate?.cutoffIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 120_000);

  it("predicate route: the live Worker rejects a self-served weaker bound", async () => {
    const issued = await issueCredential({
      givenName: "Jamie",
      familyName: "Voss",
      birthDate: "1988-04-19",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const { params } = await fetchShopParams(session.request);
    // A bound 30 days later would admit 17.9-year-olds: provable, but not
    // the statement this session's signed token offered.
    const posted = await present(issued, session, {
      rangeClaims: rangeClaimsFor(session.request, params, 30n),
    });
    expect(posted.status).toBe(400);
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status.status).toBe("failed");
    expect((status as SessionOutcome).reason).toMatch(/expected predicate/);
  }, 120_000);

  it("predicate route: the underage holder's prover THROWS — nothing is posted", async () => {
    const issued = await issueCredential({
      givenName: "Noa",
      familyName: "Lindqvist",
      birthDate: "2009-11-02",
    });
    const session = await json<VerificationSessionBody>(
      await fetch(`${SHOP}/api/verification`, { method: "POST" }),
    );
    const { params } = await fetchShopParams(session.request);
    await expect(
      present(issued, session, { rangeClaims: rangeClaimsFor(session.request, params) }),
    ).rejects.toThrow(/does not fit/);
    // The session never saw a response.
    const status = await json<SessionStatus>(await fetch(session.status_url));
    expect(status.status).toBe("pending");
  }, 120_000);
});
