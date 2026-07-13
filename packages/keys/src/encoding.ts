/**
 * Byte/string encoding helpers.
 *
 * Runtime-agnostic: no Node built-ins, no `Buffer`, no `btoa`/`atob` — works
 * identically in browsers and Node 22+.
 */

const B64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const B64URL_LOOKUP: ReadonlyMap<string, number> = new Map(
  [...B64URL_ALPHABET].map((char, index) => [char, index]),
);

/** Encode bytes as unpadded base64url (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Decode unpadded base64url (trailing `=` padding is tolerated). Throws on invalid input. */
export function fromBase64Url(s: string): Uint8Array {
  const input = s.replace(/=+$/, "");
  if (input.length % 4 === 1) {
    throw new Error("Invalid base64url string: bad length");
  }
  const out = new Uint8Array(Math.floor((input.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let index = 0;
  for (const char of input) {
    const value = B64URL_LOOKUP.get(char);
    if (value === undefined) {
      throw new Error(`Invalid base64url character: ${JSON.stringify(char)}`);
    }
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Encode bytes as lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** Decode a hex string (case-insensitive, optional `0x` prefix). Throws on invalid input. */
export function fromHex(s: string): Uint8Array {
  const input = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
  if (input.length % 2 !== 0) {
    throw new Error("Invalid hex string: odd length");
  }
  const out = new Uint8Array(input.length / 2);
  for (let i = 0; i < out.length; i++) {
    const pair = input.slice(i * 2, i * 2 + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
      throw new Error(`Invalid hex string: bad characters ${JSON.stringify(pair)}`);
    }
    out[i] = Number.parseInt(pair, 16);
  }
  return out;
}

/** UTF-8 encode a string. */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
