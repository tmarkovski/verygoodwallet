/**
 * Regression tests for `loginWithPasskey`'s master-secret source decision.
 *
 * The critical invariant: a missing PRF result must never silently rebind an
 * established PRF account to a freshly minted simulated secret — that would
 * change the whole key hierarchy, make every stored credential permanently
 * undecryptable, and pin the account to the simulated source forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  updateAccount: vi.fn(),
  listCredentials: vi.fn(),
}));

import { loginWithPasskey } from "./webauthn";
import {
  listCredentials,
  updateAccount,
  type AccountRecord,
  type CredentialRecord,
} from "./db";

const updateAccountMock = vi.mocked(updateAccount);
const listCredentialsMock = vi.mocked(listCredentials);

/** Stand-in for the DOM PublicKeyCredential (absent in Node). */
class FakePublicKeyCredential {
  constructor(readonly extensions: Record<string, unknown>) {}
  getClientExtensionResults(): Record<string, unknown> {
    return this.extensions;
  }
}

const credentialsGet = vi.fn();

function assertionWithPrf(first?: ArrayBuffer): FakePublicKeyCredential {
  return new FakePublicKeyCredential(
    first !== undefined ? { prf: { results: { first } } } : {},
  );
}

function makeAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: 1,
    name: "Test wallet",
    credentialId: new Uint8Array(16),
    prfSupported: false,
    createdAt: 0,
    lastUsedAt: 0,
    ...overrides,
  };
}

const PRF_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

beforeEach(() => {
  vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("navigator", { credentials: { get: credentialsGet } });
  credentialsGet.mockReset();
  updateAccountMock.mockReset();
  updateAccountMock.mockImplementation(async (record) => record);
  listCredentialsMock.mockReset();
  listCredentialsMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loginWithPasskey", () => {
  it("uses the PRF output when the assertion provides it", async () => {
    credentialsGet.mockResolvedValue(assertionWithPrf(PRF_BYTES.slice(0).buffer));

    const result = await loginWithPasskey(makeAccount({ prfSupported: true }));

    expect(result.source).toBe("prf");
    expect(result.masterSecret).toEqual(PRF_BYTES);
    expect(updateAccountMock).not.toHaveBeenCalled();
  });

  it("upgrades a provisional non-PRF account when PRF output appears", async () => {
    credentialsGet.mockResolvedValue(assertionWithPrf(PRF_BYTES.slice(0).buffer));

    const result = await loginWithPasskey(makeAccount({ prfSupported: false }));

    expect(result.source).toBe("prf");
    expect(updateAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({ prfSupported: true }),
    );
  });

  it("keeps an established simulated account simulated even when PRF output appears", async () => {
    const simulatedSecret = Uint8Array.from({ length: 32 }, () => 7);
    credentialsGet.mockResolvedValue(assertionWithPrf(PRF_BYTES.slice(0).buffer));

    const result = await loginWithPasskey(
      makeAccount({ prfSupported: false, simulatedSecret }),
    );

    expect(result.source).toBe("simulated");
    expect(result.masterSecret).toEqual(simulatedSecret);
    expect(updateAccountMock).not.toHaveBeenCalled();
  });

  it("refuses to mint a simulated secret when a PRF-backed account gets no PRF output", async () => {
    credentialsGet.mockResolvedValue(assertionWithPrf());

    await expect(
      loginWithPasskey(makeAccount({ prfSupported: true })),
    ).rejects.toThrow(/PRF output/);

    // Nothing persisted: no downgrade, the vault stays bound to the PRF key.
    expect(updateAccountMock).not.toHaveBeenCalled();
  });

  it("refuses the fallback when the account already owns credentials", async () => {
    credentialsGet.mockResolvedValue(assertionWithPrf());
    listCredentialsMock.mockResolvedValue([
      { id: 1, accountId: 1 } as CredentialRecord,
    ]);

    await expect(
      loginWithPasskey(makeAccount({ prfSupported: false })),
    ).rejects.toThrow(/PRF output/);

    expect(updateAccountMock).not.toHaveBeenCalled();
  });

  it("generates and persists a simulated secret on genuine first use without PRF", async () => {
    credentialsGet.mockResolvedValue(assertionWithPrf());

    const result = await loginWithPasskey(makeAccount({ prfSupported: false }));

    expect(result.source).toBe("simulated");
    expect(result.masterSecret).toHaveLength(32);
    expect(updateAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prfSupported: false,
        simulatedSecret: expect.any(Uint8Array),
      }),
    );
  });
});
