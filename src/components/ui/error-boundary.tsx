"use client";

import React, { Component, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, Home, Bug } from "lucide-react";

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  showErrorDetails?: boolean;
  resetKeys?: Array<string | number>;
  resetOnPropsChange?: boolean;
  title?: string;
  description?: string;
  showRetryButton?: boolean;
  showHomeButton?: boolean;
  showReportButton?: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  private resetTimeoutId?: number;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error for debugging
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Store error info in state
    this.setState({
      error,
      errorInfo,
    });

    // Report to error monitoring service in production
    if (process.env.NODE_ENV === "production") {
      // TODO: Integrate with error monitoring service like Sentry
      // Sentry.captureException(error, { extra: errorInfo });
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetKeys, resetOnPropsChange } = this.props;
    const { hasError } = this.state;

    // Reset error state if resetKeys changed
    if (hasError && resetKeys && prevProps.resetKeys) {
      const hasResetKeyChanged = resetKeys.some(
        (key, idx) => key !== prevProps.resetKeys?.[idx]
      );

      if (hasResetKeyChanged) {
        this.resetErrorBoundary();
      }
    }

    // Reset error state if any props changed and resetOnPropsChange is true
    if (hasError && resetOnPropsChange && prevProps !== this.props) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = () => {
    // Clear any pending reset timeout
    if (this.resetTimeoutId) {
      window.clearTimeout(this.resetTimeoutId);
    }

    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
    });
  };

  handleRetry = () => {
    this.resetErrorBoundary();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  handleReportError = () => {
    const { error, errorInfo } = this.state;
    const errorReport = {
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    // TODO: Send to error reporting service
    console.log("Error report:", errorReport);

    // For now, copy to clipboard
    navigator.clipboard
      ?.writeText(JSON.stringify(errorReport, null, 2))
      .then(() => alert("Error details copied to clipboard"))
      .catch(() => alert("Failed to copy error details"));
  };

  render() {
    const {
      children,
      fallback,
      title = "Something went wrong",
      description = "An unexpected error occurred. Please try again or contact support if the problem persists.",
      showErrorDetails = process.env.NODE_ENV === "development",
      showRetryButton = true,
      showHomeButton = true,
      showReportButton = process.env.NODE_ENV === "development",
    } = this.props;

    const { hasError, error, errorInfo } = this.state;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <Card className="w-full max-w-2xl mx-auto border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{description}</p>

            {/* Error details for development */}
            {showErrorDetails && error && (
              <details className="bg-muted p-3 rounded-md">
                <summary className="cursor-pointer font-medium text-sm mb-2">
                  Error Details
                </summary>
                <div className="space-y-2 text-xs font-mono">
                  <div>
                    <strong>Message:</strong> {error.message}
                  </div>
                  {error.stack && (
                    <div>
                      <strong>Stack:</strong>
                      <pre className="whitespace-pre-wrap overflow-auto max-h-32 mt-1 bg-background p-2 rounded">
                        {error.stack}
                      </pre>
                    </div>
                  )}
                  {errorInfo?.componentStack && (
                    <div>
                      <strong>Component Stack:</strong>
                      <pre className="whitespace-pre-wrap overflow-auto max-h-32 mt-1 bg-background p-2 rounded">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              {showRetryButton && (
                <Button onClick={this.handleRetry} variant="default">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              )}
              {showHomeButton && (
                <Button onClick={this.handleGoHome} variant="outline">
                  <Home className="h-4 w-4 mr-2" />
                  Go Home
                </Button>
              )}
              {showReportButton && (
                <Button onClick={this.handleReportError} variant="ghost">
                  <Bug className="h-4 w-4 mr-2" />
                  Report Error
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      );
    }

    return children;
  }
}

// HOC for easier usage with hooks
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, "children">
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${
    Component.displayName || Component.name
  })`;

  return WrappedComponent;
}

// Hook for resetting error boundaries programmatically
export function useErrorHandler() {
  return (error: Error, errorInfo?: React.ErrorInfo) => {
    console.error("Unhandled error:", error, errorInfo);

    // In a real app, you might want to report this to an error service
    if (process.env.NODE_ENV === "production") {
      // TODO: Report to error monitoring service
    }
  };
}
