/**
 * Internal unpadded base64url codec (RFC 4648 §5) — deliberately
 * dependency-free (vc-kit does not depend on @vgw/keys; adding a
 * hashing/encoding package for two ten-line helpers would be worse).
 * Shared by the params and revocation facades; NOT part of the public
 * barrel — apps encode through @vgw/keys as before.
 */

const B64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64URL_LOOKUP: ReadonlyMap<string, number> = new Map(
  [...B64URL_ALPHABET].map((char, index) => [char, index]),
);

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
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

export function base64UrlToBytes(s: string): Uint8Array {
  if (s.length % 4 === 1) {
    throw new Error('Invalid base64url string: bad length');
  }
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let index = 0;
  for (const char of s) {
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
