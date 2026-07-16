import { describe, expect, it } from "vitest";
import {
  REDIRECT_URI_CLIENT_ID_PREFIX,
  assertDcqlQuery,
  presentationRequestFromParams,
  presentationRequestToParams,
  walletPresentLink,
  type DcqlQuery,
  type PresentationRequest,
} from "./oid4vp.js";

const RESPONSE_URI = "https://shop.example/oid4vp/response";

const DCQL: DcqlQuery = {
  credentials: [
    {
      id: "utopia_dl",
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
    client_id: `${REDIRECT_URI_CLIENT_ID_PREFIX}${RESPONSE_URI}`,
    response_uri: RESPONSE_URI,
    nonce: "nonce-123",
    state: "state-456",
    dcql_query: DCQL,
    client_metadata: { client_name: "The Nightcap" },
    ...overrides,
  };
}

describe("presentation request params codec", () => {
  it("round-trips a request through query params", () => {
    const original = request();
    const parsed = presentationRequestFromParams(presentationRequestToParams(original));
    expect(parsed).toEqual(original);
  });

  it("builds a wallet /present link carrying the request", () => {
    const link = walletPresentLink("https://wallet.example", request());
    const url = new URL(link);
    expect(url.origin).toBe("https://wallet.example");
    expect(url.pathname).toBe("/present");
    const parsed = presentationRequestFromParams(url.searchParams);
    expect(parsed.nonce).toBe("nonce-123");
    expect(parsed.dcql_query).toEqual(DCQL);
  });

  it("rejects a client_id that does not match the response_uri", () => {
    const params = presentationRequestToParams(request());
    params.set("client_id", `${REDIRECT_URI_CLIENT_ID_PREFIX}https://evil.example/response`);
    expect(() => presentationRequestFromParams(params)).toThrow(/client_id does not match/);
  });

  it.each(["response_type", "response_mode", "client_id", "response_uri", "nonce", "state", "dcql_query"])(
    "rejects a request missing %s",
    (name) => {
      const params = presentationRequestToParams(request());
      params.delete(name);
      expect(() => presentationRequestFromParams(params)).toThrow();
    },
  );

  it("rejects unsupported response modes and types", () => {
    const byMode = presentationRequestToParams(request());
    byMode.set("response_mode", "fragment");
    expect(() => presentationRequestFromParams(byMode)).toThrow(/response_mode/);

    const byType = presentationRequestToParams(request());
    byType.set("response_type", "code");
    expect(() => presentationRequestFromParams(byType)).toThrow(/response_type/);
  });

  it("rejects a non-http(s) response_uri", () => {
    const params = presentationRequestToParams(
      request({
        response_uri: "javascript:alert(1)",
        client_id: `${REDIRECT_URI_CLIENT_ID_PREFIX}javascript:alert(1)`,
      }),
    );
    expect(() => presentationRequestFromParams(params)).toThrow(/http\(s\)/);
  });

  it("drops non-string client_metadata fields instead of rendering them", () => {
    const params = presentationRequestToParams(request());
    params.set("client_metadata", JSON.stringify({ client_name: { evil: true } }));
    const parsed = presentationRequestFromParams(params);
    expect(parsed.client_metadata).toEqual({});
  });
});

describe("assertDcqlQuery", () => {
  it("accepts the demo query", () => {
    expect(assertDcqlQuery(DCQL)).toEqual(DCQL);
  });

  it("rejects empty credential lists", () => {
    expect(() => assertDcqlQuery({ credentials: [] })).toThrow(/no credential queries/);
  });

  it("rejects unsupported formats", () => {
    expect(() =>
      assertDcqlQuery({ credentials: [{ id: "x", format: "mso_mdoc" }] }),
    ).toThrow(/unsupported format/);
  });

  it("rejects claim_sets referencing unknown claim ids", () => {
    expect(() =>
      assertDcqlQuery({
        credentials: [
          {
            id: "x",
            format: "ldp_vc",
            claims: [{ id: "a", path: ["credentialSubject"] }],
            claim_sets: [["a", "missing"]],
          },
        ],
      }),
    ).toThrow(/unknown claim id "missing"/);
  });

  it("rejects malformed claim paths", () => {
    expect(() =>
      assertDcqlQuery({
        credentials: [{ id: "x", format: "ldp_vc", claims: [{ path: [] }] }],
      }),
    ).toThrow(/valid path/);
    expect(() =>
      assertDcqlQuery({
        credentials: [{ id: "x", format: "ldp_vc", claims: [{ path: [-1] }] }],
      }),
    ).toThrow(/valid path/);
  });

  describe("vgw_predicates extension", () => {
    const BIRTH_DATE_PATH = ["credentialSubject", "driversLicense", "birth_date"];
    const rangeClaim = (overrides?: Record<string, unknown>) => ({
      path: BIRTH_DATE_PATH,
      kind: "lessOrEqual",
      bound: "46216",
      digits: 4,
      params_hash: "c2hhLTI1Ng",
      ...overrides,
    });
    const withPredicates = (vgw_predicates: unknown) => ({
      credentials: [
        {
          id: "x",
          format: "ldp_vc",
          claims: [
            { id: "given_name", path: ["credentialSubject", "driversLicense", "given_name"] },
            { id: "dob", path: BIRTH_DATE_PATH },
          ],
          claim_sets: [["dob"]],
          vgw_predicates,
        },
      ],
    });
    const predicates = (overrides?: Record<string, unknown>) => ({
      params_uri: "https://shop.example/.well-known/credkit-params",
      range: [rangeClaim()],
      ...overrides,
    });

    it("accepts a well-formed range predicate (with and without a claim_set)", () => {
      const bare = withPredicates(predicates());
      expect(assertDcqlQuery(bare)).toEqual(bare);
      const withSet = withPredicates(predicates({ claim_set: ["given_name"] }));
      expect(assertDcqlQuery(withSet)).toEqual(withSet);
    });

    it("accepts the reserved membership shape (typed now, wallet-rejected until N5)", () => {
      const query = withPredicates(
        predicates({
          range: undefined,
          membership: [{ path: BIRTH_DATE_PATH, set_id: "coastal", params_hash: "aGFzaA" }],
        }),
      );
      expect(assertDcqlQuery(query)).toEqual(query);
    });

    it("rejects a non-object vgw_predicates", () => {
      expect(() => assertDcqlQuery(withPredicates("zk please"))).toThrow(/non-object/);
    });

    it("rejects a missing or non-http(s) params_uri", () => {
      expect(() => assertDcqlQuery(withPredicates(predicates({ params_uri: undefined })))).toThrow(
        /params_uri/,
      );
      expect(() =>
        assertDcqlQuery(withPredicates(predicates({ params_uri: "/.well-known/credkit-params" }))),
      ).toThrow(/params_uri/);
      expect(() =>
        assertDcqlQuery(withPredicates(predicates({ params_uri: "ftp://shop.example/params" }))),
      ).toThrow(/params_uri/);
    });

    it("rejects a vgw_predicates that demands no proof", () => {
      expect(() => assertDcqlQuery(withPredicates(predicates({ range: [] })))).toThrow(
        /neither range nor membership/,
      );
      expect(() => assertDcqlQuery(withPredicates(predicates({ range: undefined })))).toThrow(
        /neither range nor membership/,
      );
    });

    it("rejects malformed range entries field by field", () => {
      const bad = (claim: Record<string, unknown>, pattern: RegExp) => {
        expect(() =>
          assertDcqlQuery(withPredicates(predicates({ range: [rangeClaim(claim)] }))),
        ).toThrow(pattern);
      };
      bad({ path: [] }, /valid path/);
      bad({ path: "birth_date" }, /valid path/);
      bad({ kind: "between" }, /unsupported vgw_predicates.range kind/);
      bad({ bound: 46216 }, /decimal integer string/);
      bad({ bound: "046216" }, /decimal integer string/);
      bad({ bound: "-1" }, /decimal integer string/);
      bad({ digits: 0 }, /digits outside 1\.\.16/);
      bad({ digits: 17 }, /digits outside 1\.\.16/);
      bad({ digits: 4.5 }, /digits outside 1\.\.16/);
      bad({ params_hash: "" }, /params_hash/);
      bad({ params_hash: undefined }, /params_hash/);
    });

    it("rejects malformed membership entries", () => {
      const bad = (claim: Record<string, unknown>, pattern: RegExp) => {
        expect(() =>
          assertDcqlQuery(
            withPredicates(predicates({ range: undefined, membership: [claim] })),
          ),
        ).toThrow(pattern);
      };
      bad({ path: BIRTH_DATE_PATH, set_id: "", params_hash: "aGFzaA" }, /set_id/);
      bad({ path: BIRTH_DATE_PATH, set_id: "coastal", params_hash: "" }, /params_hash/);
      bad({ path: [], set_id: "coastal", params_hash: "aGFzaA" }, /valid path/);
    });

    it("rejects claim_set references to undefined claims", () => {
      expect(() =>
        assertDcqlQuery(withPredicates(predicates({ claim_set: ["given_name", "nope"] }))),
      ).toThrow(/unknown claim id "nope"/);
      expect(() =>
        assertDcqlQuery(withPredicates(predicates({ claim_set: [42] }))),
      ).toThrow(/claim_set/);
    });
  });

  describe("vgw_equalities extension", () => {
    const twoQueries = (vgw_equalities: unknown) => ({
      credentials: [
        { id: "dl", format: "ldp_vc" },
        { id: "resident", format: "ldp_vc" },
      ],
      vgw_equalities,
    });

    it("accepts the reserved link-secret and pointer shapes", () => {
      const linkage = twoQueries([
        [{ query: "dl", link_secret: true }, { query: "resident", link_secret: true }],
      ]);
      expect(assertDcqlQuery(linkage)).toEqual(linkage);
      const pointers = twoQueries([
        [
          { query: "dl", path: ["credentialSubject", "driversLicense", "birth_date"] },
          { query: "resident", link_secret: true },
        ],
      ]);
      expect(assertDcqlQuery(pointers)).toEqual(pointers);
    });

    it("rejects groups with fewer than two references", () => {
      expect(() => assertDcqlQuery(twoQueries([[{ query: "dl", link_secret: true }]]))).toThrow(
        /at least two references/,
      );
      expect(() => assertDcqlQuery(twoQueries(["not-an-array"]))).toThrow(
        /at least two references/,
      );
    });

    it("rejects references to unknown query ids", () => {
      expect(() =>
        assertDcqlQuery(
          twoQueries([
            [{ query: "dl", link_secret: true }, { query: "loyalty", link_secret: true }],
          ]),
        ),
      ).toThrow(/unknown credential query "loyalty"/);
    });

    it("rejects references without exactly one of link_secret or path", () => {
      const both = [
        [
          { query: "dl", link_secret: true, path: ["credentialSubject"] },
          { query: "resident", link_secret: true },
        ],
      ];
      expect(() => assertDcqlQuery(twoQueries(both))).toThrow(/exactly one of/);
      const neither = [[{ query: "dl" }, { query: "resident", link_secret: true }]];
      expect(() => assertDcqlQuery(twoQueries(neither))).toThrow(/exactly one of/);
      const falseSecret = [
        [{ query: "dl", link_secret: false }, { query: "resident", link_secret: true }],
      ];
      expect(() => assertDcqlQuery(twoQueries(falseSecret))).toThrow(/exactly true/);
      const badPath = [
        [{ query: "dl", path: [] }, { query: "resident", link_secret: true }],
      ];
      expect(() => assertDcqlQuery(twoQueries(badPath))).toThrow(/valid path/);
    });
  });
});
