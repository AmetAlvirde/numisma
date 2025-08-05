"use client";

import { useState, useEffect, useCallback } from "react";

interface NetworkStatus {
  isOnline: boolean;
  isReconnecting: boolean;
  lastConnected: Date | null;
  connectionType: string | null;
}

export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    isReconnecting: false,
    lastConnected:
      typeof navigator !== "undefined" && navigator.onLine ? new Date() : null,
    connectionType: null,
  });

  const updateConnectionType = useCallback(() => {
    if (typeof navigator !== "undefined" && "connection" in navigator) {
      const connection = (
        navigator as { connection?: { effectiveType?: string; type?: string } }
      ).connection;
      setStatus(prev => ({
        ...prev,
        connectionType: connection?.effectiveType || connection?.type || null,
      }));
    }
  }, []);

  const handleOnline = useCallback(() => {
    setStatus(prev => ({
      ...prev,
      isOnline: true,
      isReconnecting: false,
      lastConnected: new Date(),
    }));
    updateConnectionType();
  }, [updateConnectionType]);

  const handleOffline = useCallback(() => {
    setStatus(prev => ({
      ...prev,
      isOnline: false,
      isReconnecting: false,
    }));
  }, []);

  const handleConnectionChange = useCallback(() => {
    updateConnectionType();
  }, [updateConnectionType]);

  const testConnection = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return true;

    setStatus(prev => ({ ...prev, isReconnecting: true }));

    try {
      // Test connection with a lightweight request
      const response = await fetch("/api/health", {
        method: "HEAD",
        cache: "no-cache",
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      const isConnected = response.ok;

      setStatus(prev => ({
        ...prev,
        isOnline: isConnected,
        isReconnecting: false,
        lastConnected: isConnected ? new Date() : prev.lastConnected,
      }));

      return isConnected;
    } catch (error) {
      console.warn("Connection test failed:", error);
      setStatus(prev => ({
        ...prev,
        isOnline: false,
        isReconnecting: false,
      }));
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Initial connection type check
    updateConnectionType();

    // Add event listeners
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for connection changes
    if ("connection" in navigator) {
      const connection = (
        navigator as {
          connection?: {
            addEventListener?: (event: string, handler: () => void) => void;
          };
        }
      ).connection;
      connection?.addEventListener?.("change", handleConnectionChange);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);

      if ("connection" in navigator) {
        const connection = (
          navigator as {
            connection?: {
              removeEventListener?: (
                event: string,
                handler: () => void
              ) => void;
            };
          }
        ).connection;
        connection?.removeEventListener?.("change", handleConnectionChange);
      }
    };
  }, [
    handleOnline,
    handleOffline,
    handleConnectionChange,
    updateConnectionType,
  ]);

  return {
    ...status,
    testConnection,
  };
}

// Retry hook with exponential backoff
export function useRetryWithBackoff() {
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const networkStatus = useNetworkStatus();

  const calculateDelay = useCallback(
    (attempt: number, baseDelay = 1000): number => {
      // Exponential backoff with jitter
      const exponentialDelay = Math.min(
        baseDelay * Math.pow(2, attempt),
        30000
      );
      const jitter = Math.random() * 0.1 * exponentialDelay;
      return exponentialDelay + jitter;
    },
    []
  );

  const retry = useCallback(
    async <T>(
      operation: () => Promise<T>,
      options: {
        maxAttempts?: number;
        baseDelay?: number;
        onRetry?: (attempt: number, error: Error) => void;
        shouldRetry?: (error: Error, attempt: number) => boolean;
      } = {}
    ): Promise<T> => {
      const {
        maxAttempts = 3,
        baseDelay = 1000,
        onRetry,
        shouldRetry = (error: Error, attempt: number) => {
          // Don't retry client errors (4xx)
          const errorWithData = error as Error & {
            data?: { httpStatus?: number };
          };
          if (
            errorWithData?.data?.httpStatus &&
            errorWithData.data.httpStatus >= 400 &&
            errorWithData.data.httpStatus < 500
          ) {
            return false;
          }
          return attempt < maxAttempts;
        },
      } = options;

      setIsRetrying(true);

      let lastError: Error;

      for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        try {
          setRetryAttempt(attempt);

          // Check network status before retrying
          if (!networkStatus.isOnline && attempt > 0) {
            const isConnected = await networkStatus.testConnection();
            if (!isConnected) {
              throw new Error("Network unavailable");
            }
          }

          const result = await operation();
          setIsRetrying(false);
          setRetryAttempt(0);
          return result;
        } catch (error) {
          lastError = error as Error;

          console.warn(`Attempt ${attempt + 1} failed:`, error);

          if (attempt < maxAttempts && shouldRetry(lastError, attempt)) {
            onRetry?.(attempt + 1, lastError);

            // Wait before next attempt
            const delay = calculateDelay(attempt, baseDelay);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            break;
          }
        }
      }

      setIsRetrying(false);
      setRetryAttempt(0);
      throw lastError!;
    },
    [networkStatus, calculateDelay]
  );

  const reset = useCallback(() => {
    setRetryAttempt(0);
    setIsRetrying(false);
  }, []);

  return {
    retry,
    reset,
    retryAttempt,
    isRetrying,
    networkStatus,
  };
}
