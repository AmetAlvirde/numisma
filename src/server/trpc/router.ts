import { initTRPC } from "@trpc/server";
import { Context } from "./context";
import superjson from "superjson";
import { z } from "zod";

const t = initTRPC.context<Context>().create({
  transformer: superjson, // Configure superjson for data transformation
  errorFormatter({ shape }) {
    return shape;
  },
});

// Base router and procedure helpers
export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  hello: publicProcedure
    .input(z.object({ name: z.string() }).nullish())
    .query(({ input, ctx }) => {
      return {
        greeting: `Hello ${input?.name ?? "world"}`,
      };
    }),

  userCount: publicProcedure.query(async ({ ctx }) => {
    const count = await ctx.prisma.user.count();
    return {
      count,
    };
  }),

  listUsers: publicProcedure.query(async ({ ctx }) => {
    const users = await ctx.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
    return users;
  }),

  // Add other routers here...
});

// Export type definition of API
export type AppRouter = typeof appRouter;
