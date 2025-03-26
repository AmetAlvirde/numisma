/**
 * indexeddb-adapter.ts - IndexedDB database adapter service
 */

import {
  DB_NAME,
  DB_VERSION,
  STORE_CONFIGS,
  type DatabaseSchema,
  type StoreName,
  type IndexName,
} from "./indexeddb-schema";

export class DatabaseError extends Error {
  constructor(
    message: string,
    public originalError?: Error | DOMException | null
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

export class IndexedDBAdapter {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new DatabaseError("Failed to open database", request.error));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create stores and indexes
        Object.entries(STORE_CONFIGS).forEach(([storeName, config]) => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, {
              keyPath: config.keyPath,
            });

            config.indexes.forEach(index => {
              store.createIndex(index.name, index.keyPath, index.options);
            });
          }
        });
      };
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  async add<T extends StoreName>(
    storeName: T,
    item: DatabaseSchema[T]
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) throw new DatabaseError("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.add(item);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(new DatabaseError("Failed to add item", request.error));
      };
    });
  }

  async get<T extends StoreName>(
    storeName: T,
    key: string
  ): Promise<DatabaseSchema[T] | undefined> {
    await this.ensureInitialized();
    if (!this.db) throw new DatabaseError("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(new DatabaseError("Failed to get item", request.error));
      };
    });
  }

  async getAll<T extends StoreName>(
    storeName: T
  ): Promise<DatabaseSchema[T][]> {
    await this.ensureInitialized();
    if (!this.db) throw new DatabaseError("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(new DatabaseError("Failed to get all items", request.error));
      };
    });
  }

  async update<T extends StoreName>(
    storeName: T,
    item: DatabaseSchema[T]
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) throw new DatabaseError("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.put(item);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(new DatabaseError("Failed to update item", request.error));
      };
    });
  }

  async delete<T extends StoreName>(storeName: T, key: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) throw new DatabaseError("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(new DatabaseError("Failed to delete item", request.error));
      };
    });
  }

  async query<T extends StoreName, I extends IndexName<T>>(
    storeName: T,
    indexName: I,
    key: IDBValidKey | IDBKeyRange,
    direction: IDBCursorDirection = "next"
  ): Promise<DatabaseSchema[T][]> {
    await this.ensureInitialized();
    if (!this.db) throw new DatabaseError("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.openCursor(key, direction);

      const results: DatabaseSchema[T][] = [];

      request.onsuccess = event => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        reject(new DatabaseError("Failed to query items", request.error));
      };
    });
  }

  async clear<T extends StoreName>(storeName: T): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) throw new DatabaseError("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => {
        reject(new DatabaseError("Failed to clear store", request.error));
      };
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

// Export a singleton instance
export const db = new IndexedDBAdapter();
