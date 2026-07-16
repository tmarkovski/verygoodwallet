import { describe, expect, it } from "vitest";
import {
  CREDKIT_PARAMS_PATH,
  assertCredkitParamsDocument,
  type CredkitParamsDocument,
} from "./credkitParams.js";

const DOCUMENT: CredkitParamsDocument = {
  version: 1,
  suite: "credkit-bbs-sha-2026",
  range: { base: 16, params: "AAAB_zz-99", hash: "c2hhLTI1Ng" },
};

describe("assertCredkitParamsDocument", () => {
  it("pins the well-known path", () => {
    expect(CREDKIT_PARAMS_PATH).toBe("/.well-known/credkit-params");
  });

  it("accepts a well-formed document (range optional)", () => {
    expect(assertCredkitParamsDocument(DOCUMENT)).toEqual(DOCUMENT);
    const bare = { version: 1, suite: "credkit-bbs-sha-2026" };
    expect(assertCredkitParamsDocument(bare)).toEqual(bare);
  });

  it("rejects non-objects", () => {
    expect(() => assertCredkitParamsDocument(null)).toThrow(/not a JSON object/);
    expect(() => assertCredkitParamsDocument([DOCUMENT])).toThrow(/not a JSON object/);
    expect(() => assertCredkitParamsDocument("params")).toThrow(/not a JSON object/);
  });

  it("rejects any version but 1", () => {
    expect(() => assertCredkitParamsDocument({ ...DOCUMENT, version: 2 })).toThrow(
      /unsupported version 2/,
    );
    expect(() => assertCredkitParamsDocument({ ...DOCUMENT, version: "1" })).toThrow(
      /unsupported version/,
    );
    const { version: _version, ...noVersion } = DOCUMENT;
    expect(() => assertCredkitParamsDocument(noVersion)).toThrow(/unsupported version/);
  });

  it("rejects a missing or empty suite", () => {
    expect(() => assertCredkitParamsDocument({ ...DOCUMENT, suite: "" })).toThrow(
      /names no cryptosuite/,
    );
    expect(() => assertCredkitParamsDocument({ ...DOCUMENT, suite: 2026 })).toThrow(
      /names no cryptosuite/,
    );
  });

  it("accepts a well-formed sets map (and an empty one)", () => {
    const withSets: CredkitParamsDocument = {
      ...DOCUMENT,
      sets: {
        coastal: { params: "AAAB_zz-99", hash: "c2hhLTI1Ng" },
        "vip-block": { params: "BBBB", hash: "CCCC" },
      },
    };
    expect(assertCredkitParamsDocument(withSets)).toEqual(withSets);
    // An empty map means "this verifier publishes no sets" — same as absent.
    expect(assertCredkitParamsDocument({ ...DOCUMENT, sets: {} })).toEqual({
      ...DOCUMENT,
      sets: {},
    });
  });

  it("rejects malformed sets maps entry by entry", () => {
    const withSets = (sets: unknown) => ({ ...DOCUMENT, sets });
    const entry = { params: "AAAA", hash: "BBBB" };
    expect(() => assertCredkitParamsDocument(withSets("coastal"))).toThrow(
      /non-object sets map/,
    );
    expect(() => assertCredkitParamsDocument(withSets([entry]))).toThrow(
      /non-object sets map/,
    );
    expect(() => assertCredkitParamsDocument(withSets({ "": entry }))).toThrow(
      /set with an empty id/,
    );
    expect(() => assertCredkitParamsDocument(withSets({ coastal: "params" }))).toThrow(
      /sets\["coastal"\] is not an object/,
    );
    expect(() =>
      assertCredkitParamsDocument(withSets({ coastal: { ...entry, params: "" } })),
    ).toThrow(/sets\["coastal"\]\.params/);
    expect(() =>
      assertCredkitParamsDocument(withSets({ coastal: { ...entry, params: "not+b64url/" } })),
    ).toThrow(/sets\["coastal"\]\.params/);
    expect(() =>
      assertCredkitParamsDocument(withSets({ coastal: { params: "AAAA" } })),
    ).toThrow(/sets\["coastal"\]\.hash/);
    expect(() =>
      assertCredkitParamsDocument(withSets({ coastal: { ...entry, hash: "pad==" } })),
    ).toThrow(/sets\["coastal"\]\.hash/);
    // One bad entry poisons the document even next to a good one.
    expect(() =>
      assertCredkitParamsDocument(withSets({ good: entry, bad: { params: "AAAA" } })),
    ).toThrow(/sets\["bad"\]\.hash/);
  });

  it("rejects malformed range blocks field by field", () => {
    const withRange = (range: unknown) => ({ ...DOCUMENT, range });
    expect(() => assertCredkitParamsDocument(withRange("base16"))).toThrow(/non-object range/);
    expect(() =>
      assertCredkitParamsDocument(withRange({ ...DOCUMENT.range, base: 1 })),
    ).toThrow(/range\.base/);
    expect(() =>
      assertCredkitParamsDocument(withRange({ ...DOCUMENT.range, base: 65537 })),
    ).toThrow(/range\.base/);
    expect(() =>
      assertCredkitParamsDocument(withRange({ ...DOCUMENT.range, base: 16.5 })),
    ).toThrow(/range\.base/);
    expect(() =>
      assertCredkitParamsDocument(withRange({ ...DOCUMENT.range, params: "" })),
    ).toThrow(/range\.params/);
    expect(() =>
      assertCredkitParamsDocument(withRange({ ...DOCUMENT.range, params: "not+base64url/" })),
    ).toThrow(/range\.params/);
    expect(() =>
      assertCredkitParamsDocument(withRange({ ...DOCUMENT.range, hash: "with=padding==" })),
    ).toThrow(/range\.hash/);
    expect(() =>
      assertCredkitParamsDocument(withRange({ base: 16, params: "AAAA" })),
    ).toThrow(/range\.hash/);
  });
});
