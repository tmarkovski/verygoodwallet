import { describe, expect, it } from "vitest";
import { claimPathToPointer, matchDcqlCredentialQuery, matchDcqlQuery } from "./dcql.js";
import type { DcqlCredentialQuery, DcqlQuery } from "./oid4vp.js";

/** A stored credential shaped like the Utopia DL (age flags present). */
const DL = {
  type: ["VerifiableCredential", "Iso18013DriversLicenseCredential"],
  credentialSubject: {
    type: "LicensedDriver",
    driversLicense: {
      given_name: "JAMIE",
      birth_date: "1988-04-19",
      age_over_18: true,
      age_over_21: true,
    },
  },
};

/** A credential issued before the age flags existed. */
const OLD_DL = {
  type: ["VerifiableCredential", "Iso18013DriversLicenseCredential"],
  credentialSubject: {
    type: "LicensedDriver",
    driversLicense: { given_name: "JAMIE", birth_date: "1988-04-19" },
  },
};

const OTHER_VC = {
  type: ["VerifiableCredential", "OpenBadgeCredential"],
  credentialSubject: {},
};

const AGE_QUERY: DcqlCredentialQuery = {
  id: "utopia_dl",
  format: "ldp_vc",
  meta: { type_values: [["VerifiableCredential", "Iso18013DriversLicenseCredential"]] },
  claims: [
    { id: "age_flag", path: ["credentialSubject", "driversLicense", "age_over_18"] },
    { id: "dob", path: ["credentialSubject", "driversLicense", "birth_date"] },
  ],
  claim_sets: [["age_flag"], ["dob"]],
};

describe("claimPathToPointer", () => {
  it("converts path segments to a JSON pointer", () => {
    expect(claimPathToPointer(["credentialSubject", "driversLicense", "age_over_18"])).toBe(
      "/credentialSubject/driversLicense/age_over_18",
    );
    expect(claimPathToPointer(["a", 0, "b"])).toBe("/a/0/b");
  });

  it("escapes RFC 6901 special characters", () => {
    expect(claimPathToPointer(["a/b", "c~d"])).toBe("/a~1b/c~0d");
  });
});

describe("matchDcqlCredentialQuery", () => {
  it("prefers the first claim_set alternative (the age flag)", () => {
    const match = matchDcqlCredentialQuery(DL, AGE_QUERY);
    expect(match).not.toBeNull();
    expect(match?.claimSetIndex).toBe(0);
    expect(match?.claims.map((c) => c.pointer)).toEqual([
      "/credentialSubject/driversLicense/age_over_18",
    ]);
    expect(match?.claims[0]?.value).toBe(true);
  });

  it("falls back to the next claim_set for credentials without the flag", () => {
    const match = matchDcqlCredentialQuery(OLD_DL, AGE_QUERY);
    expect(match).not.toBeNull();
    expect(match?.claimSetIndex).toBe(1);
    expect(match?.claims.map((c) => c.pointer)).toEqual([
      "/credentialSubject/driversLicense/birth_date",
    ]);
  });

  it("matches a false age flag too — the verifier decides, not the wallet", () => {
    const minor = {
      ...DL,
      credentialSubject: {
        ...DL.credentialSubject,
        driversLicense: { ...DL.credentialSubject.driversLicense, age_over_18: false },
      },
    };
    const match = matchDcqlCredentialQuery(minor, AGE_QUERY);
    expect(match?.claimSetIndex).toBe(0);
    expect(match?.claims[0]?.value).toBe(false);
  });

  it("rejects credentials whose types do not satisfy type_values", () => {
    expect(matchDcqlCredentialQuery(OTHER_VC, AGE_QUERY)).toBeNull();
  });

  it("enforces values filters when present", () => {
    const query: DcqlCredentialQuery = {
      id: "x",
      format: "ldp_vc",
      claims: [
        {
          path: ["credentialSubject", "driversLicense", "age_over_18"],
          values: [true],
        },
      ],
    };
    expect(matchDcqlCredentialQuery(DL, query)).not.toBeNull();
    expect(matchDcqlCredentialQuery(OLD_DL, query)).toBeNull();
  });

  it("requires every claim when there are no claim_sets", () => {
    const query: DcqlCredentialQuery = {
      id: "x",
      format: "ldp_vc",
      claims: [
        { path: ["credentialSubject", "driversLicense", "given_name"] },
        { path: ["credentialSubject", "driversLicense", "no_such_claim"] },
      ],
    };
    expect(matchDcqlCredentialQuery(DL, query)).toBeNull();
  });

  it("matches with empty claims when only type_values are queried", () => {
    const query: DcqlCredentialQuery = {
      id: "x",
      format: "ldp_vc",
      meta: { type_values: [["Iso18013DriversLicenseCredential"]] },
    };
    expect(matchDcqlCredentialQuery(DL, query)).toEqual({ claimSetIndex: 0, claims: [] });
  });
});

describe("matchDcqlQuery", () => {
  it("lists candidates per credential query across the stored credentials", () => {
    const query: DcqlQuery = { credentials: [AGE_QUERY] };
    const results = matchDcqlQuery([OTHER_VC, DL, OLD_DL], query);
    expect(results).toHaveLength(1);
    expect(results[0]?.candidates.map((c) => c.index)).toEqual([1, 2]);
  });

  it("returns empty candidates when nothing satisfies the query", () => {
    const results = matchDcqlQuery([OTHER_VC], { credentials: [AGE_QUERY] });
    expect(results[0]?.candidates).toEqual([]);
  });
});
