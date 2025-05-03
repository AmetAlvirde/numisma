import * as trpc from "@trpc/server";
import * as trpcNext from "@trpc/server/adapters/next";
import { prisma } from "@/db/prisma-client";

// The app's context - is generated for each incoming request
export async function createContext(_opts?: trpcNext.CreateNextContextOptions) {
  // Create your context based on the request object
  // Will be available as `ctx` in all your procedures
  // This is just a placeholder for now, we'll add Prisma later
  return {
    prisma,
  };
}

export type Context = trpc.inferAsyncReturnType<typeof createContext>;
