"use client";

import React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  TrendingUp,
  Pin,
  BarChart3,
  Wallet,
} from "lucide-react";

interface FallbackProps {
  onRetry?: () => void;
  className?: string;
}

// Loading skeleton for portfolio overview
export function PortfolioLoadingSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <Card className="relative gap-0">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-muted-foreground">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Pin className="h-4 w-4 text-muted-foreground" />
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              </div>
              <div className="h-8 w-8 bg-muted animate-pulse rounded" />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-3">
            {/* Portfolio Value Skeleton */}
            <div>
              <div className="flex items-end justify-between">
                <div className="h-8 w-40 bg-muted animate-pulse rounded" />
                <div className="flex items-center space-x-1">
                  <TrendingUp className="h-3 w-3 text-muted-foreground" />
                  <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                </div>
              </div>
            </div>

            {/* Top Holdings Skeleton */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground">Top:</span>
                <div className="flex space-x-1">
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      className="h-6 w-12 bg-muted animate-pulse rounded"
                    />
                  ))}
                </div>
              </div>
              <div className="h-6 w-16 bg-muted animate-pulse rounded" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Error fallback for portfolio data
export function PortfolioErrorFallback({ onRetry, className }: FallbackProps) {
  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <Card className="relative gap-0 border-destructive/50">
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold">
                Portfolio Data Unavailable
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                We&apos;re having trouble loading your portfolio information.
                This might be due to a temporary network issue or server
                problem.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              {onRetry && (
                <Button onClick={onRetry} variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link href="/portfolios">
                  <Wallet className="h-4 w-4 mr-2" />
                  View All Portfolios
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Network offline fallback
export function OfflineFallback({ onRetry, className }: FallbackProps) {
  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <Alert className="border-warning">
        <WifiOff className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <div>
            <strong>You&apos;re offline.</strong> Some features may not work
            until you reconnect.
          </div>
          {onRetry && (
            <Button onClick={onRetry} variant="ghost" size="sm">
              <Wifi className="h-4 w-4 mr-2" />
              Retry
            </Button>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}

// Empty state for when user has no portfolios
export function NoPortfoliosFallback({ className }: { className?: string }) {
  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <Card className="relative gap-0">
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                <BarChart3 className="h-8 w-8 text-muted-foreground" />
              </div>
            </div>
            <div>
              <h3 className="text-lg font-semibold">No Portfolios Yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Get started by creating your first portfolio to track your
                investments.
              </p>
            </div>
            <Button variant="default">
              <Wallet className="h-4 w-4 mr-2" />
              Create Portfolio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Generic loading fallback for any portfolio component
export function PortfolioComponentLoading({
  message = "Loading...",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center space-x-2 p-4 ${className}`}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  );
}

// Network status indicator
export function NetworkStatusIndicator({
  isOnline,
  onRetryConnection,
}: {
  isOnline: boolean;
  onRetryConnection?: () => void;
}) {
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Alert className="border-warning bg-background shadow-lg">
        <WifiOff className="h-4 w-4" />
        <AlertDescription className="flex items-center gap-2">
          <span>No internet connection</span>
          {onRetryConnection && (
            <Button onClick={onRetryConnection} variant="ghost" size="sm">
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}

// Comprehensive error handler for tRPC errors
export function TrpcErrorFallback({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const getErrorMessage = (error: unknown): string => {
    const typedError = error as {
      data?: { code?: string; httpStatus?: number };
      message?: string;
    };
    if (typedError?.data?.code === "UNAUTHORIZED") {
      return "You need to sign in to view this content.";
    }
    if (typedError?.data?.code === "FORBIDDEN") {
      return "You don&apos;t have permission to access this content.";
    }
    if (typedError?.data?.code === "NOT_FOUND") {
      return "The requested portfolio could not be found.";
    }
    if (typedError?.data?.code === "TIMEOUT") {
      return "Request timed out. Please check your connection and try again.";
    }
    if (typedError?.data?.httpStatus && typedError.data.httpStatus >= 500) {
      return "Our servers are experiencing issues. Please try again in a moment.";
    }

    return typedError?.message || "An unexpected error occurred.";
  };

  const getActionableSteps = (error: unknown): string[] => {
    const typedError = error as {
      data?: { code?: string; httpStatus?: number };
    };
    if (typedError?.data?.code === "UNAUTHORIZED") {
      return ["Sign in to your account", "Refresh the page"];
    }
    if (
      typedError?.data?.code === "TIMEOUT" ||
      (typedError?.data?.httpStatus && typedError.data.httpStatus >= 500)
    ) {
      return [
        "Check your internet connection",
        "Wait a moment and try again",
        "Contact support if the problem persists",
      ];
    }

    return ["Refresh the page", "Try again in a moment"];
  };

  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <Card className="relative gap-0 border-destructive/50">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-destructive">
                  {(error as { data?: { code?: string } })?.data?.code ===
                  "UNAUTHORIZED"
                    ? "Authentication Required"
                    : "Error Loading Data"}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {getErrorMessage(error)}
                </p>
              </div>
            </div>

            <div className="ml-8">
              <h4 className="text-sm font-medium mb-2">What you can try:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                {getActionableSteps(error).map((step, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <div className="h-1 w-1 bg-muted-foreground rounded-full" />
                    {step}
                  </li>
                ))}
              </ul>
            </div>

            <div className="ml-8 flex gap-2">
              {onRetry && (
                <Button onClick={onRetry} variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              )}
              {(error as { data?: { code?: string } })?.data?.code ===
                "UNAUTHORIZED" && (
                <Button variant="default" size="sm" asChild>
                  <Link href="/api/auth/signin">Sign In</Link>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
