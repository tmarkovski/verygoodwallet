/**
 * Wallet presentation flow tests — the crypto is real (BBS derive, Ed25519
 * presentation signature); only fetch and the credential store are stubbed.
 * The final assertion closes the loop: what `presentCredential` POSTs must
 * verify under the SAME checks the shop Worker runs (`verifyPresentation`
 * with the session's challenge/domain and a pinned issuer).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildUtopiaDriversLicense,
  generateBbsKeyPair,
  signCredential,
  verifyPresentation,
  type BbsKeyPair,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import {
  presentationRequestToParams,
  type DcqlQuery,
  type PresentationRequest,
} from "@vgw/protocols";
import {
  disclosurePreview,
  matchCredentials,
  parsePresentParams,
  presentCredential,
  previewPresentationRequest,
  tierPointers,
} from "./presentation";
import type { CredentialRecord } from "./db";

const ISSUER_SEED = new Uint8Array(32).fill(21);
const MASTER_SECRET = new Uint8Array(32).fill(22);

const RESPONSE_URI = "https://shop.example/oid4vp/response";
const CLIENT_ID = `redirect_uri:${RESPONSE_URI}`;

const DCQL: DcqlQuery = {
  credentials: [
    {
      id: "utopia_dl_age",
      format: "ldp_vc",
      meta: {
        type_values: [["VerifiableCredential", "Iso18013DriversLicenseCredential"]],
      },
      claims: [
        { id: "age_flag", path: ["credentialSubject", "driversLicense", "age_over_18"] },
        { id: "dob", path: ["credentialSubject", "driversLicense", "birth_date"] },
      ],
      claim_sets: [["age_flag"], ["dob"]],
    },
  ],
};

function request(overrides?: Partial<PresentationRequest>): PresentationRequest {
  return {
    response_type: "vp_token",
    response_mode: "direct_post",
    client_id: CLIENT_ID,
    response_uri: RESPONSE_URI,
    nonce: "test-nonce-1",
    state: "opaque-state-token",
    dcql_query: DCQL,
    client_metadata: { client_name: "The Nightcap" },
    ...overrides,
  };
}

function record(id: number): CredentialRecord {
  return {
    id,
    accountId: 1,
    meta: { name: "Utopia Driver's License", issuerName: "Utopia DMV", kind: "x", colorSeed: "x" },
    payload: "unused-in-these-tests",
  };
}

let issuer: BbsKeyPair;
/** The current DMV shape: no subject id (unlinkable by default). */
let signedVc: VerifiableCredential;
/** The pre-M3 shape: subject id embedded — kept to pin its consequences. */
let legacyVc: VerifiableCredential;

beforeAll(async () => {
  issuer = await generateBbsKeyPair(ISSUER_SEED);
  const input = {
    givenName: "JAMIE",
    familyName: "VOSS",
    birthDate: "1988-04-19",
    documentNumber: "F111222333",
    issuer: { id: issuer.controller, name: "Utopia DMV" },
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2032-01-01T00:00:00Z",
  } as const;
  [signedVc, legacyVc] = await Promise.all([
    signCredential({ credential: buildUtopiaDriversLicense(input), keyPair: issuer }),
    signCredential({
      credential: buildUtopiaDriversLicense({
        ...input,
        subjectId: "did:key:z6MkHolderExample",
      }),
      keyPair: issuer,
    }),
  ]);
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parsePresentParams", () => {
  it("returns missing for an empty query string", () => {
    expect(parsePresentParams(new URLSearchParams())).toEqual({ kind: "missing" });
  });

  it("parses a valid request round-tripped through params", () => {
    const params = presentationRequestToParams(request());
    const parsed = parsePresentParams(params);
    expect(parsed.kind).toBe("request");
    if (parsed.kind !== "request") return;
    expect(parsed.request.nonce).toBe("test-nonce-1");
  });

  it("reports why a malformed request is invalid", () => {
    const params = presentationRequestToParams(request());
    params.delete("nonce");
    const parsed = parsePresentParams(params);
    expect(parsed.kind).toBe("invalid");
    if (parsed.kind !== "invalid") return;
    expect(parsed.reason).toMatch(/nonce/);
  });
});

describe("previewPresentationRequest", () => {
  it("uses the client_name and derives the verifier origin", () => {
    const preview = previewPresentationRequest(request());
    expect(preview.verifierName).toBe("The Nightcap");
    expect(preview.verifierOrigin).toBe("https://shop.example");
  });

  it("falls back to the host when client_name is absent", () => {
    const preview = previewPresentationRequest(request({ client_metadata: {} }));
    expect(preview.verifierName).toBe("shop.example");
  });
});

describe("matchCredentials", () => {
  it("finds the stored license as a candidate via the age flag", () => {
    const result = matchCredentials([{ record: record(1), vc: signedVc }], request());
    expect(result.queryId).toBe("utopia_dl_age");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.match.claims[0]?.pointer).toBe(
      "/credentialSubject/driversLicense/age_over_18",
    );
  });

  it("rejects multi-credential queries loudly", () => {
    const twoQueries: DcqlQuery = {
      credentials: [DCQL.credentials[0]!, { ...DCQL.credentials[0]!, id: "second" }],
    };
    expect(() =>
      matchCredentials([{ record: record(1), vc: signedVc }], request({ dcql_query: twoQueries })),
    ).toThrow(/exactly one credential query/);
  });
});

describe("tiers", () => {
  it("tier 1 discloses only the matched claim; tier 0 the whole subject", () => {
    const { candidates } = matchCredentials([{ record: record(1), vc: signedVc }], request());
    const match = candidates[0]!.match;
    expect(tierPointers(1, match)).toEqual([
      "/credentialSubject/driversLicense/age_over_18",
    ]);
    expect(tierPointers(0, match)).toEqual(["/credentialSubject"]);

    const tier1 = disclosurePreview(1, signedVc, match);
    expect(tier1).toEqual({ age_over_18: true });

    const tier0 = disclosurePreview(0, signedVc, match);
    expect(tier0["birth_date"]).toBe("1988-04-19");
    expect(tier0["given_name"]).toBe("JAMIE");
    expect(tier0["subject id"]).toBeUndefined();
  });

  it("previews the embedded subject id at EVERY tier for legacy credentials", () => {
    // bbs-2023 reveals node ids structurally: selecting any subject claim
    // drags credentialSubject.id along. The consent screen must say so.
    const { candidates } = matchCredentials([{ record: record(1), vc: legacyVc }], request());
    const match = candidates[0]!.match;
    expect(disclosurePreview(1, legacyVc, match)["subject id"]).toBe(
      "did:key:z6MkHolderExample",
    );
    expect(disclosurePreview(0, legacyVc, match)["subject id"]).toBe(
      "did:key:z6MkHolderExample",
    );
  });
});

describe("presentCredential", () => {
  function capturePost() {
    const calls: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: new URLSearchParams(String(init?.body ?? "")),
        });
        return Response.json({ redirect_uri: "https://shop.example/?session=abc" });
      }),
    );
    return calls;
  }

  async function run(tier: 0 | 1) {
    const req = request();
    const { queryId, candidates } = matchCredentials(
      [{ record: record(1), vc: signedVc }],
      req,
    );
    const calls = capturePost();
    const steps: string[] = [];
    const result = await presentCredential({
      request: req,
      queryId,
      candidate: candidates[0]!,
      tier,
      masterSecret: MASTER_SECRET.slice(),
      onStep: (step) => steps.push(step),
    });
    return { req, calls, steps, result };
  }

  it(
    "produces a direct_post the verifier's own checks accept (tier 1)",
    async () => {
      const { req, calls, steps, result } = await run(1);

      expect(steps).toEqual([
        "deriving-presenter",
        "deriving-disclosure",
        "signing-presentation",
        "posting",
      ]);
      expect(result.redirectUri).toBe("https://shop.example/?session=abc");

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(RESPONSE_URI);
      expect(calls[0]?.body.get("state")).toBe(req.state);

      const vpToken = JSON.parse(calls[0]!.body.get("vp_token")!) as Record<
        string,
        VerifiablePresentation[]
      >;
      const vp = vpToken["utopia_dl_age"]?.[0];
      expect(vp).toBeDefined();

      // The verifier-side checks, exactly as the shop Worker runs them.
      const verification = await verifyPresentation({
        presentation: vp!,
        challenge: req.nonce,
        domain: req.client_id,
        expectedIssuer: issuer.controller,
      });
      expect(verification.error).toBeUndefined();
      expect(verification.verified).toBe(true);

      // Tier 1 must not have leaked anything beyond the flag + mandatories.
      const disclosed = verification.credentials[0]?.credential
        .credentialSubject as Record<string, unknown>;
      const license = disclosed["driversLicense"] as Record<string, unknown>;
      expect(license["age_over_18"]).toBe(true);
      expect(license["birth_date"]).toBeUndefined();
      expect(license["given_name"]).toBeUndefined();
      expect(disclosed["id"]).toBeUndefined();
    },
    60_000,
  );

  it(
    "tier 0 really is full disclosure of the subject",
    async () => {
      const { req, calls } = await run(0);
      const vpToken = JSON.parse(calls[0]!.body.get("vp_token")!) as Record<
        string,
        VerifiablePresentation[]
      >;
      const vp = vpToken["utopia_dl_age"]![0]!;
      const verification = await verifyPresentation({
        presentation: vp,
        challenge: req.nonce,
        domain: req.client_id,
        expectedIssuer: issuer.controller,
      });
      expect(verification.verified).toBe(true);
      const disclosed = verification.credentials[0]?.credential
        .credentialSubject as Record<string, unknown>;
      const license = disclosed["driversLicense"] as Record<string, unknown>;
      expect(license["birth_date"]).toBe("1988-04-19");
      expect(license["given_name"]).toBe("JAMIE");
    },
    60_000,
  );

  it(
    "a legacy credential's embedded subject id leaks even at tier 1 — pinned",
    async () => {
      // This is WHY the DMV stopped embedding subject ids: selecting one
      // claim still reveals the node's id, a cross-verifier correlation
      // handle. Pinning the behavior keeps the consent-screen warning honest.
      const req = request();
      const { queryId, candidates } = matchCredentials(
        [{ record: record(1), vc: legacyVc }],
        req,
      );
      const calls = capturePost();
      await presentCredential({
        request: req,
        queryId,
        candidate: candidates[0]!,
        tier: 1,
        masterSecret: MASTER_SECRET.slice(),
      });
      const vpToken = JSON.parse(calls[0]!.body.get("vp_token")!) as Record<
        string,
        VerifiablePresentation[]
      >;
      const disclosed = vpToken["utopia_dl_age"]![0]!.verifiableCredential as
        VerifiableCredential[];
      const subject = disclosed[0]?.credentialSubject as Record<string, unknown>;
      expect(subject["id"]).toBe("did:key:z6MkHolderExample");
    },
    60_000,
  );

  it(
    "derives a different presenter DID per verifier origin (pairwise)",
    async () => {
      const holders: string[] = [];
      for (const origin of ["https://shop.example", "https://rentals.example"]) {
        const req = request({
          response_uri: `${origin}/oid4vp/response`,
          client_id: `redirect_uri:${origin}/oid4vp/response`,
        });
        const { queryId, candidates } = matchCredentials(
          [{ record: record(1), vc: signedVc }],
          req,
        );
        const calls = capturePost();
        await presentCredential({
          request: req,
          queryId,
          candidate: candidates[0]!,
          tier: 1,
          masterSecret: MASTER_SECRET.slice(),
        });
        const vpToken = JSON.parse(calls[0]!.body.get("vp_token")!) as Record<
          string,
          VerifiablePresentation[]
        >;
        holders.push(String(vpToken["utopia_dl_age"]![0]!.holder));
        vi.unstubAllGlobals();
      }
      expect(holders[0]).toMatch(/^did:key:z6Mk/);
      expect(holders[0]).not.toBe(holders[1]);
    },
    60_000,
  );

  it("aborts at a phase boundary when the session locks", async () => {
    const req = request();
    const { queryId, candidates } = matchCredentials(
      [{ record: record(1), vc: signedVc }],
      req,
    );
    capturePost();
    const controller = new AbortController();
    controller.abort();
    await expect(
      presentCredential({
        request: req,
        queryId,
        candidate: candidates[0]!,
        tier: 1,
        masterSecret: MASTER_SECRET.slice(),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("surfaces the verifier's OAuth error body on rejection", async () => {
    const req = request();
    const { queryId, candidates } = matchCredentials(
      [{ record: record(1), vc: signedVc }],
      req,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "invalid_request", error_description: "this session already received a response" },
          { status: 400 },
        ),
      ),
    );
    await expect(
      presentCredential({
        request: req,
        queryId,
        candidate: candidates[0]!,
        tier: 1,
        masterSecret: MASTER_SECRET.slice(),
      }),
    ).rejects.toThrow(/already received a response/);
  });
});
