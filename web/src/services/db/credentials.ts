import { getDb } from './init';

const STORE_NAME = 'credentials';

export type Credential = {
  id?: number;
  userId: number;
  data: any
};

export const addCredential = async (credential: Omit<Credential, 'id'>): Promise<Credential> => {
  const db = await getDb();
  const key = await db.add(STORE_NAME, credential);
  return { ...credential, id: key as number };
};

export const getCredentials = async (userId: number): Promise<Credential[]> => {
  const db = await getDb();
  const credentials = await db.getAllFromIndex(STORE_NAME, 'userId', userId);
  return credentials;
};

export const getCredential = async (id: number): Promise<Credential | undefined> => {
  const db = await getDb();
  return db.get(STORE_NAME, id);
};

export const updateCredential = async (credential: Credential): Promise<void> => {
  const db = await getDb();
  await db.put(STORE_NAME, credential);
};

export const removeCredential = async (id: number): Promise<void> => {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
};
