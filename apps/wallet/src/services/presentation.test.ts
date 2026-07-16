/**
 * Wallet presentation flow tests — the crypto is real (credkit blind-issued
 * credentials, `presentGraph` selective disclosure + range proofs, holder
 * binding to the master-derived link secret); only fetch is stubbed. The
 * final assertion closes the loop: what `presentCredential` POSTs must
 * verify under the SAME policy facade the shop/rentals Workers run
 * (`verifyCredkitPresentation` with the session's challenge/domain, the
 * pinned issuer, and the verifier-restated range claims).
 *
 * The predicate cutoffs are FROZEN (18+ / 25+ as of 2026-07-16): a range
 * proof depends only on the bound, never the wall clock, so Jamie
 * (1996-03-14) passes and Noa (2009-11-02) fails these bounds forever.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildUtopiaDriversLicense,
  createHolderBinding,
  generateCredkitBbsKeyPair,
  getEncoder,
  issueCredkitCredential,
  mintSeededRangeParams,
  rangeParamsHashBase64Url,
  rangeParamsToBase64Url,
  summarizeCredkitPresentation,
  verifyCredkitPresentation,
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  type CredkitBbsKeyPair,
  type HolderBinding,
  type RangeParams,
  type VerifiableCredential,
  type VerifiablePresentation,
} from "@vgw/vc-kit";
import {
  matchDcqlCredentialQuery,
  presentationRequestToParams,
  type CredkitParamsDocument,
  type DcqlQuery,
  type PresentationRequest,
} from "@vgw/protocols";
import { deriveLinkSecret, scalarToBase64Url } from "@vgw/keys";
import {
  disclosurePreview,
  hasEmbeddedSubjectId,
  matchCredentials,
  parsePresentParams,
  predicateOption,
  presentCredential,
  presentationSteps,
  previewPresentationRequest,
  tierPointers,
  type DisclosureTier,
} from "./presentation";
import type { CredentialPayload, CredentialRecord } from "./db";

const ISSUER_SEED = new Uint8Array(32).fill(21);
const MASTER_SECRET = new Uint8Array(32).fill(22);

const RESPONSE_URI = "https://shop.example/oid4vp/response";
const CLIENT_ID = `redirect_uri:${RESPONSE_URI}`;
const PARAMS_URI = "https://shop.example/.well-known/credkit-params";
const REDIRECT_BACK = "https://shop.example/?session=abc";

const LICENSE_PATH = ["credentialSubject", "driversLicense"] as const;
const DOB_POINTER = "/credentialSubject/driversLicense/birth_date";

/** Frozen cutoffs (see the module note): 18+ / 25+ as of 2026-07-16. */
const CUTOFF_18_ISO = "2008-07-16";
const CUTOFF_25_ISO = "2001-07-16";
const BOUND_18 = getEncoder("date1900").encode(CUTOFF_18_ISO).toString();
const BOUND_25 = getEncoder("date1900").encode(CUTOFF_25_ISO).toString();

interface IssuedFixture {
  vc: VerifiableCredential;
  binding: HolderBinding;
}

let issuer: CredkitBbsKeyPair;
/** The wallet's ONE link secret — re-derived by presentCredential from MASTER_SECRET. */
let linkSecret: Uint8Array;
/** Jamie (1996-03-14; passes 18+ and 25+), unlinkable shape (no subject id). */
let adult: IssuedFixture;
/** Noa (2009-11-02; fails 18+) — the fail-closed prover beat. */
let minor: IssuedFixture;
/** Jamie again, with an embedded subject id — kept to pin its consequences. */
let identified: IssuedFixture;
/** The verifier's published proof alphabet + its wire encodings. */
let params: RangeParams;
let paramsHash: string;
let paramsDocument: CredkitParamsDocument;

beforeAll(async () => {
  issuer = generateCredkitBbsKeyPair(ISSUER_SEED);
  linkSecret = await deriveLinkSecret(MASTER_SECRET);

  const issue = async (input?: {
    birthDate?: string;
    subjectId?: string;
  }): Promise<IssuedFixture> => {
    const binding = createHolderBinding({ linkSecret });
    const vc = await issueCredkitCredential({
      credential: buildUtopiaDriversLicense({
        givenName: "JAMIE",
        familyName: "VOSS",
        birthDate: input?.birthDate ?? "1996-03-14",
        documentNumber: "F111222333",
        issuer: { id: issuer.controller, name: "Utopia DMV" },
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2032-01-01T00:00:00Z",
        ...(input?.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
      }),
      keyPair: issuer,
      numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
      holderCommitment: binding.commitmentWithProof,
    });
    return { vc, binding };
  };

  [adult, minor, identified] = await Promise.all([
    issue(),
    issue({ birthDate: "2009-11-02" }),
    issue({ subjectId: "did:key:z6MkHolderExample" }),
  ]);

  params = mintSeededRangeParams({
    seed: "shop-params-seed",
    dst: "VGW-TEST-RANGE-PARAMS-V1",
    base: 16,
  });
  paramsHash = await rangeParamsHashBase64Url(params);
  paramsDocument = {
    version: 1,
    suite: "credkit-bbs-sha-2026",
    range: { base: 16, params: rangeParamsToBase64Url(params), hash: paramsHash },
  };
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The v3 vault envelope, encoded exactly as the issuance path persists it. */
function v3Payload(fixture: IssuedFixture): CredentialPayload {
  return {
    version: 3,
    vc: fixture.vc,
    secretProverBlind: scalarToBase64Url(fixture.binding.secretProverBlind),
  };
}

/** The pre-N2 envelope shape — no version, no blind (re-issuance is the only fix). */
function legacyPayload(vc: VerifiableCredential): CredentialPayload {
  return { vc } as unknown as CredentialPayload;
}

function record(id: number): CredentialRecord {
  return {
    id,
    accountId: 1,
    meta: { name: "Utopia Driver's License", issuerName: "Utopia DMV", kind: "x", colorSeed: "x" },
    payload: "unused-in-these-tests",
  };
}

/** The shop's N3 query: age alternatives + the range predicate, claim_set []. */
function shopDcql(overrides?: { paramsUri?: string; paramsHash?: string }): DcqlQuery {
  return {
    credentials: [
      {
        id: "utopia_dl_age",
        format: "ldp_vc",
        meta: {
          type_values: [["VerifiableCredential", "Iso18013DriversLicenseCredential"]],
        },
        claims: [
          { id: "age_flag", path: [...LICENSE_PATH, "age_over_18"] },
          { id: "dob", path: [...LICENSE_PATH, "birth_date"] },
        ],
        claim_sets: [["age_flag"], ["dob"]],
        vgw_predicates: {
          params_uri: overrides?.paramsUri ?? PARAMS_URI,
          range: [
            {
              path: [...LICENSE_PATH, "birth_date"],
              kind: "lessOrEqual",
              bound: BOUND_18,
              digits: 4,
              params_hash: overrides?.paramsHash ?? paramsHash,
            },
          ],
          // The shop needs one bit, not a name.
          claim_set: [],
        },
      },
    ],
  };
}

/**
 * The rentals N3 shape: identity claims required alongside every age route,
 * so the predicate claim_set carries name + license number WITH the proof.
 */
function rentalDcql(): DcqlQuery {
  return {
    credentials: [
      {
        id: "utopia_dl_rental",
        format: "ldp_vc",
        meta: {
          type_values: [["VerifiableCredential", "Iso18013DriversLicenseCredential"]],
        },
        claims: [
          { id: "given_name", path: [...LICENSE_PATH, "given_name"] },
          { id: "family_name", path: [...LICENSE_PATH, "family_name"] },
          { id: "document_number", path: [...LICENSE_PATH, "document_number"] },
          { id: "age_flag", path: [...LICENSE_PATH, "age_over_25"] },
          { id: "dob", path: [...LICENSE_PATH, "birth_date"] },
        ],
        claim_sets: [
          ["given_name", "family_name", "document_number", "age_flag"],
          ["given_name", "family_name", "document_number", "dob"],
        ],
        vgw_predicates: {
          params_uri: PARAMS_URI,
          range: [
            {
              path: [...LICENSE_PATH, "birth_date"],
              kind: "lessOrEqual",
              bound: BOUND_25,
              digits: 4,
              params_hash: paramsHash,
            },
          ],
          claim_set: ["given_name", "family_name", "document_number"],
        },
      },
    ],
  };
}

function request(overrides?: Partial<PresentationRequest>): PresentationRequest {
  return {
    response_type: "vp_token",
    response_mode: "direct_post",
    client_id: CLIENT_ID,
    response_uri: RESPONSE_URI,
    nonce: "test-nonce-1",
    state: "opaque-state-token",
    dcql_query: shopDcql(),
    client_metadata: { client_name: "The Nightcap" },
    ...overrides,
  };
}

interface FetchLog {
  /** GET requests (the params document fetches), by URL. */
  gets: string[];
  /** direct_post captures. */
  posts: { url: string; body: URLSearchParams }[];
}

/**
 * Stub fetch as the two endpoints this flow touches: GET params document,
 * POST direct_post. Overridable per test for the failure paths.
 */
function stubFetch(options?: {
  paramsResponse?: () => Response;
  postResponse?: () => Response;
}): FetchLog {
  const log: FetchLog = { gets: [], posts: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (method === "GET") {
        log.gets.push(url);
        return options?.paramsResponse?.() ?? Response.json(paramsDocument);
      }
      log.posts.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
      return options?.postResponse?.() ?? Response.json({ redirect_uri: REDIRECT_BACK });
    }),
  );
  return log;
}

/** Parse the posted vp_token and return the (single) presentation for a query. */
function postedPresentation(log: FetchLog, queryId: string): VerifiablePresentation {
  expect(log.posts).toHaveLength(1);
  const vpToken = JSON.parse(log.posts[0]!.body.get("vp_token")!) as Record<
    string,
    VerifiablePresentation[]
  >;
  const vp = vpToken[queryId]?.[0];
  expect(vp).toBeDefined();
  return vp!;
}

describe("parsePresentParams", () => {
  it("returns missing for an empty query string", () => {
    expect(parsePresentParams(new URLSearchParams())).toEqual({ kind: "missing" });
  });

  it("parses a valid request (with vgw_predicates) round-tripped through params", () => {
    const parsed = parsePresentParams(presentationRequestToParams(request()));
    expect(parsed.kind).toBe("request");
    if (parsed.kind !== "request") return;
    expect(parsed.request.nonce).toBe("test-nonce-1");
    const predicates = parsed.request.dcql_query.credentials[0]?.vgw_predicates;
    expect(predicates?.params_uri).toBe(PARAMS_URI);
    expect(predicates?.range?.[0]?.bound).toBe(BOUND_18);
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
  it("finds the stored v3 license as a candidate via the age flag", () => {
    const result = matchCredentials(
      [{ record: record(1), payload: v3Payload(adult) }],
      request(),
    );
    expect(result.queryId).toBe("utopia_dl_age");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.match.claims[0]?.pointer).toBe(
      "/credentialSubject/driversLicense/age_over_18",
    );
  });

  it("skips pre-credkit envelopes: no blind, not a candidate (re-issuance is the fix)", () => {
    const result = matchCredentials(
      [
        { record: record(1), payload: legacyPayload(adult.vc) },
        { record: record(2), payload: v3Payload(adult) },
      ],
      request(),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.record.id).toBe(2);
  });

  it("rejects multi-credential queries loudly", () => {
    const base = shopDcql();
    const twoQueries: DcqlQuery = {
      credentials: [base.credentials[0]!, { ...base.credentials[0]!, id: "second" }],
    };
    expect(() =>
      matchCredentials(
        [{ record: record(1), payload: v3Payload(adult) }],
        request({ dcql_query: twoQueries }),
      ),
    ).toThrow(/exactly one credential query/);
  });

  it("rejects requests demanding cross-credential equalities (reserved N5) loudly", () => {
    const withEqualities: DcqlQuery = {
      ...shopDcql(),
      vgw_equalities: [
        [
          { query: "utopia_dl_age", link_secret: true },
          { query: "utopia_dl_age", link_secret: true },
        ],
      ],
    };
    expect(() =>
      matchCredentials(
        [{ record: record(1), payload: v3Payload(adult) }],
        request({ dcql_query: withEqualities }),
      ),
    ).toThrow(/vgw_equalities/);
  });
});

describe("tiers", () => {
  it("tier 1 discloses only the matched claim; tier 0 the whole subject", () => {
    const { candidates } = matchCredentials(
      [{ record: record(1), payload: v3Payload(adult) }],
      request(),
    );
    const match = candidates[0]!.match;
    expect(tierPointers(1, match)).toEqual([
      "/credentialSubject/driversLicense/age_over_18",
    ]);
    expect(tierPointers(0, match)).toEqual(["/credentialSubject"]);

    const tier1 = disclosurePreview(1, adult.vc, match);
    expect(tier1).toEqual({ age_over_18: true });

    const tier0 = disclosurePreview(0, adult.vc, match);
    expect(tier0["birth_date"]).toBe("1996-03-14");
    expect(tier0["given_name"]).toBe("JAMIE");
    expect(tier0["subject id"]).toBeUndefined();
  });

  it("previews the embedded subject id at EVERY tier for identified credentials", () => {
    // Node ids are revealed structurally: selecting any subject claim drags
    // credentialSubject.id along. The consent screen must say so.
    const { candidates } = matchCredentials(
      [{ record: record(1), payload: v3Payload(identified) }],
      request(),
    );
    const match = candidates[0]!.match;
    expect(hasEmbeddedSubjectId(identified.vc)).toBe(true);
    expect(hasEmbeddedSubjectId(adult.vc)).toBe(false);
    expect(disclosurePreview(1, identified.vc, match)["subject id"]).toBe(
      "did:key:z6MkHolderExample",
    );
    expect(disclosurePreview(0, identified.vc, match)["subject id"]).toBe(
      "did:key:z6MkHolderExample",
    );
  });

  it("presentationSteps adds the params fetch only for tier 2", () => {
    expect(presentationSteps(1).map((s) => s.id)).toEqual([
      "deriving-presentation",
      "posting",
    ]);
    expect(presentationSteps(2).map((s) => s.id)).toEqual([
      "fetching-params",
      "deriving-presentation",
      "posting",
    ]);
  });
});

describe("predicateOption", () => {
  const shopQuery = () => shopDcql().credentials[0]!;
  const adultCandidate = () => ({ vc: adult.vc, payload: v3Payload(adult) });

  it("is available when the requested twin is declared by the credential's own base proof", () => {
    const option = predicateOption(shopQuery(), adultCandidate());
    expect(option.available).toBe(true);
    if (!option.available) return;
    expect(option.paramsUri).toBe(PARAMS_URI);
    expect(option.range).toHaveLength(1);
    const claim = option.range[0]!;
    expect(claim.pointer).toBe(DOB_POINTER);
    expect(claim.encoder).toBe("date1900");
    expect(claim.kind).toBe("lessOrEqual");
    expect(claim.bound).toBe(BOUND_18);
    expect(claim.digits).toBe(4);
    // The consent line comes from the DECLARED encoder, not verifier prose.
    expect(claim.description).toMatch(/birth_date on or before 2008-07-16/);
    expect(claim.description).toMatch(/at least \d+ years old/);
    // The shop's claim_set is empty: the proofs disclose nothing.
    expect(option.pointers).toEqual([]);
    expect(option.disclosed).toEqual({});
  });

  it("rentals shape: the predicate claim_set carries identity claims alongside the proof", () => {
    const option = predicateOption(rentalDcql().credentials[0]!, adultCandidate());
    expect(option.available).toBe(true);
    if (!option.available) return;
    expect(option.range[0]?.description).toMatch(/on or before 2001-07-16/);
    expect(option.pointers).toEqual([
      "/credentialSubject/driversLicense/given_name",
      "/credentialSubject/driversLicense/family_name",
      "/credentialSubject/driversLicense/document_number",
    ]);
    expect(option.disclosed).toEqual({
      given_name: "JAMIE",
      family_name: "VOSS",
      document_number: "F111222333",
    });

    // Tier 2 discloses exactly that set; the preview names the proven bit.
    const { candidates } = matchCredentials(
      [{ record: record(1), payload: v3Payload(adult) }],
      request({ dcql_query: rentalDcql() }),
    );
    expect(tierPointers(2, candidates[0]!.match, option)).toEqual(option.pointers);
    const preview = disclosurePreview(2, adult.vc, candidates[0]!.match, option);
    expect(preview["given_name"]).toBe("JAMIE");
    expect(preview["birth_date"]).toMatch(/proven, not shown/);
    expect(preview["age_over_25"]).toBeUndefined();
  });

  it("is unavailable when the verifier didn't ask for predicates", () => {
    const query = { ...shopQuery() };
    delete query.vgw_predicates;
    const option = predicateOption(query, adultCandidate());
    expect(option).toMatchObject({
      available: false,
      reason: expect.stringMatching(/doesn't request predicate proofs/),
    });
  });

  it("is unavailable for set-membership requests (reserved N5)", () => {
    const query = structuredClone(shopQuery());
    query.vgw_predicates = {
      params_uri: PARAMS_URI,
      membership: [
        { path: [...LICENSE_PATH, "issuing_authority"], set_id: "coastal", params_hash: "x" },
      ],
    };
    const option = predicateOption(query, adultCandidate());
    expect(option).toMatchObject({
      available: false,
      reason: expect.stringMatching(/membership/),
    });
  });

  it("is unavailable when the claimed pointer is not a declared twin", () => {
    const query = structuredClone(shopQuery());
    query.vgw_predicates!.range = [
      {
        path: [...LICENSE_PATH, "document_number"],
        kind: "lessOrEqual",
        bound: "1",
        digits: 4,
        params_hash: paramsHash,
      },
    ];
    const option = predicateOption(query, adultCandidate());
    expect(option).toMatchObject({
      available: false,
      reason: expect.stringMatching(/no hidden numeric twin for "document_number".*re-issue/i),
    });
  });

  it("is unavailable for credentials without a credkit base proof", () => {
    const unsigned = buildUtopiaDriversLicense({
      givenName: "JAMIE",
      familyName: "VOSS",
      birthDate: "1996-03-14",
      documentNumber: "F111222333",
      issuer: { id: issuer.controller, name: "Utopia DMV" },
    });
    const option = predicateOption(shopQuery(), {
      vc: unsigned,
      payload: legacyPayload(unsigned),
    });
    expect(option).toMatchObject({
      available: false,
      reason: expect.stringMatching(/predates the credkit upgrade.*re-issue/i),
    });
  });

  it("is unavailable when the credential lacks a claim_set claim", () => {
    const query = structuredClone(rentalDcql().credentials[0]!);
    query.claims!.push({
      id: "middle_name",
      path: [...LICENSE_PATH, "middle_name"],
    });
    query.vgw_predicates!.claim_set = ["middle_name"];
    const option = predicateOption(query, adultCandidate());
    expect(option).toMatchObject({
      available: false,
      reason: expect.stringMatching(/middle_name/),
    });
  });
});

describe("presentCredential", () => {
  async function run(
    tier: DisclosureTier,
    options?: {
      dcql?: DcqlQuery;
      fixture?: IssuedFixture;
      fetch?: Parameters<typeof stubFetch>[0];
    },
  ) {
    const req = request(options?.dcql !== undefined ? { dcql_query: options.dcql } : {});
    const { queryId, candidates } = matchCredentials(
      [{ record: record(1), payload: v3Payload(options?.fixture ?? adult) }],
      req,
    );
    const log = stubFetch(options?.fetch);
    const steps: string[] = [];
    const result = presentCredential({
      request: req,
      queryId,
      candidate: candidates[0]!,
      tier,
      masterSecret: MASTER_SECRET.slice(),
      onStep: (step) => steps.push(step),
    });
    return { req, queryId, log, steps, result };
  }

  it(
    "tier 1 produces a direct_post the verifier's own facade accepts — and carries NO holder identifier",
    async () => {
      const { req, log, steps, result } = await run(1);
      const outcome = await result;

      expect(steps).toEqual(["deriving-presentation", "posting"]);
      expect(outcome.redirectUri).toBe(REDIRECT_BACK);
      expect(log.gets).toHaveLength(0); // no params fetch below tier 2
      expect(log.posts[0]?.url).toBe(RESPONSE_URI);
      expect(log.posts[0]?.body.get("state")).toBe(req.state);

      const vp = postedPresentation(log, "utopia_dl_age");
      // The retired pairwise presenter DID did not rotate — it VANISHED: the
      // credkit VP carries no holder key, DID, or identifier of any kind.
      expect((vp as Record<string, unknown>)["holder"]).toBeUndefined();
      expect(summarizeCredkitPresentation(vp)).toEqual({
        rangeClaims: 0,
        membershipClaims: 0,
        equalities: 0,
      });

      // The verifier-side checks, exactly as the shop Worker runs them.
      const verification = await verifyCredkitPresentation({
        verifiablePresentation: vp,
        expectedIssuerDids: [issuer.controller],
        challenge: req.nonce,
        domain: req.client_id,
      });
      expect(verification.error).toBeUndefined();
      expect(verification.verified).toBe(true);

      // Tier 1 must not have leaked anything beyond the flag + mandatories.
      const subject = verification.documents?.[0]?.credentialSubject as Record<
        string,
        unknown
      >;
      const license = subject["driversLicense"] as Record<string, unknown>;
      expect(license["age_over_18"]).toBe(true);
      expect(license["birth_date"]).toBeUndefined();
      expect(license["given_name"]).toBeUndefined();
      expect(subject["id"]).toBeUndefined();
      expect(verification.documents?.[0]?.validFrom).toBe("2026-01-01T00:00:00Z");
    },
    120_000,
  );

  it(
    "tier 0 really is full disclosure of the subject",
    async () => {
      const { req, log, result } = await run(0);
      await result;
      const vp = postedPresentation(log, "utopia_dl_age");
      const verification = await verifyCredkitPresentation({
        verifiablePresentation: vp,
        expectedIssuerDids: [issuer.controller],
        challenge: req.nonce,
        domain: req.client_id,
      });
      expect(verification.verified).toBe(true);
      const subject = verification.documents?.[0]?.credentialSubject as Record<
        string,
        unknown
      >;
      const license = subject["driversLicense"] as Record<string, unknown>;
      expect(license["birth_date"]).toBe("1996-03-14");
      expect(license["given_name"]).toBe("JAMIE");
    },
    120_000,
  );

  it(
    "an identified credential's embedded subject id leaks even at tier 1 — pinned",
    async () => {
      // This is WHY the DMV issues without subject ids: node identifiers are
      // revealed structurally by selective disclosure, a cross-verifier
      // correlation handle. Pinning it keeps the consent warning honest.
      const { req, log, result } = await run(1, { fixture: identified });
      await result;
      const vp = postedPresentation(log, "utopia_dl_age");
      const verification = await verifyCredkitPresentation({
        verifiablePresentation: vp,
        expectedIssuerDids: [issuer.controller],
        challenge: req.nonce,
        domain: req.client_id,
      });
      expect(verification.verified).toBe(true);
      const subject = verification.documents?.[0]?.credentialSubject as Record<
        string,
        unknown
      >;
      expect(subject["id"]).toBe("did:key:z6MkHolderExample");
    },
    120_000,
  );

  it(
    "tier 2 at the shop: fetches + pins the published alphabet, proves the hidden twin, discloses nothing",
    async () => {
      const { req, log, steps, result } = await run(2);
      const outcome = await result;

      expect(steps).toEqual(["fetching-params", "deriving-presentation", "posting"]);
      expect(log.gets).toEqual([PARAMS_URI]);
      expect(outcome.redirectUri).toBe(REDIRECT_BACK);

      const vp = postedPresentation(log, "utopia_dl_age");
      expect((vp as Record<string, unknown>)["holder"]).toBeUndefined();
      expect(summarizeCredkitPresentation(vp)).toEqual({
        rangeClaims: 1,
        membershipClaims: 0,
        equalities: 0,
      });

      // The verifier restates ITS OWN claim list (Appendix D.2) — the same
      // params object it published, the bound its session offered.
      const verification = await verifyCredkitPresentation({
        verifiablePresentation: vp,
        expectedIssuerDids: [issuer.controller],
        challenge: req.nonce,
        domain: req.client_id,
        expectedRangeClaims: [
          {
            statement: 0,
            pointer: DOB_POINTER,
            kind: "lessOrEqual",
            bound: BigInt(BOUND_18),
            digits: 4,
            params,
          },
        ],
      });
      expect(verification.error).toBeUndefined();
      expect(verification.verified).toBe(true);

      // Hidden means hidden: no birth_date, no flags, no name — only the
      // issuer's mandatory disclosures rode along.
      const subject = (verification.documents?.[0]?.credentialSubject ?? {}) as Record<
        string,
        unknown
      >;
      const license = (subject["driversLicense"] ?? {}) as Record<string, unknown>;
      expect(license["birth_date"]).toBeUndefined();
      expect(license["age_over_18"]).toBeUndefined();
      expect(license["given_name"]).toBeUndefined();
      expect(verification.documents?.[0]?.validFrom).toBe("2026-01-01T00:00:00Z");

      // A verifier restating a bound the wallet never proved fails closed.
      const wrongBound = await verifyCredkitPresentation({
        verifiablePresentation: vp,
        expectedIssuerDids: [issuer.controller],
        challenge: req.nonce,
        domain: req.client_id,
        expectedRangeClaims: [
          {
            statement: 0,
            pointer: DOB_POINTER,
            kind: "lessOrEqual",
            bound: BigInt(BOUND_18) - 1n,
            digits: 4,
            params,
          },
        ],
      });
      expect(wrongBound.verified).toBe(false);
    },
    120_000,
  );

  it(
    "tier 2 at the rentals desk: identity claims ride alongside the range proof",
    async () => {
      const { req, log, result } = await run(2, { dcql: rentalDcql() });
      await result;

      const vp = postedPresentation(log, "utopia_dl_rental");
      const verification = await verifyCredkitPresentation({
        verifiablePresentation: vp,
        expectedIssuerDids: [issuer.controller],
        challenge: req.nonce,
        domain: req.client_id,
        expectedRangeClaims: [
          {
            statement: 0,
            pointer: DOB_POINTER,
            kind: "lessOrEqual",
            bound: BigInt(BOUND_25),
            digits: 4,
            params,
          },
        ],
      });
      expect(verification.error).toBeUndefined();
      expect(verification.verified).toBe(true);

      // The whole predicate claim_set is disclosed — and nothing outside it.
      const subject = verification.documents?.[0]?.credentialSubject as Record<
        string,
        unknown
      >;
      const license = subject["driversLicense"] as Record<string, unknown>;
      expect(license["given_name"]).toBe("JAMIE");
      expect(license["family_name"]).toBe("VOSS");
      expect(license["document_number"]).toBe("F111222333");
      expect(license["birth_date"]).toBeUndefined();
      expect(license["age_over_25"]).toBeUndefined();
    },
    120_000,
  );

  it(
    "an underage holder cannot present: the prover THROWS, fail closed, nothing posted",
    async () => {
      // Noa's hidden birth_date (2009-11-02) does not satisfy the 18+ bound.
      // Tier 2 availability was STRUCTURAL — the refusal happens at proving,
      // as a loud error, never as a bad proof (MIGRATION §9).
      const { log, result } = await run(2, { fixture: minor });
      await expect(result).rejects.toThrow(
        /does not satisfy the verifier's bound.*fails closed.*Nothing was sent/s,
      );
      expect(log.posts).toHaveLength(0);
    },
    120_000,
  );

  it("refuses a params_uri on a different origin than the verifier — before any fetch", async () => {
    const { log, result } = await run(2, {
      dcql: shopDcql({ paramsUri: "https://params.example/.well-known/credkit-params" }),
    });
    await expect(result).rejects.toThrow(/not on its own origin/);
    expect(log.gets).toHaveLength(0);
    expect(log.posts).toHaveLength(0);
  });

  it("refuses to prove when the request pins a different alphabet than the verifier publishes", async () => {
    const { log, result } = await run(2, {
      dcql: shopDcql({ paramsHash: "B".repeat(43) }),
    });
    await expect(result).rejects.toThrow(/pins a different proof alphabet/);
    expect(log.posts).toHaveLength(0);
  });

  it("refuses a published alphabet that does not match its own declared hash", async () => {
    const { log, result } = await run(2, {
      fetch: {
        paramsResponse: () =>
          Response.json({
            ...paramsDocument,
            range: { ...paramsDocument.range!, hash: "B".repeat(43) },
          }),
      },
    });
    await expect(result).rejects.toThrow(/does not match its own declared hash/);
    expect(log.posts).toHaveLength(0);
  });

  it("rejects a set-membership request loudly at the ceremony (reserved N5)", async () => {
    const dcql = shopDcql();
    dcql.credentials[0]!.vgw_predicates = {
      params_uri: PARAMS_URI,
      membership: [
        { path: [...LICENSE_PATH, "issuing_authority"], set_id: "coastal", params_hash: "x" },
      ],
    };
    const { log, result } = await run(2, { dcql });
    await expect(result).rejects.toThrow(/membership/);
    expect(log.gets).toHaveLength(0);
    expect(log.posts).toHaveLength(0);
  });

  it("fails a pre-credkit vault envelope with a clear re-issue error", async () => {
    const req = request();
    const match = matchDcqlCredentialQuery(adult.vc, req.dcql_query.credentials[0]!);
    const log = stubFetch();
    await expect(
      presentCredential({
        request: req,
        queryId: "utopia_dl_age",
        candidate: {
          record: record(1),
          vc: adult.vc,
          payload: legacyPayload(adult.vc),
          match: match!,
        },
        tier: 1,
        masterSecret: MASTER_SECRET.slice(),
      }),
    ).rejects.toThrow(/predates the credkit upgrade.*re-issue it at the Utopia DMV/);
    expect(log.posts).toHaveLength(0);
  });

  it("fails a v3 envelope whose credential carries no credkit proof with a re-issue error", async () => {
    const req = request();
    const unsigned = buildUtopiaDriversLicense({
      givenName: "JAMIE",
      familyName: "VOSS",
      birthDate: "1996-03-14",
      documentNumber: "F111222333",
      issuer: { id: issuer.controller, name: "Utopia DMV" },
    });
    const { queryId, candidates } = matchCredentials(
      [
        {
          record: record(1),
          payload: {
            version: 3,
            vc: unsigned,
            secretProverBlind: scalarToBase64Url(adult.binding.secretProverBlind),
          },
        },
      ],
      req,
    );
    const log = stubFetch();
    await expect(
      presentCredential({
        request: req,
        queryId,
        candidate: candidates[0]!,
        tier: 1,
        masterSecret: MASTER_SECRET.slice(),
      }),
    ).rejects.toThrow(/does not carry a credkit proof.*re-issue/);
    expect(log.posts).toHaveLength(0);
  });

  it("fails a malformed stored blind with a re-issue error", async () => {
    const req = request();
    const { queryId, candidates } = matchCredentials(
      [
        {
          record: record(1),
          payload: { version: 3, vc: adult.vc, secretProverBlind: "not-a-scalar" },
        },
      ],
      req,
    );
    const log = stubFetch();
    await expect(
      presentCredential({
        request: req,
        queryId,
        candidate: candidates[0]!,
        tier: 1,
        masterSecret: MASTER_SECRET.slice(),
      }),
    ).rejects.toThrow(/stored blind is malformed.*re-issue/);
    expect(log.posts).toHaveLength(0);
  });

  it("aborts at a phase boundary when the session locks", async () => {
    const req = request();
    const { queryId, candidates } = matchCredentials(
      [{ record: record(1), payload: v3Payload(adult) }],
      req,
    );
    const log = stubFetch();
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
    expect(log.posts).toHaveLength(0);
  });

  it("surfaces the verifier's OAuth error body on rejection", async () => {
    const { result } = await run(1, {
      fetch: {
        postResponse: () =>
          Response.json(
            {
              error: "invalid_request",
              error_description: "this session already received a response",
            },
            { status: 400 },
          ),
      },
    });
    await expect(result).rejects.toThrow(/already received a response/);
  });
});
