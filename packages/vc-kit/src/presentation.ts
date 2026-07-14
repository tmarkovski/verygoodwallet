/**
 * W3C Verifiable Presentations with eddsa-rdfc-2022 authentication proofs:
 * the holder wraps derived credentials in a presentation and signs it with a
 * per-verifier Ed25519 presenter key; the relying party verifies the wrapper
 * and every embedded credential.
 *
 * What the presenter signature does — and does not — prove
 * --------------------------------------------------------
 * The VP proof binds the response to a challenge (the verifier's nonce) and
 * a domain (the verifier's client_id), so a captured presentation cannot be
 * replayed against another session or another verifier. It does NOT
 * cryptographically bind the presenter to the *credentials*: the embedded
 * BBS derived proofs deliberately omit the credential subject by default
 * (unlinkability), so nothing ties the presenter key to the holder the
 * credential was issued to. Unlinkable cryptographic holder binding (BBS
 * blind holder binding / per-verifier pseudonyms) is documented future work
 * — the demo says so honestly rather than faking it.
 */
import { cryptosuite as eddsaRdfc2022CryptoSuite } from '@digitalbazaar/eddsa-rdfc-2022-cryptosuite';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import jsigs from 'jsonld-signatures';
import { CREDENTIALS_V2_CONTEXT_URL } from './contexts/index.js';
import { verifyCredential } from './bbs.js';
import { extractErrorMessage, toMessage } from './jsigsErrors.js';
import { documentLoader } from './loader.js';
import type {
  Ed25519KeyPair,
  PresentedCredentialResult,
  VerifiableCredential,
  VerifiablePresentation,
  VerifyPresentationResult,
} from './types.js';

const { AuthenticationProofPurpose } = jsigs.purposes;

/**
 * Wrap derived credentials in a presentation and sign it with the holder's
 * presenter key (authentication proof purpose).
 *
 * @param options.credentials - Credentials carrying bbs-2023 *derived*
 *   proofs (from `deriveCredential`). Never put a base-proof credential in a
 *   presentation — the base proof embeds holder-only derivation material.
 * @param options.keyPair - Presenter Ed25519 key pair from
 *   `generateEd25519KeyPair` (per-verifier pairwise seed).
 * @param options.challenge - The verifier's nonce, echoed into the proof.
 * @param options.domain - The verifier's identifier (OID4VP `client_id`);
 *   scopes the proof to this verifier.
 * @param options.contexts - Extra JSON-LD context URLs the presentation's
 *   own properties need (beyond credentials/v2).
 * @param options.properties - Additional top-level presentation properties,
 *   signed along with everything else (e.g. the VGW `zkAgeProof` JSON
 *   literal). Every key must be a term defined by the presentation's
 *   contexts.
 */
export async function signPresentation({
  credentials,
  keyPair,
  challenge,
  domain,
  contexts = [],
  properties = {},
}: {
  credentials: VerifiableCredential[];
  keyPair: Ed25519KeyPair;
  challenge: string;
  domain?: string;
  contexts?: string[];
  properties?: Record<string, unknown>;
}): Promise<VerifiablePresentation> {
  if (credentials.length === 0) {
    throw new Error('signPresentation: at least one credential is required');
  }
  for (const reserved of ['@context', 'type', 'holder', 'verifiableCredential', 'proof']) {
    if (reserved in properties) {
      throw new Error(`signPresentation: properties may not override "${reserved}"`);
    }
  }
  const presentation: VerifiablePresentation = {
    '@context': [CREDENTIALS_V2_CONTEXT_URL, ...contexts],
    type: ['VerifiablePresentation'],
    holder: keyPair.controller,
    verifiableCredential: credentials,
    ...properties,
  };

  const suite = new DataIntegrityProof({
    signer: keyPair.signer(),
    cryptosuite: eddsaRdfc2022CryptoSuite,
  });

  const signed = await jsigs.sign(presentation, {
    suite,
    purpose: new AuthenticationProofPurpose({ challenge, domain }),
    documentLoader,
  });
  return signed as VerifiablePresentation;
}

/**
 * Verify a presentation (relying-party operation): the VP's eddsa-rdfc-2022
 * authentication proof against the expected challenge/domain, the proof's
 * binding to the declared `holder`, and every embedded credential's bbs-2023
 * derived proof (including `expectedIssuer` pinning and validity windows).
 *
 * Fails closed: `verified` is true only when every check passed. Per-
 * credential outcomes are reported individually so callers can name what
 * failed.
 *
 * @param options.presentation - The signed presentation received on the wire.
 * @param options.challenge - The nonce this verifier issued for the session.
 * @param options.domain - The verifier identifier the proof must be scoped
 *   to (omit only if the presenter did not include one).
 * @param options.expectedIssuer - Issuer DID every embedded credential must
 *   be signed by. Strongly recommended.
 * @param options.now - Verification time for credential validity windows.
 */
export async function verifyPresentation({
  presentation,
  challenge,
  domain,
  expectedIssuer,
  now,
}: {
  presentation: VerifiablePresentation;
  challenge: string;
  domain?: string;
  expectedIssuer?: string;
  now?: Date | string;
}): Promise<VerifyPresentationResult> {
  const credentials = embeddedCredentials(presentation);
  try {
    // 1. The presentation wrapper: challenge, domain, signature, and the
    // verification method's authorization for `authentication` in its
    // controller document — all checked by the purpose + suite.
    const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022CryptoSuite });
    const result = await jsigs.verify(presentation, {
      suite,
      purpose: new AuthenticationProofPurpose({ challenge, domain }),
      documentLoader,
    });
    if (!result.verified) {
      return {
        verified: false,
        credentials: unverifiedCredentials(credentials),
        error: `Presentation proof failed: ${extractErrorMessage(result)}`,
      };
    }

    // 2. Presenter binding: the declared holder must control the proof's
    // verification method, or the VP could name one presenter while carrying
    // an unrelated key's signature. A missing holder fails closed.
    const holder = presentation.holder;
    if (typeof holder !== 'string' || holder === '') {
      return {
        verified: false,
        credentials: unverifiedCredentials(credentials),
        error: 'Presentation names no holder to bind the proof to.',
      };
    }
    const proofs = Array.isArray(presentation.proof)
      ? presentation.proof
      : presentation.proof
        ? [presentation.proof]
        : [];
    const boundToHolder = proofs.some((proof) => {
      const vm = proof['verificationMethod'];
      return typeof vm === 'string' && (vm === holder || vm.startsWith(`${holder}#`));
    });
    if (!boundToHolder) {
      return {
        verified: false,
        credentials: unverifiedCredentials(credentials),
        error: `Presentation proof is not controlled by the declared holder "${holder}".`,
      };
    }

    // 3. Every embedded credential, individually and fail-closed.
    if (credentials.length === 0) {
      return {
        verified: false,
        holder,
        credentials: [],
        error: 'Presentation embeds no verifiable credentials.',
      };
    }
    const credentialResults: PresentedCredentialResult[] = [];
    for (const credential of credentials) {
      const credentialResult = await verifyCredential({ credential, expectedIssuer, now });
      credentialResults.push({
        credential,
        verified: credentialResult.verified,
        ...(credentialResult.error !== undefined ? { error: credentialResult.error } : {}),
      });
    }
    const failed = credentialResults.filter((r) => !r.verified);
    if (failed.length > 0) {
      return {
        verified: false,
        holder,
        credentials: credentialResults,
        error: `${failed.length} of ${credentialResults.length} embedded credential(s) failed verification: ${failed
          .map((r) => r.error ?? 'unknown error')
          .join('; ')}`,
      };
    }

    return { verified: true, holder, credentials: credentialResults };
  } catch (error) {
    return {
      verified: false,
      credentials: unverifiedCredentials(credentials),
      error: toMessage(error),
    };
  }
}

function embeddedCredentials(presentation: VerifiablePresentation): VerifiableCredential[] {
  const raw = presentation.verifiableCredential;
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function unverifiedCredentials(
  credentials: VerifiableCredential[],
): PresentedCredentialResult[] {
  return credentials.map((credential) => ({
    credential,
    verified: false,
    error: 'Not checked — the presentation wrapper failed first.',
  }));
}
