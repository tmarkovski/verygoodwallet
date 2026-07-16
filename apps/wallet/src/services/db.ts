/**
 * IndexedDB persistence ('vgw' database, DB_VERSION 3) via `idb`.
 *
 * - `accounts`     — passkey accounts. The credential id and PRF capability
 *                    are plaintext; a `simulatedSecret` exists only for
 *                    accounts whose authenticator lacks PRF support.
 * - `credentials`  — stored credentials. `payload` is the `encryptJson`
 *                    output of the versioned `CredentialPayload` envelope
 *                    (`{ version: 3, vc, secretProverBlind }`) under the
 *                    vault key; only `meta` is plaintext, for list rendering
 *                    while the wallet is locked.
 * - `presentations`— the presentation log (added at DB_VERSION 2, for the
 *                    cross-verifier exhibit): who was shown what, at which
 *                    tier. Fully encrypted — the log names verifiers and
 *                    disclosed values, so it is exactly as sensitive as the
 *                    credentials themselves.
 *
 * Version disambiguation (they share a number by coincidence, MIGRATION
 * Appendix B): the ENVELOPE `version: 3` is a field inside the encrypted
 * JSON payload naming its schema; the IndexedDB `DB_VERSION = 3` is the
 * database schema version that gates the `upgrade` callback. Bumping one
 * does not bump the other.
 */

import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from "idb";
import type { VerifiableCredential } from "@vgw/vc-kit";
import type { CredentialMeta } from "./meta";

export interface AccountRecord {
  id: number;
  name: string;
  credentialId: Uint8Array;
  prfSupported: boolean;
  /** Present only when PRF is unavailable: the simulated master secret. */
  simulatedSecret?: Uint8Array;
  createdAt: number;
  lastUsedAt: number;
}

export type NewAccountRecord = Omit<AccountRecord, "id">;

/**
 * The JSON envelope encrypted into `CredentialRecord.payload` — the
 * versioned v3 shape written since N2 (credkit blind issuance).
 *
 * `version: 3` is the ENVELOPE schema version (a payload field), distinct
 * from the IndexedDB `DB_VERSION` below. The link secret is deliberately
 * absent: it is re-derived from the passkey PRF, never stored. The
 * per-credential `secretProverBlind` IS stored — it is random at each
 * commit, not re-derivable, and losing it bricks the credential
 * (MIGRATION §6); passkey sync moves the master, not IndexedDB, so
 * cross-device recovery of the blind needs an explicit credential-store
 * export (unspecified N2 design point, MIGRATION §13).
 */
export interface CredentialPayload {
  version: 3;
  vc: VerifiableCredential;
  /** base64url of the 32-byte blind scalar (`scalarToBase64Url` in @vgw/keys). */
  secretProverBlind: string;
}

export interface CredentialRecord {
  id: number;
  accountId: number;
  meta: CredentialMeta;
  /** `encryptJson(vaultKey, CredentialPayload)` output. */
  payload: string;
}

export type NewCredentialRecord = Omit<CredentialRecord, "id">;

/** The JSON envelope encrypted into `PresentationRecord.payload`. */
export interface PresentationLogPayload {
  verifierOrigin: string;
  verifierName: string;
  /**
   * The presenter DID this verifier saw. Entries since N3 record "" — the
   * credkit presentation carries NO holder identifier of any kind; pre-N3
   * entries keep the pairwise DID they actually disclosed.
   */
  presenterDid: string;
  tier: 0 | 1 | 2;
  /** Claim → value exactly as consented (the disclosure preview). */
  disclosed: Record<string, unknown>;
  /** Present for tier 2: the age threshold proven (value never disclosed). */
  zkYears?: number;
  at: number;
}

export interface PresentationRecord {
  id: number;
  accountId: number;
  /** `encryptJson(vaultKey, PresentationLogPayload)` output. */
  payload: string;
}

export type NewPresentationRecord = Omit<PresentationRecord, "id">;

interface VgwSchema extends DBSchema {
  accounts: { key: number; value: AccountRecord };
  credentials: {
    key: number;
    value: CredentialRecord;
    indexes: { accountId: number };
  };
  presentations: {
    key: number;
    value: PresentationRecord;
    indexes: { accountId: number };
  };
}

const DB_NAME = "vgw";
/**
 * IndexedDB schema version — NOT the credential-envelope `version` (see the
 * module note): v3 is the N2 credkit cutover that cleared legacy records.
 */
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<VgwSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<VgwSchema>> {
  if (dbPromise === null) {
    const promise = openDB<VgwSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          db.createObjectStore("accounts", { keyPath: "id", autoIncrement: true });
          const credentials = db.createObjectStore("credentials", {
            keyPath: "id",
            autoIncrement: true,
          });
          credentials.createIndex("accountId", "accountId");
        }
        if (oldVersion < 2) {
          const presentations = db.createObjectStore("presentations", {
            keyPath: "id",
            autoIncrement: true,
          });
          presentations.createIndex("accountId", "accountId");
        }
        if (oldVersion >= 1 && oldVersion < 3) {
          // N2 credkit cutover (MIGRATION Appendix B): pre-v3 credential
          // records are opaque AES-GCM ciphertext of the legacy
          // `{ vc, commitmentOpening? }` envelope. This upgrade callback has
          // no vault key, so it CANNOT rewrite them — and even unlocked, a
          // legacy bbs-2023 credential contains no credkit blind to add.
          // They are incompatible with the credkit presentation flow and are
          // cleared here; users reissue from the DMV. Accounts and the
          // presentation log are untouched (their shapes are unchanged).
          void tx.objectStore("credentials").clear();
        }
      },
      // Another tab requested an upgrade or deleteDB. idb only auto-closes a
      // connection when `blocking` is provided, so without this a background
      // wallet tab would block `deleteAllData` forever. Release the
      // connection; the next getDb() call reopens.
      blocking() {
        void promise.then((db) => {
          db.close();
        });
        if (dbPromise === promise) dbPromise = null;
      },
    });
    // Never cache a failed open: a later call should retry instead of
    // rejecting forever from the same cached promise.
    promise.catch(() => {
      if (dbPromise === promise) dbPromise = null;
    });
    dbPromise = promise;
  }
  return dbPromise;
}

export async function addAccount(input: NewAccountRecord): Promise<AccountRecord> {
  const db = await getDb();
  // autoIncrement keyPath: the store assigns `id`; the input legitimately omits it.
  const id = await db.add("accounts", input as AccountRecord);
  return { ...input, id };
}

export async function listAccounts(): Promise<AccountRecord[]> {
  const db = await getDb();
  return db.getAll("accounts");
}

export async function getAccount(id: number): Promise<AccountRecord | undefined> {
  const db = await getDb();
  return db.get("accounts", id);
}

export async function updateAccount(record: AccountRecord): Promise<AccountRecord> {
  const db = await getDb();
  await db.put("accounts", record);
  return record;
}

export async function addCredential(
  input: NewCredentialRecord,
): Promise<CredentialRecord> {
  const db = await getDb();
  const id = await db.add("credentials", input as CredentialRecord);
  return { ...input, id };
}

export async function listCredentials(accountId: number): Promise<CredentialRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex("credentials", "accountId", accountId);
}

export async function getCredential(id: number): Promise<CredentialRecord | undefined> {
  const db = await getDb();
  return db.get("credentials", id);
}

export async function deleteCredential(id: number): Promise<void> {
  const db = await getDb();
  await db.delete("credentials", id);
}

export async function addPresentation(
  input: NewPresentationRecord,
): Promise<PresentationRecord> {
  const db = await getDb();
  const id = await db.add("presentations", input as PresentationRecord);
  return { ...input, id };
}

export async function listPresentations(
  accountId: number,
): Promise<PresentationRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex("presentations", "accountId", accountId);
}

/**
 * Danger zone: drop the whole 'vgw' database.
 *
 * Other wallet tabs release their connections via the `blocking` handler in
 * `getDb`, but a connection this code doesn't control (e.g. a tab running an
 * older build) can still hold the database open — then `deleteDB` waits until
 * that connection closes. `onBlocked` fires in that case so the UI can tell
 * the user to close other tabs instead of appearing to hang.
 */
export async function deleteAllData(onBlocked?: () => void): Promise<void> {
  if (dbPromise !== null) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await deleteDB(DB_NAME, { blocked: () => onBlocked?.() });
}
