/**
 * W3C Data Integrity bbs-2023 operations: base proof (issuer), derived proof
 * (holder, selective disclosure), and verification (relying party).
 *
 * Proof lifecycle
 * ---------------
 * 1. `signCredential` — the ISSUER creates a *base proof* over the whole
 *    credential. The base proof is holder-only material: it embeds the HMAC
 *    key and mandatory-pointer metadata needed to derive disclosures, and it
 *    is NOT the proof a relying party verifies.
 * 2. `deriveCredential` — the HOLDER derives an unlinkable *derived proof*
 *    revealing only the selected (plus mandatory) claims.
 * 3. `verifyCredential` — the RELYING PARTY verifies a credential carrying a
 *    derived proof. Passing a base-proof credential here fails by design.
 */
import {
  createSignCryptosuite,
  createDiscloseCryptosuite,
  createVerifyCryptosuite,
} from '@digitalbazaar/bbs-2023-cryptosuite';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import jsigs from 'jsonld-signatures';
import { extractErrorMessage, toMessage } from './jsigsErrors.js';
import { documentLoader } from './loader.js';
import { defaultMandatoryPointers } from './mandatory.js';
import type { BbsKeyPair, VerifiableCredential, VerifyCredentialResult } from './types.js';

const { AssertionProofPurpose } = jsigs.purposes;

/**
 * Signs a credential with a bbs-2023 *base proof* (issuer operation).
 *
 * The result is holder-only: the holder uses it with
 * {@link deriveCredential} to produce presentations. Do not send a
 * base-proof credential to a relying party — {@link verifyCredential}
 * only verifies derived proofs.
 *
 * @param options.credential - The unsigned VC 2.0 credential (any existing
 *   `proof` is stripped before signing).
 * @param options.keyPair - Issuer BBS key pair from `generateBbsKeyPair`.
 * @param options.mandatoryPointers - JSON pointers of claims that every
 *   derived presentation must reveal. Defaults to
 *   `['/issuer', '/validFrom', '/validUntil']` (filtered to the fields
 *   actually present on the credential). Mandatory values are disclosed
 *   identically in every derivation — keep them coarse (see
 *   {@link DEFAULT_MANDATORY_POINTERS}).
 */
export async function signCredential({
  credential,
  keyPair,
  mandatoryPointers,
}: {
  credential: VerifiableCredential;
  keyPair: BbsKeyPair;
  mandatoryPointers?: string[];
}): Promise<VerifiableCredential> {
  const { proof: _proof, ...unsignedCredential } = credential;

  const cryptosuite = createSignCryptosuite({
    mandatoryPointers: mandatoryPointers ?? defaultMandatoryPointers(credential),
  });
  const suite = new DataIntegrityProof({ signer: keyPair.signer(), cryptosuite });

  const signed = await jsigs.sign(unsignedCredential, {
    suite,
    purpose: new AssertionProofPurpose(),
    documentLoader,
  });
  return signed as VerifiableCredential;
}

/**
 * Derives a selectively-disclosed credential with a bbs-2023 *derived proof*
 * (holder operation). The result reveals only the claims matched by
 * `selectivePointers` plus the issuer's mandatory pointers; everything else
 * is omitted. Each derivation is unlinkable to other derivations of the same
 * base credential.
 *
 * @param options.verifiableCredential - A credential carrying a bbs-2023
 *   base proof (from {@link signCredential}).
 * @param options.selectivePointers - JSON pointers of the claims to reveal,
 *   e.g. `['/credentialSubject/driversLicense/birth_date']`.
 */
export async function deriveCredential({
  verifiableCredential,
  selectivePointers,
}: {
  verifiableCredential: VerifiableCredential;
  selectivePointers: string[];
}): Promise<VerifiableCredential> {
  const cryptosuite = createDiscloseCryptosuite({ selectivePointers });
  const suite = new DataIntegrityProof({ cryptosuite });

  const revealed = await jsigs.derive(verifiableCredential, {
    suite,
    purpose: new AssertionProofPurpose(),
    documentLoader,
  });
  return revealed as VerifiableCredential;
}

/**
 * Verifies a credential carrying a bbs-2023 *derived proof* (relying-party
 * operation).
 *
 * Beyond the cryptographic proof check, this always:
 *
 * - binds the proof's verification method to the issuer — `expectedIssuer`
 *   when given, otherwise the credential's own `issuer`. Without this, a
 *   credential could name any issuer while carrying a valid proof from an
 *   unrelated key. A credential with no resolvable issuer fails closed.
 *   Note: with the credential's own issuer this establishes that the signing
 *   key belongs to the *claimed* issuer DID (sound for self-certifying
 *   `did:key`); only `expectedIssuer` establishes that the issuer is one the
 *   relying party actually trusts.
 * - checks the validity period: `validFrom <= now <= validUntil` for
 *   whichever of the two fields the credential discloses, reporting
 *   "not yet valid"/"expired" distinctly from cryptographic failure.
 *
 * Note: bbs-2023 base proofs are holder-only material and are intentionally
 * NOT verifiable here — a base-proof credential yields `verified: false`.
 *
 * @param options.credential - The derived credential to verify.
 * @param options.expectedIssuer - Issuer DID the relying party trusts; the
 *   credential's `issuer` and the proof's verification method must both
 *   belong to this DID. Strongly recommended for relying parties.
 * @param options.now - Verification time for the validity-period check;
 *   defaults to the current time.
 */
export async function verifyCredential({
  credential,
  expectedIssuer,
  now,
}: {
  credential: VerifiableCredential;
  expectedIssuer?: string;
  now?: Date | string;
}): Promise<VerifyCredentialResult> {
  try {
    const cryptosuite = createVerifyCryptosuite();
    const suite = new DataIntegrityProof({ cryptosuite });

    const result = await jsigs.verify(credential, {
      suite,
      purpose: new AssertionProofPurpose(),
      documentLoader,
    });

    if (!result.verified) {
      return { verified: false, error: extractErrorMessage(result) };
    }

    const issuerId =
      typeof credential.issuer === 'string'
        ? credential.issuer
        : credential.issuer?.id;

    if (expectedIssuer !== undefined && issuerId !== expectedIssuer) {
      return {
        verified: false,
        error: `Issuer mismatch: expected "${expectedIssuer}", credential issued by "${String(issuerId)}".`,
      };
    }

    const boundIssuer = expectedIssuer ?? issuerId;
    if (boundIssuer === undefined) {
      return {
        verified: false,
        error: 'Credential has no issuer to bind the proof to.',
      };
    }
    const proofs = Array.isArray(credential.proof)
      ? credential.proof
      : credential.proof
        ? [credential.proof]
        : [];
    const boundToIssuer = proofs.some((proof) => {
      const vm = proof['verificationMethod'];
      return (
        typeof vm === 'string' &&
        (vm === boundIssuer || vm.startsWith(`${boundIssuer}#`))
      );
    });
    if (!boundToIssuer) {
      const role = expectedIssuer !== undefined ? 'expected issuer' : 'credential issuer';
      return {
        verified: false,
        error: `Proof verification method is not controlled by ${role} "${boundIssuer}".`,
      };
    }

    const validityError = checkValidityPeriod(credential, now);
    if (validityError !== undefined) {
      return { verified: false, error: validityError };
    }

    return { verified: true };
  } catch (error) {
    return { verified: false, error: toMessage(error) };
  }
}

/**
 * Checks `validFrom <= now <= validUntil` for whichever bounds the credential
 * carries. Returns an error message, or `undefined` when the credential is
 * within its validity period (or discloses no bounds to check).
 */
function checkValidityPeriod(
  credential: VerifiableCredential,
  now?: Date | string
): string | undefined {
  const at = now === undefined ? Date.now() : new Date(now).getTime();
  if (Number.isNaN(at)) {
    return `Invalid verification time: "${String(now)}".`;
  }
  const { validFrom, validUntil } = credential;
  if (validFrom !== undefined) {
    const from = Date.parse(validFrom);
    if (Number.isNaN(from)) return `Invalid validFrom date: "${validFrom}".`;
    if (at < from) {
      return `Credential is not yet valid: validFrom "${validFrom}" is in the future.`;
    }
  }
  if (validUntil !== undefined) {
    const until = Date.parse(validUntil);
    if (Number.isNaN(until)) return `Invalid validUntil date: "${validUntil}".`;
    if (at > until) {
      return `Credential has expired: validUntil "${validUntil}" is in the past.`;
    }
  }
  return undefined;
}

