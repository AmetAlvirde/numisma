/**
 * Shared tRPC Instance & Procedures
 *
 * This file contains the base tRPC instance and shared procedures
 * that can be used across all routers to maintain consistency
 * and avoid circular dependencies.
 *
 * SINGLE SOURCE OF TRUTH for tRPC configuration
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { Context } from "./context";
import superjson from "superjson";

// Initialize the main tRPC instance (SINGLE INSTANCE FOR ENTIRE APP)
const t = initTRPC.context<Context>().create({
  transformer: superjson, // Configure superjson for data transformation
  errorFormatter({ shape }) {
    return shape;
  },
});

// Base router and procedure helpers - exported for use in all routers
export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure helper that requires authentication
// This is shared across all routers to ensure consistent auth logic
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

// Export the base tRPC instance for advanced use cases (if needed)
export { t };
