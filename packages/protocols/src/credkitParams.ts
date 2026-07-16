/**
 * The published proof-alphabet document (MIGRATION §8, Appendix D.3): each
 * verifier serves ONE JSON document at a well-known path, holding the range
 * (and, at N5, set) parameters every prover must consume verbatim.
 *
 * Why published at all: credkit's `createRangeParams` is randomized, so the
 * alphabet is not reproducible — a prover that regenerated locally would fail
 * the verifier's `paramsHash` check on every proof. And a verifier that
 * handed each prover a DIFFERENT well-formed alphabet would hold an
 * undetectable per-prover tag; one public artifact, fetched by holder and
 * verifier alike, is the anti-tag discipline.
 *
 * Like its siblings, this module is the pinned wire contract between the
 * verifier Workers and the wallet — types + a fail-closed validator, no
 * crypto (the octet decode, hash pinning, and pairing checks live in
 * @vgw/vc-kit, per the §7 protocols charter).
 */

/** Well-known path where a verifier publishes its proof alphabets. */
export const CREDKIT_PARAMS_PATH = "/.well-known/credkit-params";

/** The published document (one per verifier; GET, CORS-open). */
export interface CredkitParamsDocument {
  version: 1;
  /** The credkit cryptosuite the alphabet belongs to (VGW pins sha-2026). */
  suite: string;
  /** Range-proof alphabet: `params` = base64url `rangeParamsToOctets`, `hash` = base64url SHA-256 of those octets. */
  range?: { base: number; params: string; hash: string };
  // N5: sets?: Record<string, { params: string; hash: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unpadded base64url — the only alphabet params/hash values may use. */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** credkit range params accept bases in [2, 65536]. */
const MIN_RANGE_BASE = 2;
const MAX_RANGE_BASE = 65536;

/**
 * Validate an untrusted params document (throws on the first problem). This
 * is the wallet's shape gate for verifier-controlled input — it fails closed
 * and names exactly what didn't check out. It deliberately does NOT verify
 * the alphabet itself: hash pinning and the pairing check
 * (`verifyRangeParams`) are the caller's next steps, via @vgw/vc-kit.
 */
export function assertCredkitParamsDocument(value: unknown): CredkitParamsDocument {
  if (!isRecord(value)) {
    throw new Error("The credkit params document is not a JSON object");
  }
  if (value["version"] !== 1) {
    throw new Error(
      `The credkit params document has unsupported version ${JSON.stringify(value["version"])} — only version 1 is supported`,
    );
  }
  if (typeof value["suite"] !== "string" || value["suite"] === "") {
    throw new Error("The credkit params document names no cryptosuite");
  }
  const range = value["range"];
  if (range !== undefined) {
    if (!isRecord(range)) {
      throw new Error("The credkit params document has a non-object range");
    }
    const base = range["base"];
    if (
      typeof base !== "number" ||
      !Number.isInteger(base) ||
      base < MIN_RANGE_BASE ||
      base > MAX_RANGE_BASE
    ) {
      throw new Error(
        `The credkit params document's range.base must be an integer in [${MIN_RANGE_BASE}, ${MAX_RANGE_BASE}]`,
      );
    }
    const params = range["params"];
    if (typeof params !== "string" || params === "" || !BASE64URL_PATTERN.test(params)) {
      throw new Error(
        "The credkit params document's range.params is not a base64url string",
      );
    }
    const hash = range["hash"];
    if (typeof hash !== "string" || hash === "" || !BASE64URL_PATTERN.test(hash)) {
      throw new Error(
        "The credkit params document's range.hash is not a base64url string",
      );
    }
  }
  return value as unknown as CredkitParamsDocument;
}
