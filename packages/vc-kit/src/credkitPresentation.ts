/**
 * credkit presentation facade — the ONLY path through which VGW apps present
 * or verify credkit credentials (house pattern: apps import vc-kit facades,
 * never credkit directly).
 *
 * Presenting (`createCredkitPresentation`) wraps `presentGraph`: N holder-
 * bound credentials become one Verifiable Presentation secured by the
 * `credkit-bbs-presentation-sha-2026` suite, with selective disclosure,
 * range and set-membership claims over hidden numeric twins, and
 * challenge/domain folded into the merged transcript natively. The VP
 * carries NO holder identifier —
 * credkit makes a `holder` property unrepresentable (MIGRATION §6), so the
 * verifier sees no key, no DID, nothing to correlate on.
 *
 * Verifying (`verifyCredkitPresentation`) is the MIGRATION §4 policy facade,
 * deliberately more than a rename of credkit's `verifyGraph`:
 *
 * 1. Issuer keys come from VERIFIER POLICY — configured `did:key:zUC7…` DIDs
 *    decoded through the validating `bbsPublicKeyFromDidKey` gate and lifted
 *    to G2 points, in statement order. Never a key carried by the wire.
 * 2. `verifyGraph` runs the cryptography: every BBS signature, the merged
 *    presentation proof, challenge/domain equality, and the exact positional
 *    restatement of range/membership claims and equalities (a claim or
 *    linkage the verifier did not demand fails loudly, never passes
 *    silently).
 * 3. Only after crypto success, per statement: the revealed `issuer` must
 *    equal the configured DID, the wire proof's `verificationMethod` must be
 *    controlled by that DID, and `validFrom <= now <= validUntil` for
 *    whichever bounds the document carries — the exact policy semantics of
 *    the bbs-2023 `verifyCredential` this facade succeeds.
 *
 * Any disagreement anywhere yields one fail-closed `{ verified: false }`.
 */
import {
  getEncoder,
  parseBaseProofValue,
  parsePresentationEnvelope,
  presentGraph,
  verifyGraph,
  type ExpectedMembershipClaim,
  type ExpectedRangeClaim,
  type GraphEquality,
  type HolderBinding,
  type MembershipClaimRequest,
  type NumericDeclarationEntry,
  type NumericEncoder,
  type ProofMode,
  type RangeClaimRequest,
} from '@credkit/cryptosuite';
import { g2FromBytes, type G2Point } from '@credkit/bbs';
import { credkitDocumentLoader } from './credkit.js';
import { bbsPublicKeyFromDidKey } from './keys.js';
import {
  decodeExpectedNonRevocationClaim,
  decodeNonRevocationProveInput,
  type CredkitExpectedNonRevocationClaim,
  type CredkitNonRevocationProveInput,
} from './credkitRevocation.js';
import type { VerifiableCredential, VerifiablePresentation } from './types.js';

/** One credential's share of a presentation (see {@link createCredkitPresentation}). */
export interface CredkitPresentationCredential {
  /** A credential carrying a credkit base proof (from `issueCredkitCredential`). */
  verifiableCredential: VerifiableCredential;
  /**
   * JSON pointers of the claims to reveal, e.g.
   * `['/credentialSubject/driversLicense/age_over_18']` — plus the issuer's
   * mandatory pointers, always. Empty/omitted reveals mandatory only.
   */
  selectivePointers?: readonly string[];
  /**
   * Range claims over the credential's DECLARED numeric twins, in the order
   * the verifier restates them. The twin value stays hidden; an out-of-range
   * value makes the prover THROW rather than emit a false proof.
   */
  rangeClaims?: readonly RangeClaimRequest[];
  /**
   * Set-membership claims over the credential's declared twins (N5), in the
   * order the verifier restates them — each proves the hidden value is one
   * of the verifier's published set members. Same fail-closed discipline as
   * range claims: a non-member value makes the prover THROW.
   */
  membershipClaims?: readonly MembershipClaimRequest[];
  /**
   * Non-revocation claims over the credential's declared `frScalar` twin
   * (its hidden revocation id), in the order the verifier restates them —
   * VGW credentials carry at most one. The witness must be CURRENT: refresh
   * it against the registry (`refreshRevocationWitness`) before presenting;
   * a stale witness makes the proof fail at the verifier, and a revoked id
   * fails the refresh itself — the prover never emits a false proof.
   */
  nonRevocationClaims?: readonly CredkitNonRevocationProveInput[];
  /**
   * The holder's link secret + this credential's `secretProverBlind` —
   * REQUIRED for holder-bound credentials (every VGW v3 credential is).
   */
  holderBinding?: Pick<HolderBinding, 'linkSecret' | 'secretProverBlind'>;
}

/** Options for {@link createCredkitPresentation}. */
export interface CreateCredkitPresentationOptions {
  credentials: readonly CredkitPresentationCredential[];
  /** Cross-credential witness equalities (N5; the link-secret linkage lives here). */
  equalities?: readonly GraphEquality[];
  /** The verifier's nonce — folded into the presentation transcript. */
  challenge: string;
  /** The verifier's audience (OID4VP client_id) — folded alongside. */
  domain?: string;
}

/**
 * Present one or more credkit credentials as a single VP (holder operation).
 * Wraps `presentGraph` with VGW's offline document loader pinned. Each
 * presentation is unlinkable to every other derivation of the same
 * credentials, and the VP carries no holder identifier of any kind.
 */
export async function createCredkitPresentation(
  options: CreateCredkitPresentationOptions,
): Promise<VerifiablePresentation> {
  const { verifiablePresentation } = await presentGraph({
    credentials: options.credentials.map((input) => ({
      verifiableCredential: input.verifiableCredential as Record<string, unknown>,
      selectivePointers: input.selectivePointers ?? [],
      ...(input.rangeClaims !== undefined ? { rangeClaims: input.rangeClaims } : {}),
      ...(input.membershipClaims !== undefined
        ? { membershipClaims: input.membershipClaims }
        : {}),
      ...(input.nonRevocationClaims !== undefined
        ? { nonRevocationClaims: input.nonRevocationClaims.map(decodeNonRevocationProveInput) }
        : {}),
      ...(input.holderBinding !== undefined ? { holderBinding: input.holderBinding } : {}),
    })),
    ...(options.equalities !== undefined ? { equalities: options.equalities } : {}),
    challenge: options.challenge,
    ...(options.domain !== undefined ? { domain: options.domain } : {}),
    documentLoader: credkitDocumentLoader,
  });
  return verifiablePresentation as VerifiablePresentation;
}

/** Options for {@link verifyCredkitPresentation}. */
export interface VerifyCredkitPresentationOptions {
  verifiablePresentation: VerifiablePresentation;
  /**
   * The issuer DID this verifier trusts for each statement, in statement
   * order — verifier policy (pin or discovery), never read from the wire.
   */
  expectedIssuerDids: readonly string[];
  /** The nonce this verifier issued for the session. */
  challenge: string;
  /** The audience this verifier expects (its own client_id). */
  domain?: string;
  /**
   * The range claims this verifier demanded, statement-major, restated from
   * its own policy — matched positionally and exactly (pointer, kind, bound,
   * digits, params hash) against the proof's claim list.
   */
  expectedRangeClaims?: readonly ExpectedRangeClaim[];
  expectedMembershipClaims?: readonly ExpectedMembershipClaim[];
  /**
   * The non-revocation claims this verifier demanded, restated from its OWN
   * registry fetch (params, accumulator value, epoch) — matched positionally
   * per statement. Defaults to [] — an undemanded non-revocation claim
   * fails, never passes silently; and a demanded one a presentation lacks
   * fails the same way.
   */
  expectedNonRevocationClaims?: readonly CredkitExpectedNonRevocationClaim[];
  /** Defaults to [] — an undemanded equality fails, never passes silently. */
  expectedEqualities?: readonly GraphEquality[];
  /** Verification time for the validity-period check; defaults to now. */
  now?: Date | string;
}

/** Result of {@link verifyCredkitPresentation}. */
export interface VerifyCredkitPresentationResult {
  verified: boolean;
  /**
   * Only when verified: one revealed credential per statement, in order —
   * the proof-stripped documents whose disclosed claims the caller's policy
   * may now judge.
   */
  documents?: VerifiableCredential[];
  error?: string;
}

/**
 * Verify a credkit VP against this verifier's trust anchors and expectations
 * (relying-party operation) — see the module note for the three layers. A
 * bare cryptographic pass is necessary but not sufficient: issuer equality,
 * verification-method control, and validity windows are enforced here, per
 * statement, before `verified: true` is returned.
 */
export async function verifyCredkitPresentation(
  options: VerifyCredkitPresentationOptions,
): Promise<VerifyCredkitPresentationResult> {
  // 1. Configured DIDs → validated raw G2 trust anchors. A malformed
  // configured DID is a verifier misconfiguration: fail closed with the
  // decode error rather than verifying against nothing. (`G2Point` is the
  // raw compressed 96-byte key; `g2FromBytes` is the validating lift —
  // codec, length, subgroup, non-identity — run before the bytes are
  // trusted as an anchor.)
  const publicKeys: G2Point[] = [];
  for (const did of options.expectedIssuerDids) {
    try {
      const raw = bbsPublicKeyFromDidKey(did);
      g2FromBytes(raw, 'expected issuer key');
      publicKeys.push(raw);
    } catch (error) {
      return {
        verified: false,
        error: `Trusted issuer DID "${did}" did not decode to a BLS12-381 G2 key: ${toMessage(error)}`,
      };
    }
  }

  // 1b. The verifier's restated registry state → typed points. Malformed
  // state is a verifier-side problem (bad fetch, bad config): fail closed
  // with the decode error rather than verifying against nothing.
  let expectedNonRevocationClaims;
  try {
    expectedNonRevocationClaims = (options.expectedNonRevocationClaims ?? []).map(
      decodeExpectedNonRevocationClaim,
    );
  } catch (error) {
    return {
      verified: false,
      error: `Expected non-revocation claim did not decode: ${toMessage(error)}`,
    };
  }

  // 2. The cryptography, with the claim lists restated from verifier policy.
  // verifyGraph never throws — failures come back as { verified, reason }.
  const result = await verifyGraph({
    verifiablePresentation: options.verifiablePresentation as Record<string, unknown>,
    publicKeys,
    challenge: options.challenge,
    ...(options.domain !== undefined ? { domain: options.domain } : {}),
    expectedRangeClaims: options.expectedRangeClaims ?? [],
    expectedMembershipClaims: options.expectedMembershipClaims ?? [],
    expectedNonRevocationClaims,
    expectedEqualities: options.expectedEqualities ?? [],
    documentLoader: credkitDocumentLoader,
  });
  if (!result.verified || result.documents === undefined) {
    return { verified: false, error: result.reason ?? 'presentation verification failed' };
  }

  // 3. Per-statement application policy over the now-authenticated documents.
  const wireCredentials = (options.verifiablePresentation as Record<string, unknown>)[
    'verifiableCredential'
  ];
  for (const [i, document] of result.documents.entries()) {
    const expectedIssuer = options.expectedIssuerDids[i];
    if (expectedIssuer === undefined) {
      // Unreachable: verifyGraph enforces credentials.length === publicKeys.length.
      return { verified: false, error: `No expected issuer configured for statement ${i}.` };
    }

    const issuer = document['issuer'];
    const issuerId =
      typeof issuer === 'string'
        ? issuer
        : typeof issuer === 'object' && issuer !== null && !Array.isArray(issuer)
          ? (issuer as Record<string, unknown>)['id']
          : undefined;
    if (issuerId !== expectedIssuer) {
      return {
        verified: false,
        error: `Issuer mismatch: expected "${expectedIssuer}", credential issued by "${String(issuerId)}".`,
      };
    }

    // The wire proof's verificationMethod is covered by the BBS header
    // (recanonicalized at verify), so after crypto success it is exactly
    // what the issuer signed — bind it to the expected issuer DID.
    const wire = Array.isArray(wireCredentials) ? wireCredentials[i] : undefined;
    const proof =
      typeof wire === 'object' && wire !== null
        ? (wire as Record<string, unknown>)['proof']
        : undefined;
    const proofs = Array.isArray(proof) ? proof : proof ? [proof] : [];
    const boundToIssuer = proofs.some((entry) => {
      const vm =
        typeof entry === 'object' && entry !== null
          ? (entry as Record<string, unknown>)['verificationMethod']
          : undefined;
      return (
        typeof vm === 'string' && (vm === expectedIssuer || vm.startsWith(`${expectedIssuer}#`))
      );
    });
    if (!boundToIssuer) {
      return {
        verified: false,
        error: `Proof verification method is not controlled by expected issuer "${expectedIssuer}".`,
      };
    }

    const validityError = checkValidityPeriod(document as VerifiableCredential, options.now);
    if (validityError !== undefined) {
      return { verified: false, error: validityError };
    }
  }

  return { verified: true, documents: result.documents as VerifiableCredential[] };
}

/**
 * Checks `validFrom <= now <= validUntil` for whichever bounds the revealed
 * document carries (both are mandatory-disclosed on VGW credentials). Same
 * semantics and messages as the bbs-2023 facade's check.
 */
function checkValidityPeriod(
  credential: VerifiableCredential,
  now?: Date | string,
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

/** Claim counts a VP's envelope declares (see {@link summarizeCredkitPresentation}). */
export interface CredkitPresentationSummary {
  rangeClaims: number;
  membershipClaims: number;
  nonRevocationClaims: number;
  equalities: number;
}

/**
 * Count the claims a VP's envelope carries — the D.2 route peek. Counts
 * only, no trust decisions: the verifier uses them to pick WHICH of its own
 * expectation sets to restate before `verifyCredkitPresentation`; the wire
 * never supplies a bound, a param, or an equality. Throws on a malformed
 * envelope — callers treat that as an invalid presentation.
 */
export function summarizeCredkitPresentation(
  verifiablePresentation: VerifiablePresentation,
): CredkitPresentationSummary {
  const proof = (verifiablePresentation as Record<string, unknown>)['proof'];
  if (typeof proof !== 'object' || proof === null || Array.isArray(proof)) {
    throw new Error('summarizeCredkitPresentation: the presentation has no proof object');
  }
  const proofValue = (proof as Record<string, unknown>)['proofValue'];
  if (typeof proofValue !== 'string') {
    throw new Error('summarizeCredkitPresentation: the presentation proof has no proofValue');
  }
  const envelope = parsePresentationEnvelope(proofValue);
  return {
    rangeClaims: envelope.rangeClaims.length,
    membershipClaims: envelope.membershipClaims.length,
    nonRevocationClaims: envelope.accumulatorClaims.length,
    equalities: envelope.equalities.length,
  };
}

function baseProofValue(credential: VerifiableCredential): string {
  const proof = credential.proof;
  const single = Array.isArray(proof) ? proof[0] : proof;
  const proofValue =
    typeof single === 'object' && single !== null
      ? (single as Record<string, unknown>)['proofValue']
      : undefined;
  if (typeof proofValue !== 'string') {
    throw new Error('This credential carries no credkit base proof');
  }
  return proofValue;
}

/**
 * The numeric twins a credkit credential DECLARES — parsed from its own base
 * proof, where the (pointer, encoder) pairs are signature-bound metadata.
 * This is what the wallet checks a verifier's predicate paths against: a
 * range claim over an undeclared pointer is structurally unanswerable.
 * Throws when the credential does not carry a credkit base proof.
 */
export function credkitNumericDeclarations(
  credential: VerifiableCredential,
): readonly NumericDeclarationEntry[] {
  return parseBaseProofValue(baseProofValue(credential)).numericDecl;
}

/**
 * Whether a credkit credential's base proof is holder-bound (blind-signed
 * over a link-secret commitment) or baseline. Every VGW v3 credential is
 * holder-bound — presenting one REQUIRES the holder binding. Throws when the
 * credential does not carry a credkit base proof.
 */
export function credkitProofMode(credential: VerifiableCredential): ProofMode {
  return parseBaseProofValue(baseProofValue(credential)).mode;
}

// Re-exported so verifiers/wallet type their expectations and claims through
// the facade, never importing @credkit/* directly. (NumericDeclarationEntry
// already rides through ./credkit.js.) `getEncoder` is credkit's registry of
// twin encoders — verifiers use `getEncoder('date1900').encode(cutoffIso)`
// to turn a calendar cutoff into the bound's encoder units, and the wallet
// uses the same registry to render consent descriptions from declared twins.
export { getEncoder };
export type {
  ExpectedMembershipClaim,
  ExpectedRangeClaim,
  GraphEquality,
  MembershipClaimRequest,
  NumericEncoder,
  ProofMode,
  RangeClaimRequest,
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
