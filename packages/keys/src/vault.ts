/**
 * Authenticated JSON encryption for wallet state at rest (IndexedDB).
 *
 * Wire format: `base64url(iv || ciphertext)` where `iv` is a random 12-byte
 * AES-GCM nonce and `ciphertext` includes the GCM authentication tag. Any
 * tampering with the payload makes decryption throw.
 */

import { fromBase64Url, toBase64Url, utf8 } from "./encoding.js";

const IV_LENGTH = 12;
/** AES-GCM appends a 16-byte authentication tag to the ciphertext. */
const GCM_TAG_LENGTH = 16;

/**
 * Encrypt a JSON-serializable value under the vault key.
 * Returns `base64url(iv || ciphertext)` with a fresh random 12-byte IV.
 */
export async function encryptJson(
  key: CryptoKey,
  value: unknown,
): Promise<string> {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError(
      "encryptJson: value is not JSON-serializable (JSON.stringify returned undefined)",
    );
  }
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      utf8(json) as BufferSource,
    ),
  );
  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);
  return toBase64Url(payload);
}

/**
 * Decrypt a payload produced by {@link encryptJson}.
 * Throws if the payload was tampered with or the key is wrong.
 */
export async function decryptJson<T = unknown>(
  key: CryptoKey,
  payload: string,
): Promise<T> {
  const bytes = fromBase64Url(payload);
  if (bytes.length < IV_LENGTH + GCM_TAG_LENGTH) {
    throw new Error("decryptJson: payload too short to be a valid vault record");
  }
  const iv = bytes.subarray(0, IV_LENGTH);
  const ciphertext = bytes.subarray(IV_LENGTH);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
