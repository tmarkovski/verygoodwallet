import { describe, expect, it } from "vitest";
import type { VerifiableCredential } from "@vgw/vc-kit";
import {
  cardFace,
  credentialKind,
  issuerDid,
  issuerDisplayName,
  kindLabel,
  metaFromCredential,
} from "./meta";

const BASE_VC: VerifiableCredential = {
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  type: ["VerifiableCredential", "Iso18013DriversLicenseCredential"],
  name: "Utopia Driver's License",
  issuer: { id: "did:key:zUC7demo", name: "Utopia DMV" },
  validFrom: "2026-07-13T00:00:00Z",
  credentialSubject: { type: "LicensedDriver" },
};

describe("credentialKind", () => {
  it("returns the first non-generic type", () => {
    expect(credentialKind(BASE_VC)).toBe("Iso18013DriversLicenseCredential");
  });

  it("handles a scalar type", () => {
    expect(credentialKind({ ...BASE_VC, type: "AlumniCredential" })).toBe("AlumniCredential");
  });

  it("falls back to VerifiableCredential when no specific type exists", () => {
    expect(credentialKind({ ...BASE_VC, type: ["VerifiableCredential"] })).toBe(
      "VerifiableCredential",
    );
  });
});

describe("kindLabel", () => {
  it("uses the curated label for the Utopia DL", () => {
    expect(kindLabel("Iso18013DriversLicenseCredential")).toBe("Driver's license");
  });

  it("uses the curated label for the Utopia Resident Registration", () => {
    expect(kindLabel("UtopiaResidentRegistrationCredential")).toBe("Resident registration");
  });

  it("spaces camel-cased kinds and strips the Credential suffix", () => {
    expect(kindLabel("MovieTicketCredential")).toBe("Movie Ticket");
    expect(kindLabel("AlumniCredential")).toBe("Alumni");
  });

  it("never returns an empty label", () => {
    expect(kindLabel("Credential")).toBe("Credential");
  });
});

describe("issuerDisplayName / issuerDid", () => {
  it("prefers the issuer's name", () => {
    expect(issuerDisplayName(BASE_VC)).toBe("Utopia DMV");
    expect(issuerDid(BASE_VC)).toBe("did:key:zUC7demo");
  });

  it("falls back to the DID for string issuers", () => {
    const vc = { ...BASE_VC, issuer: "did:key:zUC7plain" };
    expect(issuerDisplayName(vc)).toBe("did:key:zUC7plain");
    expect(issuerDid(vc)).toBe("did:key:zUC7plain");
  });

  it("falls back to the id for object issuers without a name", () => {
    const vc = { ...BASE_VC, issuer: { id: "did:key:zUC7noname" } };
    expect(issuerDisplayName(vc)).toBe("did:key:zUC7noname");
  });

  it("handles a missing issuer", () => {
    const { issuer: _issuer, ...rest } = BASE_VC;
    expect(issuerDisplayName(rest as VerifiableCredential)).toBe("Unknown issuer");
    expect(issuerDid(rest as VerifiableCredential)).toBeUndefined();
  });
});

describe("metaFromCredential", () => {
  it("maps a signed VC to plaintext list metadata", () => {
    expect(metaFromCredential(BASE_VC)).toEqual({
      name: "Utopia Driver's License",
      issuerName: "Utopia DMV",
      kind: "Iso18013DriversLicenseCredential",
      colorSeed: "Iso18013DriversLicenseCredential",
    });
  });

  it("falls back to the kind label when the VC has no name", () => {
    const { name: _name, ...rest } = BASE_VC;
    const meta = metaFromCredential(rest as VerifiableCredential);
    expect(meta.name).toBe("Driver's license");
  });
});

describe("cardFace", () => {
  it("builds the DL face: holder, document number, MM/YYYY expiry", () => {
    const vc: VerifiableCredential = {
      ...BASE_VC,
      credentialSubject: {
        driversLicense: {
          given_name: "Avery",
          family_name: "Fontaine",
          document_number: "UDL-3F7K-9Q2M",
          expiry_date: "2031-07-13T00:00:00Z",
        },
      },
    };
    expect(cardFace(vc)).toEqual({
      holder: "AVERY FONTAINE",
      fields: [
        { label: "No.", value: "UDL-3F7K-9Q2M" },
        { label: "Expires", value: "07/2031" },
      ],
      revocable: false,
    });
  });

  it("marks the face revocable when the VC carries a revocation status entry", () => {
    const vc: VerifiableCredential = {
      ...BASE_VC,
      credentialStatus: {
        type: "VgwRevocationRegistryEntry",
        revocationRegistry: "https://dmv.example/api/registry",
        revocationId: "12345",
      },
      credentialSubject: { driversLicense: { given_name: "Avery" } },
    } as VerifiableCredential;
    expect(cardFace(vc)?.revocable).toBe(true);
  });

  it("builds the resident face: holder, district, postal code", () => {
    const vc: VerifiableCredential = {
      ...BASE_VC,
      type: ["VerifiableCredential", "UtopiaResidentRegistrationCredential"],
      credentialSubject: {
        type: ["Person", "UtopiaResident"],
        givenName: "Avery",
        familyName: "Fontaine",
        districtName: "Port Azure",
        stateFips: "11",
        postalCode: "40125",
      },
    };
    expect(cardFace(vc)).toEqual({
      holder: "AVERY FONTAINE",
      fields: [
        { label: "District", value: "Port Azure" },
        { label: "Postal", value: "40125" },
      ],
      revocable: false,
    });
  });

  it("omits missing halves instead of failing", () => {
    const vc: VerifiableCredential = {
      ...BASE_VC,
      credentialSubject: { driversLicense: { given_name: "Avery" } },
    };
    expect(cardFace(vc)).toEqual({ holder: "AVERY", fields: [], revocable: false });
  });

  it("returns null for unknown subject shapes", () => {
    expect(cardFace(BASE_VC)).toBeNull();
    expect(
      cardFace({ ...BASE_VC, credentialSubject: undefined } as unknown as VerifiableCredential),
    ).toBeNull();
  });
});
