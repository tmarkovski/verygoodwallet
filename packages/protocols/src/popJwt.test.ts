import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { fromBase64Url, fromHex, toBase64Url, utf8 } from "@vgw/keys";
import { ed25519KeyPairFromSeed } from "./didkey.js";
import {
  PROOF_JWT_TYP,
  commitmentDigest,
  createProofJwt,
  verifyProofJwt,
} from "./popJwt.js";

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
    // Without a commitmentDigest option the VGW claim is absent, not null.
    expect("vgw_commitment_digest" in payload).toBe(false);
  });

  it("signs the commitment digest into the payload as vgw_commitment_digest", async () => {
    const digest = await commitmentDigest(new Uint8Array([1, 2, 3]));
    const jwt = createProofJwt({
      seed: SEED,
      audience: AUD,
      nonce: NONCE,
      commitmentDigest: digest,
    });
    expect(decodeSegment(jwt, 1)["vgw_commitment_digest"]).toBe(digest);
  });
});

describe("commitmentDigest", () => {
  it("is base64url SHA-256 over the raw bytes (fixed vector)", async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(await commitmentDigest(new Uint8Array(0))).toBe(
      toBase64Url(
        fromHex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
      ),
    );
  });

  it("differs for different commitment bytes", async () => {
    const a = await commitmentDigest(new Uint8Array(144).fill(1));
    const b = await commitmentDigest(new Uint8Array(144).fill(2));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
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

  it("round-trips the commitment digest when the issuer expects it", async () => {
    const digest = await commitmentDigest(new Uint8Array(144).fill(7));
    const jwt = createProofJwt({
      seed: SEED,
      audience: AUD,
      nonce: NONCE,
      commitmentDigest: digest,
    });
    const verified = verifyProofJwt({
      jwt,
      audience: AUD,
      nonce: NONCE,
      expectedCommitmentDigest: digest,
    });
    expect(verified.payload.vgw_commitment_digest).toBe(digest);
  });

  it("rejects a digest minted for a different commitment", async () => {
    const jwt = createProofJwt({
      seed: SEED,
      audience: AUD,
      nonce: NONCE,
      commitmentDigest: await commitmentDigest(new Uint8Array(144).fill(7)),
    });
    expect(() =>
      verifyProofJwt({
        jwt,
        audience: AUD,
        nonce: NONCE,
        expectedCommitmentDigest: "different-digest",
      }),
    ).toThrow(/vgw_commitment_digest mismatch/);
  });

  it("rejects a proof with no digest when the issuer expects one", async () => {
    // A bare PoP binds a key to nothing in the credkit model (§3.3): when the
    // issuer received a commitment, a proof that does not attest it fails.
    const jwt = createProofJwt({ seed: SEED, audience: AUD, nonce: NONCE });
    const expected = await commitmentDigest(new Uint8Array(3));
    expect(() =>
      verifyProofJwt({
        jwt,
        audience: AUD,
        nonce: NONCE,
        expectedCommitmentDigest: expected,
      }),
    ).toThrow(/missing vgw_commitment_digest/);
  });

  it("accepts a digest-carrying proof when the issuer does not demand one", async () => {
    // Forward-compatible: the claim is additive; verifiers that do not pass
    // expectedCommitmentDigest ignore it.
    const jwt = createProofJwt({
      seed: SEED,
      audience: AUD,
      nonce: NONCE,
      commitmentDigest: await commitmentDigest(new Uint8Array(3)),
    });
    expect(verifyProofJwt({ jwt, audience: AUD, nonce: NONCE }).holderDid).toMatch(
      /^did:key:/,
    );
  });

  it("digest tampering breaks the signature (the claim is covered)", async () => {
    const digest = await commitmentDigest(new Uint8Array(144).fill(7));
    const otherDigest = await commitmentDigest(new Uint8Array(144).fill(8));
    const { did } = ed25519KeyPairFromSeed(SEED);
    const jwt = createProofJwt({
      seed: SEED,
      audience: AUD,
      nonce: NONCE,
      commitmentDigest: digest,
    });
    const [h, , s] = jwt.split(".");
    const forgedPayload = toBase64Url(
      utf8(
        JSON.stringify({
          iss: did,
          aud: AUD,
          iat: Math.floor(Date.now() / 1000),
          nonce: NONCE,
          vgw_commitment_digest: otherDigest,
        }),
      ),
    );
    expect(() =>
      verifyProofJwt({
        jwt: `${h}.${forgedPayload}.${s}`,
        audience: AUD,
        nonce: NONCE,
        expectedCommitmentDigest: otherDigest,
      }),
    ).toThrow(/signature/);
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
