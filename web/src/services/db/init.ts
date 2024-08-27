import { openDB, DBSchema, IDBPDatabase } from 'idb';

const DB_NAME = 'localDB';
const DB_VERSION = 2;

interface MyDB extends DBSchema {
  credentials: {
    key: number;
    value: {
      id?: number;
      userId: number;
      data: any;
    };
    indexes: { 'userId': number };
  };
  users: {
    key: number;
    value: {
      id?: number;
      // Add other user properties here
    };
  };
}

export const dbPromise = openDB<MyDB>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('credentials')) {
      const credentialsStore = db.createObjectStore('credentials', { keyPath: 'id', autoIncrement: true });
      credentialsStore.createIndex('userId', 'userId', { unique: false });
    }
    if (!db.objectStoreNames.contains('users')) {
      db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
    }
  }
});

export const getDb = async (): Promise<IDBPDatabase<MyDB>> => {
  return await dbPromise;
};