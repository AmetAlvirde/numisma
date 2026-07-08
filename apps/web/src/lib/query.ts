import { QueryClient } from "@tanstack/react-query";

/** Shared TanStack Query client for the app (used by login/signup mutations). */
export const queryClient = new QueryClient();
