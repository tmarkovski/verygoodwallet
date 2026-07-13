/**
 * IndexedDB persistence ('vgw' database, v1) via `idb`.
 *
 * - `accounts`   — passkey accounts. The credential id and PRF capability are
 *                  plaintext; a `simulatedSecret` exists only for accounts
 *                  whose authenticator lacks PRF support.
 * - `credentials`— stored credentials. `payload` is the `encryptJson` output
 *                  of the full `{ vc, commitmentOpening? }` envelope under
 *                  the vault key; only `meta` is plaintext, for list
 *                  rendering while the wallet is locked.
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

/** Private opening of the birthdate commitment (for the ZK tier, M4). */
export interface CommitmentOpening {
  /** Committed value: birth date as days since the Unix epoch. */
  value: number;
  /** 0x-hex blinding factor. */
  blinding: string;
  /** 0x-hex Poseidon commitment (also present, signed, inside the VC). */
  commitment: string;
}

/** The JSON envelope encrypted into `CredentialRecord.payload`. */
export interface CredentialPayload {
  vc: VerifiableCredential;
  commitmentOpening?: CommitmentOpening;
}

export interface CredentialRecord {
  id: number;
  accountId: number;
  meta: CredentialMeta;
  /** `encryptJson(vaultKey, CredentialPayload)` output. */
  payload: string;
}

export type NewCredentialRecord = Omit<CredentialRecord, "id">;

interface VgwSchema extends DBSchema {
  accounts: { key: number; value: AccountRecord };
  credentials: {
    key: number;
    value: CredentialRecord;
    indexes: { accountId: number };
  };
}

const DB_NAME = "vgw";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<VgwSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<VgwSchema>> {
  if (dbPromise === null) {
    const promise = openDB<VgwSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("accounts", { keyPath: "id", autoIncrement: true });
        const credentials = db.createObjectStore("credentials", {
          keyPath: "id",
          autoIncrement: true,
        });
        credentials.createIndex("accountId", "accountId");
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
