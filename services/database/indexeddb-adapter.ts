/**
 * indexeddb-adapter.ts - IndexedDB adapter for data persistence
 */

import type { DatabaseSchema } from "./indexeddb-schema";
import { STORE_CONFIGS } from "./indexeddb-schema";

const DB_NAME = "numisma_db";
const DB_VERSION = 1;

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
  private isInitialized = false;

  constructor() {
    // Only initialize if we're in a browser environment
    if (typeof window !== "undefined") {
      this.initialize().catch(error => {
        console.error("Failed to initialize IndexedDB:", error);
      });
    }
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    return new Promise((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(
          new DatabaseError("IndexedDB is not available in this environment")
        );
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new DatabaseError("Failed to open database", request.error));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
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

            // Create indexes
            config.indexes.forEach(index => {
              store.createIndex(index.name, index.keyPath, index.options);
            });
          }
        });
      };
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  async add<T extends keyof DatabaseSchema>(
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

  async get<T extends keyof DatabaseSchema>(
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

  async getAll<T extends keyof DatabaseSchema>(
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

  async update<T extends keyof DatabaseSchema>(
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

  async delete<T extends keyof DatabaseSchema>(
    storeName: T,
    key: string
  ): Promise<void> {
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

  async query<T extends keyof DatabaseSchema>(
    storeName: T,
    indexName: string,
    value: any
  ): Promise<DatabaseSchema[T][]> {
    await this.ensureInitialized();
    if (!this.db) throw new DatabaseError("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(new DatabaseError("Failed to query items", request.error));
      };
    });
  }

  async clear<T extends keyof DatabaseSchema>(storeName: T): Promise<void> {
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
      this.isInitialized = false;
    }
  }
}

// Export a singleton instance
export const db = new IndexedDBAdapter();
