import { getDb } from './init';
import { IDBPTransaction } from 'idb';

const STORE_NAME = 'users';

export type User = {
  id: number;
  name: string;
  lastSeen: Date;
  credentialId: Uint8Array;
  simulatedMasterKey?: Uint8Array;
  supportedExtension: SecurityExtension;
  masterKeyCreated: boolean;
  controller?: string;
};

// enum for ExtensionSupperted
export enum SecurityExtension {
  PRF = 'prf',
  LARGEBLOB = 'largeblob',
  NONE = 'none'
}

export const addUser = async (user: Omit<User, 'id' | 'lastSeen'>): Promise<User> => {
  const u = {...user, lastSeen: new Date()}; // Convert Date to ISO string
  const db = await getDb();
  const key = await db.add(STORE_NAME, u as any);
  return {...u, id: key as number};
};

export const getUsers = async (): Promise<User[]> => {
  const db = await getDb();
  const results = await db.getAll(STORE_NAME);
  return results as User[];
};

export const updateUser = async (user: User): Promise<void> => {
  const db = await getDb();
  await db.put(STORE_NAME, user);
};

export const removeUser = async (userId: number): Promise<void> => {
  const db = await getDb();

  const tx = db.transaction(['users', 'credentials'], 'readwrite');
  
  try {
    // Delete the user
    await tx.objectStore('users').delete(userId);

    // Delete all credentials associated with the user
    const credentialStore = tx.objectStore('credentials');
    const userCredentials = await credentialStore.index('userId').getAll(userId);
    
    await Promise.all(userCredentials.map(async (credential) => {
      if (credential.id !== undefined) {
        await credentialStore.delete(credential.id);
      }
    }));

    await tx.done;
  } catch (error) {
    await tx.abort();
    throw error;
  }
};

export const getUser = async (userId: number): Promise<User | undefined> => {
  const db = await getDb();
  const user = await db.get(STORE_NAME, userId);
  return user as User | undefined;
};