/**
 * Stateless HMAC-signed tokens: `base64url(JSON payload) . base64url(HMAC-SHA-256)`.
 *
 * The issuer Worker keeps no session state — pre-authorized codes and access
 * tokens are self-contained signed blobs. Anything the endpoint needs later
 * (expiry, `use` discriminator, `c_nonce`, subject data) is embedded in the
 * payload and integrity-protected by the MAC. Consequence: tokens cannot be
 * revoked and single-use is not enforced; short TTLs bound the exposure
 * (documented demo tradeoff).
 *
 * WebCrypto only — runs identically in browsers, Workers, and Node 22+.
 */

import { fromBase64Url, toBase64Url, utf8 } from "@vgw/keys";

async function importHmacKey(secret: string | Uint8Array): Promise<CryptoKey> {
  const secretBytes = typeof secret === "string" ? utf8(secret) : secret;
  if (secretBytes.length === 0) {
    throw new Error("Signed token secret must not be empty");
  }
  return globalThis.crypto.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface MintSignedTokenOptions {
  secret: string | Uint8Array;
  /** Claims to embed. Include a `use` discriminator so token kinds can't be swapped. */
  payload: Record<string, unknown>;
  ttlSeconds: number;
}

/** Mint a signed token; `exp` (unix seconds, now + ttl) is added to the payload. */
export async function mintSignedToken(
  opts: MintSignedTokenOptions,
): Promise<string> {
  if (!Number.isFinite(opts.ttlSeconds)) {
    throw new TypeError("mintSignedToken: ttlSeconds must be a finite number");
  }
  const exp = Math.floor(Date.now() / 1000) + opts.ttlSeconds;
  const body = toBase64Url(utf8(JSON.stringify({ ...opts.payload, exp })));
  const key = await importHmacKey(opts.secret);
  const mac = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    utf8(body) as BufferSource,
  );
  return `${body}.${toBase64Url(new Uint8Array(mac))}`;
}

export interface ReadSignedTokenOptions {
  secret: string | Uint8Array;
  token: string;
}

/**
 * Verify and decode a signed token. Throws on malformed input, a bad MAC, or
 * an expired `exp` — callers only ever see payloads that passed all checks.
 *
 * The MAC check runs before the payload is even parsed, and goes through
 * `crypto.subtle.verify`, whose comparison is constant-time — no early-return
 * byte comparison in JS that an attacker could time.
 */
export async function readSignedToken<T>(
  opts: ReadSignedTokenOptions,
): Promise<T> {
  const segments = opts.token.split(".");
  if (segments.length !== 2) {
    throw new Error("Malformed signed token: expected 2 segments");
  }
  const [body, macSegment] = segments;
  if (body === undefined || macSegment === undefined || body === "" || macSegment === "") {
    throw new Error("Malformed signed token: empty segment");
  }

  let mac: Uint8Array;
  try {
    mac = fromBase64Url(macSegment);
  } catch (cause) {
    throw new Error("Malformed signed token: signature is not base64url", {
      cause,
    });
  }
  const key = await importHmacKey(opts.secret);
  const valid = await globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    mac as BufferSource,
    utf8(body) as BufferSource,
  );
  if (!valid) {
    throw new Error("Signed token verification failed");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch (cause) {
    throw new Error("Malformed signed token: payload is not base64url JSON", {
      cause,
    });
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Malformed signed token: payload must be a JSON object");
  }
  const exp = (payload as Record<string, unknown>)["exp"];
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new Error("Malformed signed token: missing exp");
  }
  // RFC 7519 semantics: not acceptable on or after exp.
  if (Math.floor(Date.now() / 1000) >= exp) {
    throw new Error("Signed token has expired");
  }
  return payload as T;
}
