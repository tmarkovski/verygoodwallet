/**
 * OID4VP (OpenID for Verifiable Presentations 1.0) message types for the
 * unsigned-request + `direct_post` profile this demo speaks, plus the DCQL
 * query subset the shop verifier uses.
 *
 * Like oid4vci.ts, these types are the pinned wire contract between the
 * verifier Workers and the wallet: both sides import them from here so drift
 * is a type error, not a runtime surprise.
 *
 * Profile notes (kept deliberately narrow):
 * - Requests are *unsigned* and passed by value in the wallet link's query
 *   string (OID4VP allows this; a signed Request Object JWT adds nothing
 *   when the wallet already fetched the link from the verifier's origin).
 * - `client_id` uses the `redirect_uri:` prefix, which for
 *   `response_mode=direct_post` names the Response URI. The wallet enforces
 *   that the prefix payload equals `response_uri` — one server, one identity.
 * - The VP's Data Integrity proof binds `challenge = nonce` and
 *   `domain = client_id`, so a captured response cannot be replayed against
 *   another session or another verifier.
 */

import type { Oid4vciErrorResponse } from "./oid4vci.js";

/** OAuth error body shape shared by OID4VCI and OID4VP endpoints. */
export type OauthErrorResponse = Oid4vciErrorResponse;

/** The `client_id` prefix for unsigned requests identified by their response URI. */
export const REDIRECT_URI_CLIENT_ID_PREFIX = "redirect_uri:";

// ---------------------------------------------------------------------------
// DCQL (Digital Credentials Query Language) — the subset used by this demo
// ---------------------------------------------------------------------------

/**
 * One claim the verifier asks for. `path` addresses into the credential JSON
 * (strings for object keys, non-negative integers for array indices).
 */
export interface DcqlClaimQuery {
  /** Referenced from {@link DcqlCredentialQuery.claim_sets}; required when claim_sets are used. */
  id?: string;
  path: (string | number)[];
  /**
   * When present, the claim only matches if its current value is one of
   * these. Omit to request disclosure of whatever the value is — for an age
   * flag, omitting lets the wallet disclose `false` and the verifier deny,
   * instead of pushing the wallet toward disclosing something else.
   */
  values?: (string | number | boolean)[];
}

/**
 * VGW extension to a credential query: the verifier also accepts a ZK age
 * predicate proven against the credential's Poseidon `birthDateCommitment`
 * (the tier-2 path). Standard DCQL cannot express predicates — `values`
 * filters only match disclosed values — so this rides alongside as a
 * vendor-prefixed member, which OID4VP-compliant consumers ignore.
 */
export interface DcqlZkAgePredicate {
  predicate: "age_over";
  /** The age threshold; the wallet derives the day cutoff at proving time. */
  years: number;
  /** Which claim id in `claims` addresses the commitment the proof opens. */
  claim_id: string;
}

/** One credential the verifier asks for, with the claims it wants from it. */
export interface DcqlCredentialQuery {
  /** Key for this query's presentations in the `vp_token` map. */
  id: string;
  /** This demo's wallet stores W3C VCs with Data Integrity proofs only. */
  format: "ldp_vc";
  /** A credential matches if its `type` array contains ALL of ANY inner array. */
  meta?: { type_values?: string[][] };
  claims?: DcqlClaimQuery[];
  /**
   * Alternatives over claim ids, in the verifier's order of preference; the
   * wallet satisfies the first set it can. Lets the shop prefer the
   * `age_over_18` flag but accept `birth_date` from credentials issued
   * before the flags existed.
   */
  claim_sets?: string[][];
  /** See {@link DcqlZkAgePredicate}. */
  vgw_zk?: DcqlZkAgePredicate;
}

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
}

// ---------------------------------------------------------------------------
// Authorization request / response
// ---------------------------------------------------------------------------

/**
 * The unsigned OID4VP authorization request, as carried (parameter by
 * parameter) in the wallet link's query string.
 */
export interface PresentationRequest {
  response_type: "vp_token";
  response_mode: "direct_post";
  /** `redirect_uri:<response_uri>` — see the profile notes above. */
  client_id: string;
  /** Where the wallet POSTs the response (form-encoded, on the verifier Worker). */
  response_uri: string;
  /** Verifier freshness value; the wallet echoes it as the VP proof's `challenge`. */
  nonce: string;
  /** Opaque verifier session reference, echoed verbatim in the response. */
  state: string;
  dcql_query: DcqlQuery;
  /** Display hints for the wallet's consent screen. */
  client_metadata?: { client_name?: string; logo_uri?: string };
}

/**
 * `vp_token` as posted back: one entry per satisfied credential query id,
 * each an array of enveloped presentations (this demo sends exactly one
 * ldp_vp JSON object per query).
 */
export type VpTokenMap = Record<string, object[]>;

/** JSON body a verifier returns from a successful `direct_post`. */
export interface DirectPostResult {
  /**
   * Where the wallet should send the user afterwards (the verifier's result
   * page). Optional in OID4VP; this demo's verifiers always return it so the
   * same-device flow completes visibly.
   */
  redirect_uri?: string;
}

// ---------------------------------------------------------------------------
// Wallet-link codec
// ---------------------------------------------------------------------------

/**
 * Serialize a presentation request into authorization-request query
 * parameters (`dcql_query`/`client_metadata` as JSON values, per OID4VP).
 */
export function presentationRequestToParams(
  request: PresentationRequest,
): URLSearchParams {
  const params = new URLSearchParams({
    response_type: request.response_type,
    response_mode: request.response_mode,
    client_id: request.client_id,
    response_uri: request.response_uri,
    nonce: request.nonce,
    state: request.state,
    dcql_query: JSON.stringify(request.dcql_query),
  });
  if (request.client_metadata !== undefined) {
    params.set("client_metadata", JSON.stringify(request.client_metadata));
  }
  return params;
}

/**
 * Parse and validate authorization-request query parameters. Throws a
 * descriptive error on anything malformed — this is the wallet's validation
 * gate for verifier-controlled input, so it fails closed and names exactly
 * what didn't check out.
 */
export function presentationRequestFromParams(
  params: URLSearchParams,
): PresentationRequest {
  const require = (name: string): string => {
    const value = params.get(name);
    if (value === null || value === "") {
      throw new Error(`The presentation request is missing ${name}`);
    }
    return value;
  };

  const responseType = require("response_type");
  if (responseType !== "vp_token") {
    throw new Error(
      `Unsupported response_type "${responseType}" — this wallet only answers vp_token requests`,
    );
  }
  const responseMode = require("response_mode");
  if (responseMode !== "direct_post") {
    throw new Error(
      `Unsupported response_mode "${responseMode}" — this wallet only supports direct_post`,
    );
  }

  const responseUri = require("response_uri");
  let parsedResponseUri: URL;
  try {
    parsedResponseUri = new URL(responseUri);
  } catch {
    throw new Error(`The presentation request's response_uri is not a valid URL: ${responseUri}`);
  }
  if (parsedResponseUri.protocol !== "https:" && parsedResponseUri.protocol !== "http:") {
    throw new Error(
      `The presentation request's response_uri must be http(s), got ${parsedResponseUri.protocol}`,
    );
  }

  const clientId = require("client_id");
  if (clientId !== `${REDIRECT_URI_CLIENT_ID_PREFIX}${responseUri}`) {
    throw new Error(
      "The presentation request's client_id does not match its response_uri — " +
        `expected "${REDIRECT_URI_CLIENT_ID_PREFIX}${responseUri}"`,
    );
  }

  const nonce = require("nonce");
  const state = require("state");

  let dcqlParsed: unknown;
  try {
    dcqlParsed = JSON.parse(require("dcql_query"));
  } catch {
    throw new Error("The presentation request's dcql_query is not valid JSON");
  }
  const dcqlQuery = assertDcqlQuery(dcqlParsed);

  let clientMetadata: PresentationRequest["client_metadata"];
  const rawMetadata = params.get("client_metadata");
  if (rawMetadata !== null && rawMetadata !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMetadata);
    } catch {
      throw new Error("The presentation request's client_metadata is not valid JSON");
    }
    if (!isRecord(parsed)) {
      throw new Error("The presentation request's client_metadata is not a JSON object");
    }
    clientMetadata = {
      ...(typeof parsed["client_name"] === "string" && parsed["client_name"] !== ""
        ? { client_name: parsed["client_name"] }
        : {}),
      ...(typeof parsed["logo_uri"] === "string" && parsed["logo_uri"] !== ""
        ? { logo_uri: parsed["logo_uri"] }
        : {}),
    };
  }

  return {
    response_type: "vp_token",
    response_mode: "direct_post",
    client_id: clientId,
    response_uri: responseUri,
    nonce,
    state,
    dcql_query: dcqlQuery,
    ...(clientMetadata !== undefined ? { client_metadata: clientMetadata } : {}),
  };
}

/**
 * Build the wallet deep link for a presentation: the wallet's `/present`
 * route reads the authorization request from its search params.
 */
export function walletPresentLink(
  walletOrigin: string,
  request: PresentationRequest,
): string {
  return `${walletOrigin}/present?${presentationRequestToParams(request).toString()}`;
}

// ---------------------------------------------------------------------------
// DCQL shape validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClaimPathSegment(value: unknown): value is string | number {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

function isClaimValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  );
}

/** Validate an untrusted DCQL query document (throws on the first problem). */
export function assertDcqlQuery(value: unknown): DcqlQuery {
  if (!isRecord(value) || !Array.isArray(value["credentials"])) {
    throw new Error("dcql_query must be an object with a credentials array");
  }
  if (value["credentials"].length === 0) {
    throw new Error("dcql_query lists no credential queries");
  }
  for (const entry of value["credentials"]) {
    if (!isRecord(entry)) {
      throw new Error("dcql_query.credentials entries must be objects");
    }
    if (typeof entry["id"] !== "string" || entry["id"] === "") {
      throw new Error("Every dcql_query credential query needs a non-empty id");
    }
    const id = entry["id"];
    if (entry["format"] !== "ldp_vc") {
      throw new Error(
        `Credential query "${id}" has unsupported format "${String(entry["format"])}" — only ldp_vc is supported`,
      );
    }
    const meta = entry["meta"];
    if (meta !== undefined) {
      if (!isRecord(meta)) {
        throw new Error(`Credential query "${id}" has a non-object meta`);
      }
      const typeValues = meta["type_values"];
      if (
        typeValues !== undefined &&
        !(
          Array.isArray(typeValues) &&
          typeValues.every(
            (inner) =>
              Array.isArray(inner) &&
              inner.length > 0 &&
              inner.every((t) => typeof t === "string"),
          )
        )
      ) {
        throw new Error(
          `Credential query "${id}" has a malformed meta.type_values (expected string[][])`,
        );
      }
    }
    const claims = entry["claims"];
    const claimIds = new Set<string>();
    if (claims !== undefined) {
      if (!Array.isArray(claims) || claims.length === 0) {
        throw new Error(`Credential query "${id}" has an empty or non-array claims`);
      }
      for (const claim of claims) {
        if (!isRecord(claim)) {
          throw new Error(`Credential query "${id}" has a non-object claim entry`);
        }
        const path = claim["path"];
        if (!Array.isArray(path) || path.length === 0 || !path.every(isClaimPathSegment)) {
          throw new Error(
            `Credential query "${id}" has a claim without a valid path (string/index segments)`,
          );
        }
        if (claim["id"] !== undefined) {
          if (typeof claim["id"] !== "string" || claim["id"] === "") {
            throw new Error(`Credential query "${id}" has a claim with a non-string id`);
          }
          claimIds.add(claim["id"]);
        }
        const values = claim["values"];
        if (values !== undefined && !(Array.isArray(values) && values.every(isClaimValue))) {
          throw new Error(
            `Credential query "${id}" has a claim with malformed values (expected scalars)`,
          );
        }
      }
    }
    const zk = entry["vgw_zk"];
    if (zk !== undefined) {
      if (!isRecord(zk)) {
        throw new Error(`Credential query "${id}" has a non-object vgw_zk`);
      }
      if (zk["predicate"] !== "age_over") {
        throw new Error(
          `Credential query "${id}" has unsupported vgw_zk.predicate "${String(zk["predicate"])}" — only age_over is supported`,
        );
      }
      const years = zk["years"];
      if (typeof years !== "number" || !Number.isInteger(years) || years <= 0 || years > 150) {
        throw new Error(
          `Credential query "${id}" has a vgw_zk.years that is not a positive integer`,
        );
      }
      const claimId = zk["claim_id"];
      if (typeof claimId !== "string" || !claimIds.has(claimId)) {
        throw new Error(
          `Credential query "${id}" vgw_zk.claim_id references unknown claim id "${String(claimId)}"`,
        );
      }
    }
    const claimSets = entry["claim_sets"];
    if (claimSets !== undefined) {
      if (claims === undefined) {
        throw new Error(`Credential query "${id}" has claim_sets but no claims`);
      }
      if (
        !Array.isArray(claimSets) ||
        claimSets.length === 0 ||
        !claimSets.every(
          (set) =>
            Array.isArray(set) && set.length > 0 && set.every((ref) => typeof ref === "string"),
        )
      ) {
        throw new Error(`Credential query "${id}" has a malformed claim_sets (expected string[][])`);
      }
      for (const set of claimSets as string[][]) {
        for (const ref of set) {
          if (!claimIds.has(ref)) {
            throw new Error(
              `Credential query "${id}" claim_sets references unknown claim id "${ref}"`,
            );
          }
        }
      }
    }
  }
  return value as unknown as DcqlQuery;
}
