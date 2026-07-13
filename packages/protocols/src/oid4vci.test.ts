import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_CONFIGURATION_ID,
  PRE_AUTHORIZED_CODE_GRANT_TYPE,
  walletOfferLink,
  type CredentialOffer,
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
