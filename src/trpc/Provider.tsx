"use client";

import React, { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { getBaseUrl } from "@/utils/get-base-url"; // Import the utility

import { trpc } from "./react"; // Import the React Query client

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Global defaults for all queries
            staleTime: 5 * 60 * 1000, // 5 minutes default
            gcTime: 10 * 60 * 1000, // 10 minutes default
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: (failureCount, error: any) => {
              // Don't retry on 4xx errors (client errors)
              if (
                error?.data?.httpStatus >= 400 &&
                error?.data?.httpStatus < 500
              ) {
                return false;
              }
              // Retry up to 3 times for other errors
              return failureCount < 3;
            },
            retryDelay: attemptIndex =>
              Math.min(1000 * 2 ** attemptIndex, 30000),
          },
          mutations: {
            retry: 1, // Retry mutations once on failure
            retryDelay: 1000,
          },
        },
      })
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson, // Use superjson here as well for client-side
          maxURLLength: 2083, // Optimize for batching
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      {children}
    </trpc.Provider>
  );
}
