import * as trpcNext from "@trpc/server/adapters/next";
import { getServerSession } from "next-auth/next";
import { prisma } from "@/db/prisma-client";
import { authOptions } from "@/utils/auth";

// The app's context - is generated for each incoming request
export async function createContext(opts?: trpcNext.CreateNextContextOptions) {
  // Get the session from the request
  const session =
    opts?.req && opts?.res
      ? await getServerSession(opts.req, opts.res, authOptions)
      : await getServerSession(authOptions);

  return {
    prisma,
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
