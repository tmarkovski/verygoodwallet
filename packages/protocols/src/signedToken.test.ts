import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url, utf8 } from "@vgw/keys";
import { mintSignedToken, readSignedToken } from "./signedToken.js";

const SECRET = "test-token-secret";

/** MAC an arbitrary body so tests can craft valid-signature/bad-payload tokens. */
async function signBody(body: string, secret: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    utf8(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await globalThis.crypto.subtle.sign("HMAC", key, utf8(body) as BufferSource);
  return `${body}.${toBase64Url(new Uint8Array(mac))}`;
}

describe("mintSignedToken / readSignedToken", () => {
  it("round-trips a payload and stamps exp = now + ttl", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await mintSignedToken({
      secret: SECRET,
      payload: { use: "offer", givenName: "Ada", birthDate: "2000-01-01" },
      ttlSeconds: 600,
    });
    const read = await readSignedToken<{
      use: string;
      givenName: string;
      birthDate: string;
      exp: number;
    }>({ secret: SECRET, token });
    expect(read.use).toBe("offer");
    expect(read.givenName).toBe("Ada");
    expect(read.birthDate).toBe("2000-01-01");
    expect(read.exp).toBeGreaterThanOrEqual(before + 600);
    expect(read.exp).toBeLessThanOrEqual(before + 601);
  });

  it("overrides a caller-supplied exp with the computed one", async () => {
    // A payload smuggling its own far-future exp must not extend the TTL.
    const token = await mintSignedToken({
      secret: SECRET,
      payload: { use: "access", exp: 9999999999 },
      ttlSeconds: 300,
    });
    const read = await readSignedToken<{ exp: number }>({ secret: SECRET, token });
    expect(read.exp).toBeLessThan(9999999999);
  });

  it("accepts string and Uint8Array secrets interchangeably", async () => {
    const token = await mintSignedToken({
      secret: utf8(SECRET),
      payload: { use: "offer" },
      ttlSeconds: 60,
    });
    await expect(
      readSignedToken<{ use: string }>({ secret: SECRET, token }),
    ).resolves.toMatchObject({ use: "offer" });
  });

  it("rejects a tampered payload", async () => {
    const token = await mintSignedToken({
      secret: SECRET,
      payload: { use: "offer" },
      ttlSeconds: 60,
    });
    const [body, mac] = token.split(".");
    const bytes = fromBase64Url(body ?? "");
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    await expect(
      readSignedToken({ secret: SECRET, token: `${toBase64Url(bytes)}.${mac}` }),
    ).rejects.toThrow(/verification failed/);
  });

  it("rejects a tampered signature (any byte)", async () => {
    const token = await mintSignedToken({
      secret: SECRET,
      payload: { use: "offer" },
      ttlSeconds: 60,
    });
    const [body, mac] = token.split(".");
    const macBytes = fromBase64Url(mac ?? "");
    for (const index of [0, 15, macBytes.length - 1]) {
      const tampered = new Uint8Array(macBytes);
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      await expect(
        readSignedToken({ secret: SECRET, token: `${body}.${toBase64Url(tampered)}` }),
      ).rejects.toThrow(/verification failed/);
    }
  });

  it("rejects a token minted with a different secret", async () => {
    const token = await mintSignedToken({
      secret: "other-secret",
      payload: { use: "offer" },
      ttlSeconds: 60,
    });
    await expect(readSignedToken({ secret: SECRET, token })).rejects.toThrow(
      /verification failed/,
    );
  });

  it("rejects an expired token", async () => {
    const token = await mintSignedToken({
      secret: SECRET,
      payload: { use: "offer" },
      ttlSeconds: -1,
    });
    await expect(readSignedToken({ secret: SECRET, token })).rejects.toThrow(
      /expired/,
    );
  });

  it("treats exp == now as expired (RFC 7519 'on or after')", async () => {
    const token = await mintSignedToken({
      secret: SECRET,
      payload: { use: "offer" },
      ttlSeconds: 0,
    });
    await expect(readSignedToken({ secret: SECRET, token })).rejects.toThrow(
      /expired/,
    );
  });

  it("rejects malformed token strings", async () => {
    for (const token of ["", "no-dot", "a.b.c", ".", "a.", ".b", "a.!!!"]) {
      await expect(readSignedToken({ secret: SECRET, token })).rejects.toThrow(
        /Malformed/,
      );
    }
  });

  it("rejects a validly-signed body that is not JSON", async () => {
    const token = await signBody(toBase64Url(utf8("not json")), SECRET);
    await expect(readSignedToken({ secret: SECRET, token })).rejects.toThrow(
      /JSON/,
    );
  });

  it("rejects a validly-signed body that is not an object", async () => {
    const token = await signBody(toBase64Url(utf8("[1,2,3]")), SECRET);
    await expect(readSignedToken({ secret: SECRET, token })).rejects.toThrow(
      /object/,
    );
  });

  it("rejects a validly-signed payload without exp", async () => {
    const token = await signBody(toBase64Url(utf8('{"use":"offer"}')), SECRET);
    await expect(readSignedToken({ secret: SECRET, token })).rejects.toThrow(
      /exp/,
    );
  });

  it("rejects an empty secret", async () => {
    await expect(
      mintSignedToken({ secret: "", payload: {}, ttlSeconds: 60 }),
    ).rejects.toThrow(/empty/);
    await expect(
      mintSignedToken({ secret: new Uint8Array(0), payload: {}, ttlSeconds: 60 }),
    ).rejects.toThrow(/empty/);
  });

  it("rejects a non-finite ttl", async () => {
    await expect(
      mintSignedToken({ secret: SECRET, payload: {}, ttlSeconds: Number.NaN }),
    ).rejects.toThrow(TypeError);
  });
});
