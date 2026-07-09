import { QueryClient } from "@tanstack/react-query";

/** Shared TanStack Query client for the app (used by the login mutation). */
export const queryClient = new QueryClient();
