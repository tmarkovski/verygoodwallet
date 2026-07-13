/**
 * Passkey (WebAuthn) service — PRF-only.
 *
 * Registration creates a discoverable credential with the PRF extension
 * requested; login evaluates PRF with the fixed `PRF_EVAL_INPUT` so the same
 * passkey always yields the same 32-byte master secret. When the
 * authenticator/browser lacks PRF, the wallet falls back to a SIMULATED
 * master secret (random 32 bytes persisted in the account record) and the
 * account is marked so the UI shows a clearly-labeled badge.
 *
 * The master secret lives in memory only — it is never persisted (except the
 * clearly-labeled simulated fallback) and never logged raw.
 */

import { PRF_EVAL_INPUT, previewSecret, utf8 } from "@vgw/keys";
import { inspect } from "../inspector/events";
import { listCredentials, updateAccount, type AccountRecord } from "./db";

export const RP_NAME = "VeryGoodWallet";

/** True when this browser can do passkeys at all (secure context required). */
export function passkeysAvailable(): boolean {
  return (
    typeof PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    "credentials" in navigator &&
    window.isSecureContext
  );
}

export interface RegisterResult {
  credentialId: Uint8Array;
  /** From `getClientExtensionResults().prf.enabled` — provisional until first login. */
  prfSupported: boolean;
}

/**
 * Create a passkey: resident key required, user verification required,
 * PRF extension requested. `user.id` is 16 random bytes (never the name).
 */
export async function registerPasskey(name: string): Promise<RegisterResult> {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: location.hostname, name: RP_NAME },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name,
        displayName: name,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -8 }, // EdDSA
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      timeout: 60_000,
      extensions: { prf: {} },
    },
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Passkey creation did not return a credential.");
  }

  const extensions = credential.getClientExtensionResults();
  const prfSupported = extensions.prf?.enabled === true;

  inspect.emit({
    label: "Passkey created",
    data: {
      rpId: location.hostname,
      residentKey: "required",
      userVerification: "required",
      prfEnabled: prfSupported,
    },
  });

  return {
    credentialId: new Uint8Array(credential.rawId.slice(0)),
    prfSupported,
  };
}

export type MasterSecretSource = "prf" | "simulated";

export interface LoginResult {
  masterSecret: Uint8Array;
  /** The account record, updated in the DB if its PRF status changed. */
  account: AccountRecord;
  source: MasterSecretSource;
}

function bufferSourceToBytes(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  return new Uint8Array(
    source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  );
}

/**
 * Authenticate with the account's passkey and obtain the master secret.
 *
 * PRF is evaluated with `utf8(PRF_EVAL_INPUT)`. The decision between PRF and
 * the simulated fallback is made on actual assertion results:
 * - an account already using a simulated secret stays simulated (stability —
 *   switching sources would change the whole key hierarchy);
 * - otherwise PRF output wins when present;
 * - a missing PRF result on an account that is PRF-backed (or that already
 *   owns credentials) is a recoverable error — never a downgrade, because a
 *   replacement secret would rebind the key hierarchy and make the existing
 *   vault permanently undecryptable;
 * - only on genuine first use (never PRF-backed, no credentials) is a
 *   simulated secret generated, persisted, and the account marked
 *   `prfSupported: false`.
 */
export async function loginWithPasskey(account: AccountRecord): Promise<LoginResult> {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [
        { id: account.credentialId as BufferSource, type: "public-key" },
      ],
      userVerification: "required",
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: utf8(PRF_EVAL_INPUT) as BufferSource } },
      },
    },
  });

  if (!(assertion instanceof PublicKeyCredential)) {
    throw new Error("Passkey authentication did not return a credential.");
  }

  const extensions = assertion.getClientExtensionResults();
  const prfFirst = extensions.prf?.results?.first;

  // Established simulated accounts stay simulated: the vault and every derived
  // key are bound to the existing secret.
  if (account.simulatedSecret !== undefined) {
    const masterSecret = account.simulatedSecret.slice(0);
    inspect.emit({
      label: "Simulated master secret loaded",
      data: {
        reason: "account is marked PRF-unavailable",
        preview: await previewSecret(masterSecret),
      },
    });
    return { masterSecret, account, source: "simulated" };
  }

  if (prfFirst !== undefined) {
    const masterSecret = bufferSourceToBytes(prfFirst);
    let updated = account;
    if (!account.prfSupported) {
      updated = await updateAccount({ ...account, prfSupported: true });
    }
    inspect.emit({
      label: "PRF evaluated",
      data: {
        input: PRF_EVAL_INPUT,
        bytes: masterSecret.length,
        preview: await previewSecret(masterSecret),
      },
    });
    return { masterSecret, account: updated, source: "prf" };
  }

  // The assertion returned no PRF output. That may be transient (hybrid/QR
  // transport, provider change, browser regression), so it must never rebind
  // an account whose vault is already tied to the PRF-derived hierarchy:
  // minting a replacement secret here would make every stored credential
  // permanently undecryptable and pin the account to the simulated source
  // forever. Refuse and let the user retry instead.
  if (account.prfSupported || (await listCredentials(account.id)).length > 0) {
    inspect.emit({
      label: "PRF output missing",
      data: {
        reason: "assertion returned no PRF result for a PRF-backed account",
        action: "unlock refused — no downgrade, nothing was changed",
      },
    });
    throw new Error(
      "This browser did not return your passkey's PRF output, which this " +
        "wallet's keys are derived from. Nothing was changed — try again, or " +
        "unlock from a browser and authenticator that support passkey PRF.",
    );
  }

  // Genuine first use on an authenticator/browser without PRF: simulated fallback.
  const simulatedSecret = crypto.getRandomValues(new Uint8Array(32));
  const updated = await updateAccount({
    ...account,
    prfSupported: false,
    simulatedSecret,
  });
  inspect.emit({
    label: "Simulated master secret generated",
    data: {
      reason: "authenticator returned no PRF output",
      preview: await previewSecret(simulatedSecret),
    },
  });
  return { masterSecret: simulatedSecret.slice(0), account: updated, source: "simulated" };
}
