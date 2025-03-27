/**
 * Database operations for Numisma
 *
 * This module handles all IndexedDB operations for the application.
 * It provides functions to initialize the database and perform CRUD operations.
 */

const DB_NAME = "numisma";
const DB_VERSION = 1;

interface PortfolioData {
  portfolio: any;
  positions: any[];
  portfolioPositions: any[];
  historicalValuations: any[];
}

/**
 * Check if we're in a browser environment
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

/**
 * Initialize the IndexedDB database
 */
export async function initDB(): Promise<IDBDatabase> {
  if (!isBrowser()) {
    throw new Error("IndexedDB is only available in browser environments");
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("Failed to open database"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create a single object store for portfolios that will contain all the data
      if (!db.objectStoreNames.contains("portfolios")) {
        db.createObjectStore("portfolios", { keyPath: "id" });
      }
    };
  });
}

/**
 * Save portfolio data to IndexedDB
 */
export async function savePortfolioData(data: PortfolioData): Promise<void> {
  if (!isBrowser()) {
    throw new Error("IndexedDB is only available in browser environments");
  }

  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["portfolios"], "readwrite");

    transaction.onerror = () => {
      reject(new Error("Transaction failed"));
    };

    transaction.oncomplete = () => {
      resolve();
    };

    // Combine all data into a single portfolio object
    const portfolioStore = transaction.objectStore("portfolios");
    const portfolioWithData = {
      ...data.portfolio,
      positions: data.positions,
      portfolioPositions: data.portfolioPositions,
      historicalValuations: data.historicalValuations,
    };
    portfolioStore.put(portfolioWithData);
  });
}

/**
 * Get portfolio data from IndexedDB
 */
export async function getPortfolioData(
  portfolioId: string
): Promise<PortfolioData> {
  if (!isBrowser()) {
    throw new Error("IndexedDB is only available in browser environments");
  }

  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["portfolios"], "readonly");

    transaction.onerror = () => {
      reject(new Error("Transaction failed"));
    };

    const portfolioStore = transaction.objectStore("portfolios");
    const request = portfolioStore.get(portfolioId);

    request.onsuccess = () => {
      const portfolioData = request.result;
      if (!portfolioData) {
        reject(new Error(`Portfolio with ID ${portfolioId} not found`));
        return;
      }

      // Extract the data from the combined portfolio object
      const {
        positions,
        portfolioPositions,
        historicalValuations,
        ...portfolio
      } = portfolioData;

      resolve({
        portfolio,
        positions: positions || [],
        portfolioPositions: portfolioPositions || [],
        historicalValuations: historicalValuations || [],
      });
    };
  });
}
