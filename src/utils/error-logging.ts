"use client";

interface ErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: string;
  userAgent: string;
  url: string;
  userId?: string;
  sessionId?: string;
  buildId?: string;
  environment: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "javascript" | "network" | "auth" | "data" | "ui";
  metadata?: Record<string, unknown>;
}

class ErrorLogger {
  private isProduction = process.env.NODE_ENV === "production";
  private apiEndpoint = "/api/errors";
  private maxRetries = 3;
  private retryDelay = 1000;

  /**
   * Log an error to the monitoring service
   */
  async logError(
    error: Error,
    context: {
      severity?: ErrorReport["severity"];
      category?: ErrorReport["category"];
      componentStack?: string;
      metadata?: Record<string, unknown>;
      userId?: string;
    } = {}
  ): Promise<void> {
    try {
      const errorReport: ErrorReport = {
        message: error.message,
        stack: error.stack,
        componentStack: context.componentStack,
        timestamp: new Date().toISOString(),
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : "server",
        url: typeof window !== "undefined" ? window.location.href : "server",
        userId: context.userId,
        sessionId: this.getSessionId(),
        buildId: process.env.NEXT_PUBLIC_BUILD_ID,
        environment: process.env.NODE_ENV || "development",
        severity: context.severity || this.determineSeverity(error),
        category: context.category || this.categorizeError(error),
        metadata: {
          ...context.metadata,
          timestamp: Date.now(),
        },
      };

      // In development, just log to console
      if (!this.isProduction) {
        console.error("Error logged:", errorReport);
        return;
      }

      // In production, send to monitoring service
      await this.sendToMonitoringService(errorReport);
    } catch (loggingError) {
      console.error("Failed to log error:", loggingError);
      // Fallback to console even in production if logging fails
      console.error("Original error:", error);
    }
  }

  /**
   * Log a network error with specific context
   */
  async logNetworkError(
    error: Error,
    request: {
      url: string;
      method: string;
      status?: number;
      responseTime?: number;
    },
    context: {
      isRetry?: boolean;
      retryAttempt?: number;
      userId?: string;
    } = {}
  ): Promise<void> {
    await this.logError(error, {
      severity: request.status && request.status >= 500 ? "high" : "medium",
      category: "network",
      metadata: {
        request,
        ...context,
      },
    });
  }

  /**
   * Log an authentication error
   */
  async logAuthError(
    error: Error,
    context: {
      action: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.logError(error, {
      severity: "high",
      category: "auth",
      metadata: {
        action: context.action,
        ...context.metadata,
      },
      userId: context.userId,
    });
  }

  /**
   * Log a data-related error (database, API, etc.)
   */
  async logDataError(
    error: Error,
    context: {
      operation: string;
      resource: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.logError(error, {
      severity: "medium",
      category: "data",
      metadata: {
        operation: context.operation,
        resource: context.resource,
        ...context.metadata,
      },
      userId: context.userId,
    });
  }

  /**
   * Log a UI/component error
   */
  async logUIError(
    error: Error,
    context: {
      component: string;
      action?: string;
      componentStack?: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.logError(error, {
      severity: "low",
      category: "ui",
      componentStack: context.componentStack,
      metadata: {
        component: context.component,
        action: context.action,
        ...context.metadata,
      },
      userId: context.userId,
    });
  }

  /**
   * Create a performance mark for timing critical operations
   */
  markStart(name: string): void {
    if (typeof performance !== "undefined") {
      performance.mark(`${name}-start`);
    }
  }

  /**
   * Measure performance and optionally log slow operations
   */
  markEnd(name: string, threshold = 1000): number | null {
    if (typeof performance === "undefined") return null;

    try {
      performance.mark(`${name}-end`);
      performance.measure(name, `${name}-start`, `${name}-end`);

      const measure = performance.getEntriesByName(name, "measure")[0];
      const duration = measure?.duration || 0;

      // Log slow operations
      if (duration > threshold) {
        this.logError(new Error(`Slow operation: ${name}`), {
          severity: "low",
          category: "ui",
          metadata: {
            operation: name,
            duration,
            threshold,
          },
        });
      }

      return duration;
    } catch (error) {
      console.warn("Performance measurement failed:", error);
      return null;
    }
  }

  private async sendToMonitoringService(
    errorReport: ErrorReport
  ): Promise<void> {
    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        const response = await fetch(this.apiEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(errorReport),
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          return; // Success
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        attempt++;

        if (attempt >= this.maxRetries) {
          throw new Error(
            `Failed to send error report after ${this.maxRetries} attempts: ${error}`
          );
        }

        // Wait before retrying
        await new Promise(resolve =>
          setTimeout(resolve, this.retryDelay * attempt)
        );
      }
    }
  }

  private determineSeverity(error: Error): ErrorReport["severity"] {
    const message = error.message.toLowerCase();

    if (message.includes("network") || message.includes("fetch")) {
      return "medium";
    }

    if (message.includes("auth") || message.includes("unauthorized")) {
      return "high";
    }

    if (message.includes("chunk") || message.includes("module")) {
      return "medium";
    }

    return "low";
  }

  private categorizeError(error: Error): ErrorReport["category"] {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || "";

    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("timeout")
    ) {
      return "network";
    }

    if (
      message.includes("auth") ||
      message.includes("unauthorized") ||
      message.includes("forbidden")
    ) {
      return "auth";
    }

    if (
      message.includes("database") ||
      message.includes("query") ||
      message.includes("trpc")
    ) {
      return "data";
    }

    if (stack.includes("react") || stack.includes("component")) {
      return "ui";
    }

    return "javascript";
  }

  private getSessionId(): string {
    if (typeof window === "undefined") return "server";

    // Try to get session ID from sessionStorage or generate one
    let sessionId = sessionStorage.getItem("error-logging-session-id");
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      sessionStorage.setItem("error-logging-session-id", sessionId);
    }

    return sessionId;
  }
}

// Global error logger instance
export const errorLogger = new ErrorLogger();

// Global error handler for unhandled errors
if (typeof window !== "undefined") {
  window.addEventListener("error", event => {
    errorLogger.logError(event.error || new Error(event.message), {
      severity: "medium",
      category: "javascript",
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        type: "unhandled-error",
      },
    });
  });

  window.addEventListener("unhandledrejection", event => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
    errorLogger.logError(error, {
      severity: "medium",
      category: "javascript",
      metadata: {
        type: "unhandled-promise-rejection",
      },
    });
  });
}

// Utility functions for common error logging patterns
export const logPortfolioError = (
  error: Error,
  context: string,
  userId?: string
) =>
  errorLogger.logDataError(error, {
    operation: context,
    resource: "portfolio",
    userId,
  });

export const logNetworkError = (
  error: Error,
  request: {
    url: string;
    method: string;
    status?: number;
    responseTime?: number;
  },
  userId?: string
) => errorLogger.logNetworkError(error, request, { userId });

export const logComponentError = (
  error: Error,
  component: string,
  userId?: string
) =>
  errorLogger.logUIError(error, {
    component,
    userId,
  });
