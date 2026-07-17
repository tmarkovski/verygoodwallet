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
 * - Requests are *unsigned*. The wallet link normally carries only a
 *   `request_uri` naming the verifier's per-session request endpoint — a
 *   by-value link is ~1,600 characters, which forces a QR too dense for
 *   phone cameras. The referenced endpoint serves the authorization request
 *   as plain JSON (this profile's unsigned analogue of OID4VP's Request
 *   Object by reference; a signed JWT adds nothing when the wallet fetches
 *   the request straight from the verifier's origin). Passing the whole
 *   request by value in the query string remains supported.
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

/** The wallet-link search param naming a request passed by reference. */
export const REQUEST_URI_PARAM = "request_uri";

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
 * One range claim over a HIDDEN numeric twin (MIGRATION Appendix D.1). The
 * wallet answers with a credkit CCS range proof: the verifier learns only
 * that the twin satisfies `kind`/`bound` — never the value.
 */
export interface DcqlRangePredicate {
  /** DCQL path of the claim whose declared twin the proof is about. */
  path: (string | number)[];
  kind: "greaterOrEqual" | "lessOrEqual";
  /**
   * Inclusive bound in the twin's declared encoder units (`date1900` days,
   * `uint64`), as a decimal STRING — bigint-safe for uint64 values that
   * exceed Number.MAX_SAFE_INTEGER.
   */
  bound: string;
  /** Digit count of the base-`params` decomposition (`base^digits` must cover the honest range). */
  digits: number;
  /** base64url SHA-256 of this verifier's published range-params octets (D.3). */
  params_hash: string;
}

/**
 * One set-membership claim over a hidden twin — reserved N5 shape, typed and
 * validated now, rejected by the wallet until membership params ship.
 */
export interface DcqlMembershipPredicate {
  path: (string | number)[];
  /** Which published set (under `sets` in the params document) the proof is against. */
  set_id: string;
  params_hash: string;
}

/**
 * VGW extension to a credential query: claims proven about HIDDEN numeric
 * twins via credkit CCS proofs (the predicate route). Standard DCQL cannot
 * express predicates — `values` filters only match disclosed values — so this
 * rides alongside as a vendor-prefixed member, which OID4VP-compliant
 * consumers ignore (MIGRATION §7, Appendix D.1). Replaces the retired
 * `vgw_zk` Poseidon-commitment extension at N3.
 */
export interface DcqlPredicates {
  /**
   * Where THIS verifier publishes its proof alphabets
   * ({@link CREDKIT_PARAMS_PATH}). The wallet enforces same-origin with
   * `response_uri` and fetches the same public artifact every other holder
   * fetches — the anti-tag discipline of MIGRATION §8.
   */
  params_uri: string;
  /** Range claims, in presentation order (the proof restates them positionally). */
  range?: DcqlRangePredicate[];
  /** Reserved for N5 set-membership; the wallet rejects requests carrying it. */
  membership?: DcqlMembershipPredicate[];
  /**
   * Claim ids from `claims` that MUST be disclosed alongside the predicate
   * route — the old tier-2 claim_set made explicit. Absent/empty = the
   * predicate route discloses nothing beyond the issuer's mandatory pointers.
   */
  claim_set?: string[];
}

/**
 * One side of a cross-credential equality (reserved N5 shape): a query id
 * plus either the statement's link secret or a declared twin pointer.
 */
export type DcqlEqualityRef =
  | { query: string; link_secret: true }
  | { query: string; path: (string | number)[] };

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
  /** See {@link DcqlPredicates}. */
  vgw_predicates?: DcqlPredicates;
}

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
  /**
   * Cross-credential witness equalities over query ids — each inner array
   * demands its referenced hidden slots hold the SAME value (the link-secret
   * linkage lives here). Reserved N5 shape, typed and validated now; the
   * wallet rejects requests carrying it until then (MIGRATION Appendix D.1).
   */
  vgw_equalities?: DcqlEqualityRef[][];
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
 * Parse and validate a presentation request delivered as a JSON document (the
 * by-reference route). Funnels through {@link presentationRequestFromParams}
 * — string members ride as-is, structured members (`dcql_query`,
 * `client_metadata`) as their JSON, exactly the by-value wire form — so both
 * delivery routes pass ONE validation gate.
 */
export function presentationRequestFromJson(value: unknown): PresentationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The presentation request must be a JSON object");
  }
  const params = new URLSearchParams();
  for (const [name, member] of Object.entries(value)) {
    if (member === undefined || member === null) continue;
    params.set(name, typeof member === "string" ? member : JSON.stringify(member));
  }
  return presentationRequestFromParams(params);
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

/**
 * Build the wallet deep link for a presentation passed by reference: the
 * wallet's `/present` route fetches the authorization request from
 * `requestUri` (the verifier's per-session request endpoint). This is the
 * form QR codes carry — short enough to scan.
 */
export function walletPresentLinkByReference(
  walletOrigin: string,
  requestUri: string,
): string {
  return `${walletOrigin}/present?${REQUEST_URI_PARAM}=${encodeURIComponent(requestUri)}`;
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
    const predicates = entry["vgw_predicates"];
    if (predicates !== undefined) {
      assertDcqlPredicates(predicates, id, claimIds);
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
  const equalities = value["vgw_equalities"];
  if (equalities !== undefined) {
    const queryIds = new Set(
      (value["credentials"] as Record<string, unknown>[]).map((entry) => String(entry["id"])),
    );
    assertDcqlEqualities(equalities, queryIds);
  }
  return value as unknown as DcqlQuery;
}

/**
 * Inclusive predicate bound: a canonical decimal integer string (no sign, no
 * leading zeros) — bigint-safe for uint64 twins whose values exceed
 * Number.MAX_SAFE_INTEGER.
 */
const BOUND_PATTERN = /^(0|[1-9][0-9]*)$/;

/** `base^digits ≤ 2^64` caps useful digit counts well below this. */
const MAX_PREDICATE_DIGITS = 16;

function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" || url.protocol === "http:";
}

function assertPredicatePath(
  path: unknown,
  id: string,
  member: string,
): asserts path is (string | number)[] {
  if (!Array.isArray(path) || path.length === 0 || !path.every(isClaimPathSegment)) {
    throw new Error(
      `Credential query "${id}" has a vgw_predicates.${member} entry without a valid path (string/index segments)`,
    );
  }
}

/** Validate one query's `vgw_predicates` object (throws on the first problem). */
function assertDcqlPredicates(
  value: unknown,
  id: string,
  claimIds: ReadonlySet<string>,
): void {
  if (!isRecord(value)) {
    throw new Error(`Credential query "${id}" has a non-object vgw_predicates`);
  }
  if (!isAbsoluteHttpUrl(value["params_uri"])) {
    throw new Error(
      `Credential query "${id}" has a vgw_predicates.params_uri that is not an absolute http(s) URL`,
    );
  }

  const range = value["range"];
  if (range !== undefined) {
    if (!Array.isArray(range)) {
      throw new Error(`Credential query "${id}" has a non-array vgw_predicates.range`);
    }
    for (const claim of range) {
      if (!isRecord(claim)) {
        throw new Error(`Credential query "${id}" has a non-object vgw_predicates.range entry`);
      }
      assertPredicatePath(claim["path"], id, "range");
      const kind = claim["kind"];
      if (kind !== "greaterOrEqual" && kind !== "lessOrEqual") {
        throw new Error(
          `Credential query "${id}" has an unsupported vgw_predicates.range kind "${String(kind)}"`,
        );
      }
      const bound = claim["bound"];
      if (typeof bound !== "string" || !BOUND_PATTERN.test(bound)) {
        throw new Error(
          `Credential query "${id}" has a vgw_predicates.range bound that is not a decimal integer string`,
        );
      }
      const digits = claim["digits"];
      if (
        typeof digits !== "number" ||
        !Number.isInteger(digits) ||
        digits < 1 ||
        digits > MAX_PREDICATE_DIGITS
      ) {
        throw new Error(
          `Credential query "${id}" has a vgw_predicates.range digits outside 1..${MAX_PREDICATE_DIGITS}`,
        );
      }
      if (typeof claim["params_hash"] !== "string" || claim["params_hash"] === "") {
        throw new Error(
          `Credential query "${id}" has a vgw_predicates.range entry without a params_hash`,
        );
      }
    }
  }

  const membership = value["membership"];
  if (membership !== undefined) {
    if (!Array.isArray(membership)) {
      throw new Error(`Credential query "${id}" has a non-array vgw_predicates.membership`);
    }
    for (const claim of membership) {
      if (!isRecord(claim)) {
        throw new Error(
          `Credential query "${id}" has a non-object vgw_predicates.membership entry`,
        );
      }
      assertPredicatePath(claim["path"], id, "membership");
      if (typeof claim["set_id"] !== "string" || claim["set_id"] === "") {
        throw new Error(
          `Credential query "${id}" has a vgw_predicates.membership entry without a set_id`,
        );
      }
      if (typeof claim["params_hash"] !== "string" || claim["params_hash"] === "") {
        throw new Error(
          `Credential query "${id}" has a vgw_predicates.membership entry without a params_hash`,
        );
      }
    }
  }

  // A vgw_predicates object that demands no proof is malformed, not vacuous.
  const rangeCount = Array.isArray(range) ? range.length : 0;
  const membershipCount = Array.isArray(membership) ? membership.length : 0;
  if (rangeCount === 0 && membershipCount === 0) {
    throw new Error(
      `Credential query "${id}" has a vgw_predicates with neither range nor membership claims`,
    );
  }

  const claimSet = value["claim_set"];
  if (claimSet !== undefined) {
    if (!Array.isArray(claimSet) || !claimSet.every((ref) => typeof ref === "string")) {
      throw new Error(
        `Credential query "${id}" has a malformed vgw_predicates.claim_set (expected string[])`,
      );
    }
    for (const ref of claimSet as string[]) {
      if (!claimIds.has(ref)) {
        throw new Error(
          `Credential query "${id}" vgw_predicates.claim_set references unknown claim id "${ref}"`,
        );
      }
    }
  }
}

/** Validate the top-level `vgw_equalities` array (throws on the first problem). */
function assertDcqlEqualities(value: unknown, queryIds: ReadonlySet<string>): void {
  if (!Array.isArray(value)) {
    throw new Error("dcql_query.vgw_equalities must be an array of equality groups");
  }
  for (const equality of value) {
    if (!Array.isArray(equality) || equality.length < 2) {
      throw new Error(
        "dcql_query.vgw_equalities groups need at least two references each",
      );
    }
    for (const ref of equality) {
      if (!isRecord(ref)) {
        throw new Error("dcql_query.vgw_equalities references must be objects");
      }
      const query = ref["query"];
      if (typeof query !== "string" || !queryIds.has(query)) {
        throw new Error(
          `dcql_query.vgw_equalities references unknown credential query "${String(query)}"`,
        );
      }
      const hasLinkSecret = ref["link_secret"] !== undefined;
      const hasPath = ref["path"] !== undefined;
      if (hasLinkSecret === hasPath) {
        throw new Error(
          "dcql_query.vgw_equalities references need exactly one of link_secret or path",
        );
      }
      if (hasLinkSecret && ref["link_secret"] !== true) {
        throw new Error("dcql_query.vgw_equalities link_secret must be exactly true");
      }
      if (hasPath) {
        const path = ref["path"];
        if (!Array.isArray(path) || path.length === 0 || !path.every(isClaimPathSegment)) {
          throw new Error(
            "dcql_query.vgw_equalities has a reference without a valid path (string/index segments)",
          );
        }
      }
    }
  }
}
