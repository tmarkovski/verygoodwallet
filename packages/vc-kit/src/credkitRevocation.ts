/**
 * credkit revocation facade — the ONLY path through which VGW apps touch
 * `@credkit/accumulator` (house pattern: apps import vc-kit facades, never
 * credkit directly). Suite-pinned to `credkit-bbs-sha-2026` like everything
 * else in the facade.
 *
 * The scheme (credkit FINDINGS §18/§19) in VGW terms:
 *
 * - The DMV runs ONE revocation registry for all its credentials: a VB
 *   positive accumulator whose trapdoor alpha derives DETERMINISTICALLY from
 *   the issuer's secret seed (`deriveRevocationRegistryAuthority` — the same
 *   seeded-KDF trick as `mintSeededRangeParams`, so every isolate holds the
 *   same alpha with zero storage). Only the mutable side — the current
 *   accumulator value, the epoch counter, the published per-epoch update
 *   records — lives in the registry Durable Object.
 *
 * - Each credential carries a `credentialStatus` with a hidden `revocationId`
 *   (an `frScalar` numeric twin — signed, NEVER disclosed; disclosure is
 *   structurally refused by credkit) and the registry URL (issuer-wide,
 *   harmless). The wallet holds the membership witness as SIDECAR state next
 *   to the credential: it mutates every revocation epoch and is refreshed
 *   from the registry's published updates only — syncing reads the same
 *   static records every other holder reads, so it is not a correlation
 *   event.
 *
 * - Issuance never changes the accumulator (additions-static): enrolling a
 *   credential publishes nothing and forces no holder updates. Only
 *   REVOCATION moves the value and appends an update record; a holder whose
 *   id was revoked finds out because the witness update THROWS — that
 *   failure is the revocation semantics, not an error path.
 *
 * - At presentation the wallet attaches a non-revocation claim (witness +
 *   the registry state it refreshed against); the verifier restates the SAME
 *   registry state from its own fetch. Stale or fabricated state fails the
 *   merged Fiat–Shamir challenge, never a policy check. The verifier learns
 *   one bit: "not revoked as of epoch N" — never the id, never the witness.
 *
 * Trust model: alpha's holder (the DMV) can forge or refresh any witness —
 * exactly the authority a revocation registry already has. What it cannot do
 * is link presentations: the id never appears in one.
 */
import {
  createAccumulator,
  createAccumulatorKeyPair,
  issueMembershipWitness,
  octetsToAccumulatorParams,
  octetsToRegistryUpdate,
  registryUpdateToOctets,
  revoke,
  RevokedError,
  updateMembershipWitness,
  verifyMembershipWitness,
  type RegistryUpdate,
} from '@credkit/accumulator';
import { g1FromBytes, mockRandomScalars } from '@credkit/bbs';
import {
  BLS12_381_FR_ORDER,
  createRevocationId,
  type NumericDeclarationEntry,
} from '@credkit/cryptosuite';
import { credkitCiphersuite } from './keys.js';
import { base64UrlToBytes, bytesToBase64Url } from './encoding.js';
import type { VerifiableCredential } from './types.js';

/**
 * The one JSON pointer every VGW revocable credential uses for its hidden
 * revocation id, and the numeric declaration that makes it a twin. Append
 * {@link REVOCATION_NUMERIC_DECLARATION} to the credential's declarations at
 * issuance; without it the credential can never carry a non-revocation
 * claim.
 */
export const REVOCATION_CLAIM_POINTER = '/credentialStatus/revocationId';

export const REVOCATION_NUMERIC_DECLARATION: NumericDeclarationEntry = {
  pointer: REVOCATION_CLAIM_POINTER,
  encoder: 'frScalar',
};

// ---------------------------------------------------------------------------
// Registry authority (DMV worker) — everything that needs the trapdoor
// ---------------------------------------------------------------------------

/** The registry authority's in-memory state. `secretKey` never serializes. */
export interface CredkitRevocationRegistryAuthority {
  /** alpha — the registry trapdoor. Held in memory only, like the BBS key. */
  secretKey: bigint;
  /** The published registry public key (96-byte G2, base64url). */
  paramsBase64Url: string;
}

/** Options for {@link deriveRevocationRegistryAuthority}. */
export interface DeriveRevocationRegistryAuthorityOptions {
  /** The issuer's SECRET seed (same trust level as the BBS signing seed). */
  seed: string;
  /**
   * App-specific domain-separation tag, e.g.
   * `VGW-DMV-CREDKIT-REVOCATION-KEY-V1` — MUST differ from every other DST
   * the same seed feeds (range params, set params, the seeded accumulator).
   */
  dst: string;
}

/**
 * Deterministically derive the registry trapdoor + public key from a secret
 * seed (suite pinned). Same seed + DST ⇒ the same alpha on every isolate and
 * cold start — the registry authority needs zero key storage, mirroring the
 * DMV's seed-derived BBS keys. Rotating the seed rotates the registry and
 * orphans every issued witness.
 */
export function deriveRevocationRegistryAuthority(
  options: DeriveRevocationRegistryAuthorityOptions,
): CredkitRevocationRegistryAuthority {
  const suite = credkitCiphersuite();
  const { secretKey, params } = createAccumulatorKeyPair(suite, {
    randomScalars: mockRandomScalars(suite, options.seed, options.dst),
  });
  return {
    secretKey,
    paramsBase64Url: bytesToBase64Url(params.publicKey.toBytes()),
  };
}

/** Options for {@link createSeededRevocationAccumulator}. */
export interface CreateSeededRevocationAccumulatorOptions {
  /** The issuer's SECRET seed. */
  seed: string;
  /** Distinct DST, e.g. `VGW-DMV-CREDKIT-REVOCATION-ACCUMULATOR-V1`. */
  dst: string;
}

/**
 * The registry's initial accumulator value V0 (48-byte G1, base64url),
 * derived deterministically so a wiped dev Durable Object re-initializes to
 * the identical value. The exponent behind V0 is known to the seed holder —
 * harmless here: the same party holds alpha, which is strictly more power.
 */
export function createSeededRevocationAccumulator(
  options: CreateSeededRevocationAccumulatorOptions,
): string {
  const suite = credkitCiphersuite();
  const value = createAccumulator(suite, {
    randomScalars: mockRandomScalars(suite, options.seed, options.dst),
  });
  return bytesToBase64Url(value.toBytes());
}

/**
 * A fresh revocation id for one credential: a uniform Fr scalar, plus the
 * canonical decimal lexical form that goes into the credential's
 * `credentialStatus.revocationId` (and nowhere else — it is signed as a
 * hidden twin and never disclosed).
 */
export function mintRevocationId(): { revocationId: bigint; lexical: string } {
  return createRevocationId();
}

/** Options for {@link issueRevocationWitness}. */
export interface IssueRevocationWitnessOptions {
  authority: CredkitRevocationRegistryAuthority;
  /** The CURRENT accumulator value (base64url) from the registry store. */
  accumulator: string;
  /** The credential's revocation id, canonical decimal lexical form. */
  revocationId: string;
}

/**
 * C = (1/(y+alpha))·V — the membership witness handed to the wallet at
 * issuance (registry-authority operation). Additions-static: the accumulator
 * value does not move and nothing is published.
 */
export function issueRevocationWitness(options: IssueRevocationWitnessOptions): string {
  const suite = credkitCiphersuite();
  const witness = issueMembershipWitness(
    suite,
    options.authority.secretKey,
    g1FromBytes(suite, base64UrlToBytes(options.accumulator), 'registry accumulator'),
    revocationIdScalar(options.revocationId),
  );
  return bytesToBase64Url(witness.toBytes());
}

/** Options for {@link revokeRevocationIds}. */
export interface RevokeRevocationIdsOptions {
  authority: CredkitRevocationRegistryAuthority;
  /** The CURRENT accumulator value (base64url) from the registry store. */
  accumulator: string;
  /** The ids to revoke this epoch, canonical decimal lexical forms. */
  revocationIds: readonly string[];
  /** The epoch number AFTER this batch applies (current epoch + 1). */
  epoch: number;
}

/** Result of {@link revokeRevocationIds} — the registry store's next state. */
export interface RevokeRevocationIdsResult {
  epoch: number;
  /** The accumulator value after the removals (base64url). */
  accumulator: string;
  /** The published epoch record (base64url) — holders update from this. */
  update: string;
}

/**
 * Revoke a batch of ids: V' = (1/∏(y_i+alpha))·V plus the epoch's published
 * Ω record (registry-authority operation). Batch one epoch's revocations
 * into ONE call — per-id epochs leak revocation ordering.
 */
export function revokeRevocationIds(
  options: RevokeRevocationIdsOptions,
): RevokeRevocationIdsResult {
  const suite = credkitCiphersuite();
  const update = revoke(
    suite,
    options.authority.secretKey,
    g1FromBytes(suite, base64UrlToBytes(options.accumulator), 'registry accumulator'),
    options.revocationIds.map(revocationIdScalar),
    options.epoch,
  );
  return {
    epoch: update.epoch,
    accumulator: bytesToBase64Url(update.value.toBytes()),
    update: bytesToBase64Url(registryUpdateToOctets(suite, update)),
  };
}

// ---------------------------------------------------------------------------
// The published registry state — what `GET <registry URL>` returns
// ---------------------------------------------------------------------------

/**
 * The registry's public state document. Everything here is published data:
 * the same bytes for every reader, cacheable, no per-holder responses (a
 * per-holder registry response would be a correlation event).
 */
export interface RevocationRegistryState {
  /** The registry public key (96-byte G2, base64url) — a trust anchor. */
  params: string;
  /** The current accumulator value (48-byte G1, base64url). */
  accumulator: string;
  /** The current epoch: 0 initially, +1 per revocation batch. */
  epoch: number;
  /**
   * One published record per revocation epoch, in epoch order (`updates[i]`
   * is epoch `i+1`). A holder at epoch `e` applies the records after index
   * `e-1` to bring its witness current.
   */
  updates: readonly string[];
}

/**
 * Fail-closed validation of a fetched registry state document: shape,
 * point/record decodability, epoch continuity, and the accumulator's
 * equality with the last update's value. Throws on any disagreement —
 * callers treat that as "registry unavailable", never as "not revoked".
 */
export function parseRevocationRegistryState(document: unknown): RevocationRegistryState {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error('revocation registry state: not an object');
  }
  const record = document as Record<string, unknown>;
  const { params, accumulator, epoch, updates } = record;
  if (typeof params !== 'string' || typeof accumulator !== 'string') {
    throw new Error('revocation registry state: params/accumulator must be strings');
  }
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error('revocation registry state: bad epoch');
  }
  if (!Array.isArray(updates) || updates.some((u) => typeof u !== 'string')) {
    throw new Error('revocation registry state: updates must be an array of strings');
  }
  if (updates.length !== epoch) {
    throw new Error(
      `revocation registry state: epoch ${epoch} disagrees with ${updates.length} update records`,
    );
  }
  const suite = credkitCiphersuite();
  octetsToAccumulatorParams(base64UrlToBytes(params));
  let value = g1FromBytes(suite, base64UrlToBytes(accumulator), 'registry accumulator');
  const decoded = (updates as string[]).map((u) =>
    octetsToRegistryUpdate(suite, base64UrlToBytes(u)),
  );
  for (const [i, update] of decoded.entries()) {
    if (update.epoch !== i + 1) {
      throw new Error(
        `revocation registry state: update ${i} carries epoch ${update.epoch}, expected ${i + 1}`,
      );
    }
  }
  const last = decoded[decoded.length - 1];
  if (last !== undefined && !last.value.equals(value)) {
    throw new Error(
      'revocation registry state: accumulator disagrees with the last update record',
    );
  }
  return { params, accumulator, epoch, updates: [...(updates as string[])] };
}

// ---------------------------------------------------------------------------
// Holder side (wallet) — witness upkeep from published data only
// ---------------------------------------------------------------------------

/** Options for {@link refreshRevocationWitness}. */
export interface RefreshRevocationWitnessOptions {
  /** The credential's revocation id, canonical decimal lexical form. */
  revocationId: string;
  /** The stored witness (base64url) and the epoch it is valid against. */
  witness: string;
  epoch: number;
  /** The registry's current state (validated — see the parse helper). */
  state: RevocationRegistryState;
}

/** Result of {@link refreshRevocationWitness}. */
export type RefreshRevocationWitnessResult =
  | {
      revoked: false;
      /** The witness valid against `state.accumulator` (base64url). */
      witness: string;
      epoch: number;
      /** True when epochs were applied — persist the new witness. */
      changed: boolean;
    }
  | {
      /** The registry revoked this id. Terminal: no valid witness exists. */
      revoked: true;
    };

/**
 * Bring a stored witness current against fetched registry state, applying
 * only the published epoch records (holder operation — no per-holder
 * requests, so syncing is not a correlation event; a holder offline for any
 * number of epochs pays one combined update). `revoked: true` is the
 * discovery that a revocation batch removed THIS id — expected, terminal,
 * and exactly what the wallet should surface as "this credential has been
 * revoked".
 */
export function refreshRevocationWitness(
  options: RefreshRevocationWitnessOptions,
): RefreshRevocationWitnessResult {
  const suite = credkitCiphersuite();
  const pending: RegistryUpdate[] = [];
  for (const encoded of options.state.updates) {
    const update = octetsToRegistryUpdate(suite, base64UrlToBytes(encoded));
    if (update.epoch > options.epoch) pending.push(update);
  }
  if (pending.length === 0) {
    return { revoked: false, witness: options.witness, epoch: options.epoch, changed: false };
  }
  try {
    const updated = updateMembershipWitness(
      suite,
      revocationIdScalar(options.revocationId),
      g1FromBytes(suite, base64UrlToBytes(options.witness), 'revocation witness'),
      pending,
    );
    return {
      revoked: false,
      witness: bytesToBase64Url(updated.toBytes()),
      epoch: options.state.epoch,
      changed: true,
    };
  } catch (error) {
    if (error instanceof RevokedError) return { revoked: true };
    throw error;
  }
}

/** Options for {@link verifyRevocationWitness}. */
export interface VerifyRevocationWitnessOptions {
  /** The registry public key (base64url) — from validated registry state. */
  params: string;
  /** The accumulator value the witness should hold against (base64url). */
  accumulator: string;
  /** The credential's revocation id, canonical decimal lexical form. */
  revocationId: string;
  /** The witness to check (base64url). */
  witness: string;
}

/**
 * The pairing check e(C, y·G2 + Q̃) == e(V, G2) — true iff the witness is
 * valid for this id against this accumulator value. Run it after issuance
 * (receipt hygiene) and after refreshes; it never throws, `false` covers
 * every malformed input.
 */
export function verifyRevocationWitness(options: VerifyRevocationWitnessOptions): boolean {
  try {
    const suite = credkitCiphersuite();
    return verifyMembershipWitness(
      suite,
      octetsToAccumulatorParams(base64UrlToBytes(options.params)),
      g1FromBytes(suite, base64UrlToBytes(options.accumulator), 'registry accumulator'),
      revocationIdScalar(options.revocationId),
      g1FromBytes(suite, base64UrlToBytes(options.witness), 'revocation witness'),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Non-revocation claims — the wire-friendly shapes the presentation facade
// decodes (apps never hold curve points; base64url strings end to end)
// ---------------------------------------------------------------------------

/**
 * One non-revocation claim as VGW apps state it: the registry state the
 * proof binds to, every field base64url/JSON-plain. The PROVER fills it from
 * the state it refreshed against; the VERIFIER restates it from its own
 * fetch — when they disagree the proof fails the merged challenge.
 */
export interface CredkitNonRevocationClaim {
  /** The credential's declared frScalar pointer — {@link REVOCATION_CLAIM_POINTER}. */
  pointer: string;
  /** The registry public key (base64url). */
  params: string;
  /** The accumulator value being proven against (base64url). */
  accumulator: string;
  /** The registry epoch that value belongs to. */
  epoch: number;
}

/** The prover's side: the claim plus the current witness (base64url). */
export interface CredkitNonRevocationProveInput extends CredkitNonRevocationClaim {
  witness: string;
}

/** The verifier's side: the claim pinned to a statement index. */
export interface CredkitExpectedNonRevocationClaim extends CredkitNonRevocationClaim {
  /** Which credential statement (0-based, statement order) must carry it. */
  statement: number;
}

/**
 * Decode a wire-shaped prove input to credkit's typed form. Internal to the
 * facade (credkitPresentation.ts calls it); validating — every point is
 * subgroup-checked, identity rejected.
 */
export function decodeNonRevocationProveInput(input: CredkitNonRevocationProveInput): {
  pointer: string;
  params: ReturnType<typeof octetsToAccumulatorParams>;
  accumulator: ReturnType<typeof g1FromBytes>;
  epoch: number;
  witness: ReturnType<typeof g1FromBytes>;
} {
  const suite = credkitCiphersuite();
  return {
    pointer: input.pointer,
    params: octetsToAccumulatorParams(base64UrlToBytes(input.params)),
    accumulator: g1FromBytes(suite, base64UrlToBytes(input.accumulator), 'claim accumulator'),
    epoch: input.epoch,
    witness: g1FromBytes(suite, base64UrlToBytes(input.witness), 'claim witness'),
  };
}

/** Decode a wire-shaped expected claim to credkit's typed form (see above). */
export function decodeExpectedNonRevocationClaim(input: CredkitExpectedNonRevocationClaim): {
  statement: number;
  pointer: string;
  params: ReturnType<typeof octetsToAccumulatorParams>;
  accumulator: ReturnType<typeof g1FromBytes>;
  epoch: number;
} {
  const suite = credkitCiphersuite();
  return {
    statement: input.statement,
    pointer: input.pointer,
    params: octetsToAccumulatorParams(base64UrlToBytes(input.params)),
    accumulator: g1FromBytes(suite, base64UrlToBytes(input.accumulator), 'claim accumulator'),
    epoch: input.epoch,
  };
}

// ---------------------------------------------------------------------------
// Credential readers
// ---------------------------------------------------------------------------

/** A credential's revocation coordinates, read from its credentialStatus. */
export interface CredentialRevocationStatus {
  /** The registry URL (issuer-wide — safe to fetch, safe to publish). */
  registry: string;
  /** The revocation id lexical — SECRET-ADJACENT: never leaves the wallet. */
  revocationId: string;
}

/**
 * Read the revocation coordinates from a credential's `credentialStatus`,
 * or `undefined` for a non-revocable credential. Tolerates status arrays;
 * picks the first VGW-shaped entry.
 */
export function credentialRevocationStatus(
  credential: VerifiableCredential,
): CredentialRevocationStatus | undefined {
  const raw = (credential as Record<string, unknown>)['credentialStatus'];
  const entries = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const status = entry as Record<string, unknown>;
    const registry = status['revocationRegistry'];
    const revocationId = status['revocationId'];
    if (typeof registry === 'string' && typeof revocationId === 'string') {
      return { registry, revocationId };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------

/**
 * The canonical decimal lexical form → Fr scalar, with the same acceptance
 * rules as credkit's `frScalar` encoder: plain digits, no leading zeros,
 * strictly below the Fr order. Anything else is a malformed id, refused.
 */
function revocationIdScalar(lexical: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(lexical)) {
    throw new Error(`revocation id: "${lexical}" is not a canonical unsigned integer`);
  }
  const value = BigInt(lexical);
  if (value >= BLS12_381_FR_ORDER) {
    throw new Error('revocation id: value is not below the Fr order');
  }
  return value;
}
