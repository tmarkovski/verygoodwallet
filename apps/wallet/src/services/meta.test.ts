import { describe, expect, it } from "vitest";
import type { VerifiableCredential } from "@vgw/vc-kit";
import {
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
