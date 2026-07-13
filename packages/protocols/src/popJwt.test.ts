import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { fromBase64Url, fromHex, toBase64Url, utf8 } from "@vgw/keys";
import { ed25519KeyPairFromSeed } from "./didkey.js";
import { PROOF_JWT_TYP, createProofJwt, verifyProofJwt } from "./popJwt.js";

const SEED = fromHex(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
);
const FOREIGN_SEED = fromHex(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
);
const AUD = "https://dmv.verygoodwallet.com";
const NONCE = "test-c-nonce";

/** Sign arbitrary header/payload so tests can craft structurally-broken JWTs. */
function forgeJwt(header: unknown, payload: unknown, seed: Uint8Array): string {
  const signingInput = `${toBase64Url(utf8(JSON.stringify(header)))}.${toBase64Url(
    utf8(JSON.stringify(payload)),
  )}`;
  return `${signingInput}.${toBase64Url(ed25519.sign(utf8(signingInput), seed))}`;
}

function decodeSegment(jwt: string, index: number): Record<string, unknown> {
  const segment = jwt.split(".")[index];
  if (segment === undefined) throw new Error("missing segment");
  return JSON.parse(new TextDecoder().decode(fromBase64Url(segment)));
}

describe("createProofJwt", () => {
  it("produces the pinned header and payload shape", () => {
    const { did, verificationMethodId } = ed25519KeyPairFromSeed(SEED);
    const jwt = createProofJwt({ seed: SEED, audience: AUD, nonce: NONCE });
    expect(decodeSegment(jwt, 0)).toEqual({
      alg: "EdDSA",
      typ: PROOF_JWT_TYP,
      kid: verificationMethodId,
    });
    const payload = decodeSegment(jwt, 1);
    expect(payload["iss"]).toBe(did);
    expect(payload["aud"]).toBe(AUD);
    expect(payload["nonce"]).toBe(NONCE);
    expect(payload["iat"]).toBeTypeOf("number");
  });
});

describe("verifyProofJwt", () => {
  it("round-trips and returns the holder DID", () => {
    const { did } = ed25519KeyPairFromSeed(SEED);
    const jwt = createProofJwt({ seed: SEED, audience: AUD, nonce: NONCE });
    const { holderDid, payload } = verifyProofJwt({ jwt, audience: AUD, nonce: NONCE });
    expect(holderDid).toBe(did);
    expect(payload.iss).toBe(did);
    expect(payload.nonce).toBe(NONCE);
  });

  it("rejects a wrong audience", () => {
    const jwt = createProofJwt({ seed: SEED, audience: AUD, nonce: NONCE });
    expect(() =>
      verifyProofJwt({ jwt, audience: "https://evil.example", nonce: NONCE }),
    ).toThrow(/aud/);
  });

  it("rejects a wrong nonce", () => {
    const jwt = createProofJwt({ seed: SEED, audience: AUD, nonce: NONCE });
    expect(() =>
      verifyProofJwt({ jwt, audience: AUD, nonce: "other-nonce" }),
    ).toThrow(/nonce/);
  });

  it("rejects an iat older than maxAgeSeconds", () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = createProofJwt({
      seed: SEED,
      audience: AUD,
      nonce: NONCE,
      issuedAt: now - 700,
    });
    expect(() => verifyProofJwt({ jwt, audience: AUD, nonce: NONCE })).toThrow(
      /older/,
    );
    // A larger window accepts the same proof.
    expect(
      verifyProofJwt({ jwt, audience: AUD, nonce: NONCE, maxAgeSeconds: 1000 })
        .holderDid,
    ).toBeTypeOf("string");
  });

  it("rejects an iat too far in the future", () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = createProofJwt({
      seed: SEED,
      audience: AUD,
      nonce: NONCE,
      issuedAt: now + 400,
    });
    expect(() => verifyProofJwt({ jwt, audience: AUD, nonce: NONCE })).toThrow(
      /future/,
    );
    expect(
      verifyProofJwt({ jwt, audience: AUD, nonce: NONCE, clockSkewSeconds: 500 })
        .holderDid,
    ).toBeTypeOf("string");
  });

  it("rejects a missing iat", () => {
    const { did, verificationMethodId } = ed25519KeyPairFromSeed(SEED);
    const jwt = forgeJwt(
      { alg: "EdDSA", typ: PROOF_JWT_TYP, kid: verificationMethodId },
      { iss: did, aud: AUD, nonce: NONCE },
      SEED,
    );
    expect(() => verifyProofJwt({ jwt, audience: AUD, nonce: NONCE })).toThrow(
      /iat/,
    );
  });

  it("rejects a tampered signature", () => {
    const jwt = createProofJwt({ seed: SEED, audience: AUD, nonce: NONCE });
    const [h, p, s] = jwt.split(".");
    const sig = fromBase64Url(s ?? "");
    sig[0] = (sig[0] ?? 0) ^ 0x01;
    expect(() =>
      verifyProofJwt({
        jwt: `${h}.${p}.${toBase64Url(sig)}`,
        audience: AUD,
        nonce: NONCE,
      }),
    ).toThrow(/signature/);
  });

  it("rejects a tampered payload (signature no longer covers it)", () => {
    const { did } = ed25519KeyPairFromSeed(SEED);
    const jwt = createProofJwt({ seed: SEED, audience: AUD, nonce: "original" });
    const [h, , s] = jwt.split(".");
    const forgedPayload = toBase64Url(
      utf8(
        JSON.stringify({
          iss: did,
          aud: AUD,
          iat: Math.floor(Date.now() / 1000),
          nonce: NONCE,
        }),
      ),
    );
    expect(() =>
      verifyProofJwt({ jwt: `${h}.${forgedPayload}.${s}`, audience: AUD, nonce: NONCE }),
    ).toThrow(/signature/);
  });

  it("rejects a foreign kid that does not match iss", () => {
    // An attacker re-signs the victim's claims under their own key but keeps
    // kid pointing at their key while iss still names the victim.
    const victim = ed25519KeyPairFromSeed(SEED);
    const attacker = ed25519KeyPairFromSeed(FOREIGN_SEED);
    const jwt = forgeJwt(
      { alg: "EdDSA", typ: PROOF_JWT_TYP, kid: attacker.verificationMethodId },
      {
        iss: victim.did,
        aud: AUD,
        iat: Math.floor(Date.now() / 1000),
        nonce: NONCE,
      },
      FOREIGN_SEED,
    );
    expect(() => verifyProofJwt({ jwt, audience: AUD, nonce: NONCE })).toThrow(
      /iss does not match kid/,
    );
  });

  it("rejects a swapped kid whose key did not produce the signature", () => {
    const victim = ed25519KeyPairFromSeed(SEED);
    const jwt = createProofJwt({ seed: FOREIGN_SEED, audience: AUD, nonce: NONCE });
    const [, p, s] = jwt.split(".");
    const swappedHeader = toBase64Url(
      utf8(
        JSON.stringify({
          alg: "EdDSA",
          typ: PROOF_JWT_TYP,
          kid: victim.verificationMethodId,
        }),
      ),
    );
    // iss (foreign did) no longer matches the swapped kid.
    expect(() =>
      verifyProofJwt({ jwt: `${swappedHeader}.${p}.${s}`, audience: AUD, nonce: NONCE }),
    ).toThrow(/iss does not match kid|signature/);
  });

  it("accepts a payload without iss (kid alone identifies the holder)", () => {
    const { did, verificationMethodId } = ed25519KeyPairFromSeed(SEED);
    const jwt = forgeJwt(
      { alg: "EdDSA", typ: PROOF_JWT_TYP, kid: verificationMethodId },
      { aud: AUD, iat: Math.floor(Date.now() / 1000), nonce: NONCE },
      SEED,
    );
    expect(verifyProofJwt({ jwt, audience: AUD, nonce: NONCE }).holderDid).toBe(did);
  });

  it("rejects a wrong typ", () => {
    const { did, verificationMethodId } = ed25519KeyPairFromSeed(SEED);
    const jwt = forgeJwt(
      { alg: "EdDSA", typ: "JWT", kid: verificationMethodId },
      { iss: did, aud: AUD, iat: Math.floor(Date.now() / 1000), nonce: NONCE },
      SEED,
    );
    expect(() => verifyProofJwt({ jwt, audience: AUD, nonce: NONCE })).toThrow(
      /typ/,
    );
  });

  it("rejects a wrong alg", () => {
    const { did, verificationMethodId } = ed25519KeyPairFromSeed(SEED);
    const jwt = forgeJwt(
      { alg: "RS256", typ: PROOF_JWT_TYP, kid: verificationMethodId },
      { iss: did, aud: AUD, iat: Math.floor(Date.now() / 1000), nonce: NONCE },
      SEED,
    );
    expect(() => verifyProofJwt({ jwt, audience: AUD, nonce: NONCE })).toThrow(
      /alg/,
    );
  });

  it("rejects a kid that is not a did:key", () => {
    const { did } = ed25519KeyPairFromSeed(SEED);
    const jwt = forgeJwt(
      { alg: "EdDSA", typ: PROOF_JWT_TYP, kid: "did:web:evil.example#key-1" },
      { iss: did, aud: AUD, iat: Math.floor(Date.now() / 1000), nonce: NONCE },
      SEED,
    );
    expect(() => verifyProofJwt({ jwt, audience: AUD, nonce: NONCE })).toThrow(
      /did:key/,
    );
  });

  it("rejects malformed compact JWS strings", () => {
    for (const jwt of ["", "a.b", "a.b.c.d", "..", "not-a-jwt"]) {
      expect(() => verifyProofJwt({ jwt, audience: AUD, nonce: NONCE })).toThrow();
    }
  });

  it("rejects non-JSON segments", () => {
    const garbage = toBase64Url(utf8("not json"));
    expect(() =>
      verifyProofJwt({ jwt: `${garbage}.${garbage}.${garbage}`, audience: AUD, nonce: NONCE }),
    ).toThrow(/JSON/);
  });
});
