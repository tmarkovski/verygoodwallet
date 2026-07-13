import { describe, expect, it } from "vitest";
import { fromBase64Url, fromHex, toBase64Url, toHex, utf8 } from "../src/index.js";

describe("base64url", () => {
  it("encodes known vectors (unpadded, url-safe)", () => {
    expect(toBase64Url(utf8(""))).toBe("");
    expect(toBase64Url(utf8("f"))).toBe("Zg");
    expect(toBase64Url(utf8("fo"))).toBe("Zm8");
    expect(toBase64Url(utf8("foo"))).toBe("Zm9v");
    expect(toBase64Url(utf8("foob"))).toBe("Zm9vYg");
    expect(toBase64Url(utf8("fooba"))).toBe("Zm9vYmE");
    expect(toBase64Url(utf8("foobar"))).toBe("Zm9vYmFy");
  });

  it("uses - and _ instead of + and /", () => {
    // 0xfb 0xef 0xbe encodes to "++++" in standard base64.
    const bytes = fromHex("fbefbe");
    expect(toBase64Url(bytes)).toBe("----");
    expect(toBase64Url(fromHex("ffffff"))).toBe("____");
  });

  it("round-trips all byte lengths 0..64", () => {
    for (let length = 0; length <= 64; length++) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it("tolerates trailing padding on decode", () => {
    expect(fromBase64Url("Zm8=")).toEqual(utf8("fo"));
    expect(fromBase64Url("Zg==")).toEqual(utf8("f"));
  });

  it("rejects invalid characters", () => {
    expect(() => fromBase64Url("a+b/")).toThrow(/invalid base64url/i);
    expect(() => fromBase64Url("ab cd")).toThrow(/invalid base64url/i);
  });

  it("rejects impossible lengths", () => {
    expect(() => fromBase64Url("aaaaa")).toThrow(/bad length/i);
  });
});

describe("hex", () => {
  it("encodes known vectors as lowercase", () => {
    expect(toHex(new Uint8Array([]))).toBe("");
    expect(toHex(new Uint8Array([0x00, 0x01, 0xab, 0xff]))).toBe("0001abff");
  });

  it("decodes case-insensitively with optional 0x prefix", () => {
    expect(fromHex("0001ABff")).toEqual(new Uint8Array([0x00, 0x01, 0xab, 0xff]));
    expect(fromHex("0x0001abff")).toEqual(new Uint8Array([0x00, 0x01, 0xab, 0xff]));
  });

  it("round-trips random bytes", () => {
    for (let length = 0; length <= 64; length += 7) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
      expect(fromHex(toHex(bytes))).toEqual(bytes);
    }
  });

  it("rejects odd lengths and non-hex characters", () => {
    expect(() => fromHex("abc")).toThrow(/odd length/i);
    expect(() => fromHex("zz")).toThrow(/bad characters/i);
    expect(() => fromHex("12g4")).toThrow(/bad characters/i);
  });
});

describe("utf8", () => {
  it("encodes ASCII and multi-byte characters", () => {
    expect(utf8("abc")).toEqual(new Uint8Array([0x61, 0x62, 0x63]));
    expect(toHex(utf8("é"))).toBe("c3a9");
    expect(toHex(utf8("🔑"))).toBe("f09f9491");
  });
});
