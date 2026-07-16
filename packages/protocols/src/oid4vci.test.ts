import { describe, expect, it } from "vitest";
import { toBase64Url } from "@vgw/keys";
import {
  CREDENTIAL_CONFIGURATION_ID,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  walletOfferLink,
  type CredentialOffer,
  type CredentialRequest,
  type CredentialResponse,
} from "./oid4vci.js";

describe("constants", () => {
  // These strings are the wire contract with the issuer Worker and the wallet;
  // pin them so a rename is caught as a test failure, not an interop bug.
  it("pins the pre-authorized code grant URN", () => {
    expect(PRE_AUTHORIZED_CODE_GRANT_TYPE).toBe(
      "urn:ietf:params:oauth:grant-type:pre-authorized_code",
    );
  });

  it("pins the credential configuration id", () => {
    expect(CREDENTIAL_CONFIGURATION_ID).toBe("UtopiaDriversLicense");
  });

  it("keys credential offer grants by the grant URN", () => {
    const offer: CredentialOffer = {
      credential_issuer: "https://dmv.verygoodwallet.com",
      credential_configuration_ids: [CREDENTIAL_CONFIGURATION_ID],
      grants: {
        [PRE_AUTHORIZED_CODE_GRANT_TYPE]: { "pre-authorized_code": "abc" },
      },
    };
    expect(offer.grants[PRE_AUTHORIZED_CODE_GRANT_TYPE]["pre-authorized_code"]).toBe(
      "abc",
    );
  });
});

describe("credential request/response wire shape (N2, credkit blind issuance)", () => {
  it("carries the holder commitment as base64url in vgw_holder_commitment", () => {
    // The binding rides OUTSIDE the proof slot (MIGRATION §3.3): proof stays
    // the standard jwt PoP, the commitment is a request extension field.
    const commitmentWithProof = new Uint8Array(144).fill(9);
    const request: CredentialRequest = {
      credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
      proof: { proof_type: "jwt", jwt: "a.b.c" },
      vgw_holder_commitment: toBase64Url(commitmentWithProof),
    };
    // JSON round-trip — the field is plain-string wire data.
    const parsed = JSON.parse(JSON.stringify(request)) as CredentialRequest;
    expect(parsed.vgw_holder_commitment).toBe(toBase64Url(commitmentWithProof));
    expect(parsed.proof.proof_type).toBe("jwt");
  });

  it("the commitment field is optional at the type level (baseline requests still compile)", () => {
    const request: CredentialRequest = {
      credential_configuration_id: CREDENTIAL_CONFIGURATION_ID,
      proof: { proof_type: "jwt", jwt: "a.b.c" },
    };
    expect(request.vgw_holder_commitment).toBeUndefined();
  });

  it("the response carries only credentials — no commitment opening travels", () => {
    const response: CredentialResponse = {
      credentials: [{ credential: { "@context": [], type: [] } }],
    };
    // Pin the N2 removal: vgw_commitment_opening is gone from the wire type.
    // (A compile-time pin — assigning it would no longer typecheck — asserted
    // here at runtime for the wire JSON too.)
    expect("vgw_commitment_opening" in response).toBe(false);
  });
});

describe("walletOfferLink", () => {
  it("targets /offer with an encoded credential_offer_uri param", () => {
    const link = walletOfferLink(
      "https://verygoodwallet.com",
      "https://dmv.verygoodwallet.com/oid4vci/offer/xyz",
    );
    expect(link).toBe(
      "https://verygoodwallet.com/offer?credential_offer_uri=" +
        "https%3A%2F%2Fdmv.verygoodwallet.com%2Foid4vci%2Foffer%2Fxyz",
    );
  });

  it("survives URL round-trip parsing even with query/fragment characters", () => {
    const offerUri = "https://dmv.example/offer?code=a+b&x=1#frag";
    const link = walletOfferLink("https://verygoodwallet.com", offerUri);
    const parsed = new URL(link);
    expect(parsed.pathname).toBe("/offer");
    expect(parsed.searchParams.get("credential_offer_uri")).toBe(offerUri);
  });
});
