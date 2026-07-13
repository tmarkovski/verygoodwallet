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
});
