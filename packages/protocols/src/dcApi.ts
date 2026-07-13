/**
 * Digital Credentials API adapter (`navigator.credentials.get({ digital })`).
 *
 * The DC API is the browser-native way to request credentials from platform
 * wallets. It is deliberately isolated behind this adapter: the spec is
 * pre-Candidate-Recommendation and its protocol strings still churn, and —
 * the demo's actual teaching point — *web* wallets cannot register as DC API
 * providers yet, so a verifier that only spoke DC API would dead-end on this
 * project's own wallet. Verifiers attempt the DC API for the exhibit, then
 * fall back to the OID4VP wallet link.
 *
 * Everything here is feature-detected and non-throwing: the adapter reports
 * a typed outcome and the caller renders the explainer + fallback.
 */

import type { DcqlQuery, PresentationRequest } from "./oid4vp.js";

/** OID4VP-over-DC-API protocol identifier (OpenID4VP 1.0, unsigned requests). */
export const OPENID4VP_DC_API_PROTOCOL = "openid4vp-v1-unsigned";

/** The request payload for one DC API provider entry. */
export interface DcApiRequest {
  protocol: string;
  data: {
    response_type: "vp_token";
    /** Over the DC API the browser is the response channel — no response_uri. */
    response_mode: "dc_api";
    nonce: string;
    dcql_query: DcqlQuery;
  };
}

/** What attempting the DC API produced. */
export type DcApiOutcome =
  | { outcome: "unsupported"; reason: string }
  | { outcome: "declined" }
  | { outcome: "error"; message: string }
  | { outcome: "response"; protocol: string; data: unknown };

/**
 * Map an OID4VP wallet-link request onto its DC API form: same nonce and
 * DCQL query, but the response comes back through the browser instead of a
 * direct_post (so response_uri/state stay out of the request).
 */
export function toDcApiRequest(request: PresentationRequest): DcApiRequest {
  return {
    protocol: OPENID4VP_DC_API_PROTOCOL,
    data: {
      response_type: "vp_token",
      response_mode: "dc_api",
      nonce: request.nonce,
      dcql_query: request.dcql_query,
    },
  };
}

/** True when this browser exposes the Digital Credentials API at all. */
export function isDcApiSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.get === "function" &&
    "DigitalCredential" in globalThis
  );
}

/**
 * Attempt a DC API presentation request. Never throws: unsupported browsers,
 * user cancellation, and provider errors all come back as typed outcomes.
 */
export async function requestDcApiCredential(
  request: PresentationRequest,
  options?: { signal?: AbortSignal },
): Promise<DcApiOutcome> {
  if (!isDcApiSupported()) {
    return {
      outcome: "unsupported",
      reason:
        "This browser does not expose the Digital Credentials API (navigator.credentials.get({ digital })).",
    };
  }
  try {
    // The `digital` member postdates the CredentialRequestOptions typings.
    const credential = await navigator.credentials.get({
      digital: { requests: [toDcApiRequest(request)] },
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    } as CredentialRequestOptions);
    if (credential === null) {
      return { outcome: "declined" };
    }
    const digital = credential as unknown as { protocol?: string; data?: unknown };
    return {
      outcome: "response",
      protocol: typeof digital.protocol === "string" ? digital.protocol : "unknown",
      data: digital.data,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      // Dismissing the platform sheet reports as NotAllowedError.
      return { outcome: "declined" };
    }
    return {
      outcome: "error",
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}
