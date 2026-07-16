/**
 * OID4VCI wallet-side tests against a scripted fake issuer that uses REAL
 * crypto end to end: it verifies the wallet's proof-of-possession JWT with
 * `verifyProofJwt` (aud + nonce + commitment digest checked) before
 * answering, and blind-signs a genuine credkit Utopia DL over the wallet's
 * link-secret commitment — so a green run means the wallet's receipt check
 * exercised an actual blind signature, not fixtures. Only IndexedDB is
 * mocked (in-memory `addCredential` capture).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptJson,
  deriveIssuancePopSeed,
  deriveLinkSecret,
  deriveVaultKey,
  fromBase64Url,
  scalarFromBase64Url,
} from "@vgw/keys";
import {
  CREDENTIAL_CONFIGURATION_ID,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  commitmentDigest,
  ed25519KeyPairFromSeed,
  verifyProofJwt,
  type CredentialOffer,
  type CredentialRequest,
  type CredentialResponse,
  type IssuerMetadata,
  type TokenResponse,
} from "@vgw/protocols";
import {
  UTOPIA_DL_NUMERIC_DECLARATIONS,
  buildUtopiaDriversLicense,
  createHolderBinding,
  generateCredkitBbsKeyPair,
  issueCredkitCredential,
  verifyIssuedCredkitCredential,
  type CredkitBbsKeyPair,
} from "@vgw/vc-kit";
import type { CredentialPayload, NewCredentialRecord } from "./db";
import {
  ISSUANCE_STEPS,
  acceptCredentialOffer,
  isInsecureIssuerOrigin,
  parseOfferParams,
  previewCredentialOffer,
  type IssuanceStep,
} from "./issuance";

const db = vi.hoisted(() => {
  const stored: (NewCredentialRecord & { id: number })[] = [];
  return {
    stored,
    async addCredential(input: NewCredentialRecord) {
      const record = { ...input, id: stored.length + 1 };
      stored.push(record);
      return record;
    },
  };
});

// Replace the real IndexedDB-backed module before issuance.ts imports it.
vi.mock("./db", () => ({ addCredential: db.addCredential }));

const SUBJECT = {
  givenName: "Jamie",
  familyName: "Voss",
  birthDate: "1996-03-14",
  documentNumber: "UDL-TEST-0001",
} as const;

const PRE_AUTH_CODE = "demo-pre-auth-code";
const ACCESS_TOKEN = "demo-access-token";
const C_NONCE = "demo-c-nonce";

interface FakeIssuerConfig {
  origin: string;
  seed: Uint8Array;
  /** Bind the VC to this DID instead of leaving the subject anonymous. */
  subjectIdOverride?: string;
  /**
   * Blind-sign over the issuer's OWN commitment instead of the wallet's —
   * the receipt check must catch a credential not bound to OUR link secret.
   */
  swapCommitment?: boolean;
  /** Make the token endpoint fail with this OAuth error. */
  tokenError?: { status: number; body: Record<string, unknown> };
  /** Transform the served metadata (hostile-display tests). */
  mutateMetadata?: (metadata: IssuerMetadata) => unknown;
  /** Runs as the token endpoint is hit — interleave session actions mid-flight. */
  onTokenRequest?: () => void;
  /** Transform the credential response (malformed-response tests). */
  mutateCredentialResponse?: (response: CredentialResponse) => unknown;
}

interface FakeIssuer {
  origin: string;
  offerUri: string;
  keyPair: CredkitBbsKeyPair;
  handle(request: Request): Promise<Response>;
  captured: {
    grantType: string | null;
    preAuthorizedCode: string | null;
    authorization: string | null;
    configurationId: string | null;
    holderDid: string | null;
    /** The received vgw_holder_commitment (base64url), as the wire carried it. */
    holderCommitment: string | null;
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFakeIssuer(config: FakeIssuerConfig): FakeIssuer {
  const keyPair = generateCredkitBbsKeyPair(config.seed);
  const { origin } = config;

  const offer: CredentialOffer = {
    credential_issuer: origin,
    credential_configuration_ids: [CREDENTIAL_CONFIGURATION_ID],
    grants: {
      [PRE_AUTHORIZED_CODE_GRANT_TYPE]: { "pre-authorized_code": PRE_AUTH_CODE },
    },
  };
  const metadata: IssuerMetadata = {
    credential_issuer: origin,
    credential_endpoint: `${origin}/oid4vci/credential`,
    token_endpoint: `${origin}/oid4vci/token`,
    display: [{ name: "Utopia DMV", locale: "en-US" }],
    credential_configurations_supported: {
      [CREDENTIAL_CONFIGURATION_ID]: {
        format: "ldp_vc",
        credential_definition: {
          "@context": ["https://www.w3.org/ns/credentials/v2"],
          type: ["VerifiableCredential", "Iso18013DriversLicenseCredential"],
        },
        cryptographic_binding_methods_supported: ["did:key"],
        proof_types_supported: {
          jwt: { proof_signing_alg_values_supported: ["EdDSA"] },
        },
        display: [{ name: "Utopia Driver's License" }],
      },
    },
  };

  const captured: FakeIssuer["captured"] = {
    grantType: null,
    preAuthorizedCode: null,
    authorization: null,
    configurationId: null,
    holderDid: null,
    holderCommitment: null,
  };

  const handle = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;

    if (request.method === "GET" && path === "/oid4vci/offer/demo") {
      return json(offer);
    }
    if (request.method === "GET" && path === "/.well-known/openid-credential-issuer") {
      return json(config.mutateMetadata?.(metadata) ?? metadata);
    }
    if (request.method === "POST" && path === "/oid4vci/token") {
      config.onTokenRequest?.();
      if (config.tokenError !== undefined) {
        return json(config.tokenError.body, config.tokenError.status);
      }
      const form = new URLSearchParams(await request.text());
      captured.grantType = form.get("grant_type");
      captured.preAuthorizedCode = form.get("pre-authorized_code");
      const token: TokenResponse = {
        access_token: ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 300,
        c_nonce: C_NONCE,
        c_nonce_expires_in: 300,
      };
      return json(token);
    }
    if (request.method === "POST" && path === "/oid4vci/credential") {
      captured.authorization = request.headers.get("authorization");
      const body = (await request.json()) as CredentialRequest;
      captured.configurationId = body.credential_configuration_id;
      captured.holderCommitment = body.vgw_holder_commitment ?? null;

      // The binding: the wallet's link-secret commitment, as a request
      // extension (never inside the proof slot).
      if (typeof body.vgw_holder_commitment !== "string") {
        return json({ error: "invalid_credential_request" }, 400);
      }
      const holderCommitment = fromBase64Url(body.vgw_holder_commitment);

      // Real PoP verification, exactly like the Worker does it: aud, nonce
      // AND the digest of the commitment received in THIS request are all
      // asserted inside verifyProofJwt (throws on any mismatch).
      const verified = verifyProofJwt({
        jwt: body.proof.jwt,
        audience: origin,
        nonce: C_NONCE,
        expectedCommitmentDigest: await commitmentDigest(holderCommitment),
      });
      captured.holderDid = verified.holderDid;

      // Like the real DMV: no subjectId by default (unlinkability — node ids
      // are structurally revealed by every derived proof), no
      // birthDateCommitment (age predicates prove against the hidden
      // date1900 twin), blind signature over the wallet's commitment.
      const unsigned = buildUtopiaDriversLicense({
        ...(config.subjectIdOverride !== undefined
          ? { subjectId: config.subjectIdOverride }
          : {}),
        ...SUBJECT,
        issuer: { id: keyPair.controller, name: "Utopia DMV" },
      });
      const signed = await issueCredkitCredential({
        credential: unsigned,
        keyPair,
        numericDeclarations: UTOPIA_DL_NUMERIC_DECLARATIONS,
        holderCommitment: config.swapCommitment
          ? createHolderBinding().commitmentWithProof
          : holderCommitment,
      });
      const response: CredentialResponse = {
        credentials: [{ credential: signed as Record<string, unknown> }],
      };
      return json(config.mutateCredentialResponse?.(response) ?? response);
    }
    return json({ error: "not_found" }, 404);
  };

  return { origin, offerUri: `${origin}/oid4vci/offer/demo`, keyPair, handle, captured };
}

/** Route global fetch by origin to the given fake issuers. */
function routeFetchTo(...issuers: FakeIssuer[]): void {
  const byOrigin = new Map(issuers.map((issuer) => [issuer.origin, issuer]));
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(
        input instanceof Request ? input : String(input),
        init,
      );
      const issuer = byOrigin.get(new URL(request.url).origin);
      if (issuer === undefined) {
        throw new TypeError(`No fake issuer registered for ${request.url}`);
      }
      return issuer.handle(request);
    },
  );
}

describe("acceptCredentialOffer", () => {
  let masterSecret: Uint8Array;
  let vaultKey: CryptoKey;

  beforeAll(async () => {
    masterSecret = crypto.getRandomValues(new Uint8Array(32));
    vaultKey = await deriveVaultKey(masterSecret);
  });

  beforeEach(() => {
    db.stored.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs the full blind-issuance flow and stores the v3 envelope", async () => {
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
    });
    routeFetchTo(issuer);

    const steps: IssuanceStep[] = [];
    const record = await acceptCredentialOffer({
      offerUri: issuer.offerUri,
      accountId: 7,
      masterSecret,
      vaultKey,
      onStep: (step) => steps.push(step),
    });

    expect(steps).toEqual(ISSUANCE_STEPS.map((s) => s.id));
    expect(issuer.captured.grantType).toBe(PRE_AUTHORIZED_CODE_GRANT_TYPE);
    expect(issuer.captured.preAuthorizedCode).toBe(PRE_AUTH_CODE);
    expect(issuer.captured.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(issuer.captured.configurationId).toBe(CREDENTIAL_CONFIGURATION_ID);
    // The commitment crossed the wire as base64url (and the fake issuer's
    // digest-checked PoP verification already proved it matched the proof).
    expect(issuer.captured.holderCommitment).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(record.accountId).toBe(7);
    expect(record.meta).toEqual({
      name: "Utopia Driver's License",
      issuerName: "Utopia DMV",
      kind: "Iso18013DriversLicenseCredential",
      colorSeed: "Iso18013DriversLicenseCredential",
    });
    expect(db.stored).toHaveLength(1);

    // The payload must decrypt under the vault key to the versioned v3
    // envelope: the credential plus the scalar-encoded blind, nothing else —
    // the link secret is PRF-derived and never stored.
    const envelope = await decryptJson<CredentialPayload>(vaultKey, record.payload);
    expect(envelope.version).toBe(3);
    expect("commitmentOpening" in envelope).toBe(false);
    expect("linkSecret" in envelope).toBe(false);
    const blind = scalarFromBase64Url(envelope.secretProverBlind);
    expect(blind).toBeGreaterThan(0n);

    // The stored credential carries a credkit proof and no Poseidon handle…
    const proof = envelope.vc.proof as Record<string, unknown>;
    expect(proof["cryptosuite"]).toBe("credkit-bbs-sha-2026");
    const subject = envelope.vc.credentialSubject as Record<string, unknown>;
    const license = subject["driversLicense"] as Record<string, unknown>;
    expect(license["birthDateCommitment"]).toBeUndefined();

    // …and re-running the receipt check from ONLY what survives (the master
    // secret and the stored envelope) proves the vault holds everything
    // needed to use this credential later.
    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: envelope.vc,
        holderBinding: {
          linkSecret: await deriveLinkSecret(masterSecret),
          secretProverBlind: blind,
        },
      }),
    ).resolves.toBe(true);

    // Holder binding lives in the blind-signed commitment; the PoP DID is
    // freshness-only and pairwise. The stored VC itself names no subject.
    const popSeed = await deriveIssuancePopSeed(masterSecret, issuer.origin);
    const holder = ed25519KeyPairFromSeed(popSeed);
    expect(subject["id"]).toBeUndefined();
    expect(issuer.captured.holderDid).toBe(holder.did);
  }, 60_000);

  it("derives a different pairwise PoP DID per issuer origin", async () => {
    const issuerA = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
    });
    const issuerB = makeFakeIssuer({
      origin: "https://insurance.utopia.example",
      seed: new Uint8Array(32).fill(2),
    });
    routeFetchTo(issuerA, issuerB);

    const recordA = await acceptCredentialOffer({
      offerUri: issuerA.offerUri,
      accountId: 1,
      masterSecret,
      vaultKey,
    });

    // Issuer B goes through the preview → accept path the Offer page uses.
    const preview = await previewCredentialOffer({ offerUri: issuerB.offerUri });
    expect(preview.issuerOrigin).toBe(issuerB.origin);
    expect(preview.issuerName).toBe("Utopia DMV");
    expect(preview.credentialName).toBe("Utopia Driver's License");
    const recordB = await acceptCredentialOffer({
      offer: preview.offer,
      metadata: preview.metadata,
      accountId: 1,
      masterSecret,
      vaultKey,
    });

    // Both issuances stored successfully…
    expect(recordA.id).not.toBe(recordB.id);
    // …the pairwise property shows in the PoP DIDs each issuer observed
    // (same master secret, different issuer origin, different DID)…
    expect(typeof issuerA.captured.holderDid).toBe("string");
    expect(typeof issuerB.captured.holderDid).toBe("string");
    expect(issuerA.captured.holderDid).not.toBe(issuerB.captured.holderDid);
    // …while the LINK SECRET is the same one secret at both issuances: both
    // stored credentials pass the receipt check under the single
    // master-derived secret (with their own per-credential blinds).
    const linkSecret = await deriveLinkSecret(masterSecret);
    for (const record of [recordA, recordB]) {
      const envelope = await decryptJson<CredentialPayload>(vaultKey, record.payload);
      await expect(
        verifyIssuedCredkitCredential({
          verifiableCredential: envelope.vc,
          holderBinding: {
            linkSecret,
            secretProverBlind: scalarFromBase64Url(envelope.secretProverBlind),
          },
        }),
      ).resolves.toBe(true);
    }
  }, 90_000);

  it("surfaces token endpoint errors with the endpoint and OAuth detail", async () => {
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      tokenError: {
        status: 400,
        body: { error: "invalid_grant", error_description: "unknown pre-authorized code" },
      },
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(
      /token endpoint.*HTTP 400.*invalid_grant — unknown pre-authorized code/,
    );
    expect(db.stored).toHaveLength(0);
  }, 30_000);

  it("rejects a credential bound to a different subject DID", async () => {
    const stranger = ed25519KeyPairFromSeed(new Uint8Array(32).fill(9));
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      subjectIdOverride: stranger.did,
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/bound to .* instead of this wallet's DID/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);

  it("proves the real pairwise DID even if the session zeroes the secret mid-flight", async () => {
    // What logout() does during the token round-trip: the session's buffer
    // is zeroed IN PLACE while the flow still holds a reference to it. The
    // PoP JWT must never end up proving the publicly-derivable
    // all-zero-master key (and the commitment must never commit to the
    // all-zero link secret).
    const liveSecret = masterSecret.slice();
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      onTokenRequest: () => liveSecret.fill(0),
    });
    routeFetchTo(issuer);

    const record = await acceptCredentialOffer({
      offerUri: issuer.offerUri,
      accountId: 1,
      masterSecret: liveSecret,
      vaultKey,
    });

    const realHolder = ed25519KeyPairFromSeed(
      await deriveIssuancePopSeed(masterSecret, issuer.origin),
    );
    const zeroHolder = ed25519KeyPairFromSeed(
      await deriveIssuancePopSeed(new Uint8Array(32), issuer.origin),
    );
    expect(issuer.captured.holderDid).toBe(realHolder.did);
    expect(issuer.captured.holderDid).not.toBe(zeroHolder.did);

    // Same for the binding: the stored credential receipt-checks under the
    // REAL master's link secret, not the all-zero master's.
    const envelope = await decryptJson<CredentialPayload>(vaultKey, record.payload);
    const blind = scalarFromBase64Url(envelope.secretProverBlind);
    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: envelope.vc,
        holderBinding: {
          linkSecret: await deriveLinkSecret(masterSecret),
          secretProverBlind: blind,
        },
      }),
    ).resolves.toBe(true);
    await expect(
      verifyIssuedCredkitCredential({
        verifiableCredential: envelope.vc,
        holderBinding: {
          linkSecret: await deriveLinkSecret(new Uint8Array(32)),
          secretProverBlind: blind,
        },
      }),
    ).resolves.toBe(false);
  }, 60_000);

  it("stops at the next phase boundary when the session locks mid-flight", async () => {
    const liveSecret = masterSecret.slice();
    const lock = new AbortController();
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      // Both halves of logout(): zero the secret, abort the lock signal.
      onTokenRequest: () => {
        liveSecret.fill(0);
        lock.abort(new Error("The wallet was locked"));
      },
    });
    routeFetchTo(issuer);

    const steps: IssuanceStep[] = [];
    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret: liveSecret,
        vaultKey,
        signal: lock.signal,
        onStep: (step) => steps.push(step),
      }),
    ).rejects.toThrow(/wallet was locked/);
    // Nothing signed, nothing committed, nothing stored: the flow never
    // reached the proof phase.
    expect(steps).not.toContain("creating-proof");
    expect(db.stored).toHaveLength(0);
  }, 30_000);

  it("never lets non-string metadata display names reach the preview", async () => {
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      // A hostile issuer can put any JSON shape in display — a non-string
      // rendered as a React child would crash the whole app.
      mutateMetadata: (metadata) => ({
        ...metadata,
        display: [{ name: { x: 1 } }],
        credential_configurations_supported: {
          [CREDENTIAL_CONFIGURATION_ID]: {
            ...metadata.credential_configurations_supported[
              CREDENTIAL_CONFIGURATION_ID
            ],
            display: [{ name: "" }],
          },
        },
      }),
    });
    routeFetchTo(issuer);

    const preview = await previewCredentialOffer({ offerUri: issuer.offerUri });
    expect(preview.issuerName).toBe("dmv.utopia.example");
    expect(preview.credentialName).toBe(CREDENTIAL_CONFIGURATION_ID);
  }, 30_000);

  it("reports a malformed credentials array as a protocol error, not a TypeError", async () => {
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      mutateCredentialResponse: () => ({ credentials: [null] }),
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/empty or malformed credentials array/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);

  it("reports a null proof as an unbound-proof error, not a TypeError", async () => {
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      mutateCredentialResponse: (response) => ({
        ...response,
        credentials: response.credentials.map((entry) => ({
          credential: { ...entry.credential, proof: null },
        })),
      }),
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/not controlled by its declared issuer/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);

  it("rejects a credential blind-signed over someone else's commitment (receipt check)", async () => {
    // The issuer answers with a perfectly valid credkit credential — but
    // bound to a commitment the wallet never made. The receipt check is the
    // only thing standing between that credential and the vault.
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      swapCommitment: true,
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/blind signature did not verify/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);

  it("rejects a tampered credential (receipt check catches document mutation)", async () => {
    const issuer = makeFakeIssuer({
      origin: "https://dmv.utopia.example",
      seed: new Uint8Array(32).fill(1),
      mutateCredentialResponse: (response) => ({
        ...response,
        credentials: response.credentials.map((entry) => {
          const vc = entry.credential as Record<string, unknown>;
          const subject = vc["credentialSubject"] as Record<string, unknown>;
          const license = subject["driversLicense"] as Record<string, unknown>;
          return {
            credential: {
              ...vc,
              credentialSubject: {
                ...subject,
                driversLicense: { ...license, birth_date: "1901-01-01" },
              },
            },
          };
        }),
      }),
    });
    routeFetchTo(issuer);

    await expect(
      acceptCredentialOffer({
        offerUri: issuer.offerUri,
        accountId: 1,
        masterSecret,
        vaultKey,
      }),
    ).rejects.toThrow(/blind signature did not verify/);
    expect(db.stored).toHaveLength(0);
  }, 60_000);
});

describe("parseOfferParams", () => {
  const offer: CredentialOffer = {
    credential_issuer: "https://dmv.utopia.example",
    credential_configuration_ids: [CREDENTIAL_CONFIGURATION_ID],
    grants: {
      [PRE_AUTHORIZED_CODE_GRANT_TYPE]: { "pre-authorized_code": "abc" },
    },
  };

  it("reads credential_offer_uri", () => {
    const params = new URLSearchParams({
      credential_offer_uri: "https://dmv.utopia.example/oid4vci/offer/xyz",
    });
    expect(parseOfferParams(params)).toEqual({
      kind: "uri",
      offerUri: "https://dmv.utopia.example/oid4vci/offer/xyz",
    });
  });

  it("rejects a non-URL credential_offer_uri", () => {
    const params = new URLSearchParams({ credential_offer_uri: "not a url" });
    expect(parseOfferParams(params).kind).toBe("invalid");
  });

  it("accepts an inline credential_offer", () => {
    const params = new URLSearchParams({ credential_offer: JSON.stringify(offer) });
    expect(parseOfferParams(params)).toEqual({ kind: "inline", offer });
  });

  it("rejects an inline offer without the pre-authorized grant", () => {
    const { grants: _grants, ...rest } = offer;
    const params = new URLSearchParams({ credential_offer: JSON.stringify(rest) });
    const parsed = parseOfferParams(params);
    expect(parsed.kind).toBe("invalid");
    if (parsed.kind === "invalid") {
      expect(parsed.reason).toMatch(/pre-authorized_code/);
    }
  });

  it("reports missing params", () => {
    expect(parseOfferParams(new URLSearchParams())).toEqual({ kind: "missing" });
  });
});

describe("isInsecureIssuerOrigin", () => {
  it("flags plain http on non-local hosts only", () => {
    expect(isInsecureIssuerOrigin("http://dmv.utopia.example")).toBe(true);
    expect(isInsecureIssuerOrigin("https://dmv.utopia.example")).toBe(false);
    expect(isInsecureIssuerOrigin("http://localhost:8787")).toBe(false);
    expect(isInsecureIssuerOrigin("http://127.0.0.1:8787")).toBe(false);
    expect(isInsecureIssuerOrigin("http://dmv.localhost:8787")).toBe(false);
  });
});
