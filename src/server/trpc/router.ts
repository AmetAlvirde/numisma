import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { portfolioRouter } from "./routers/portfolio";

export const appRouter = router({
  hello: publicProcedure
    .input(z.object({ name: z.string() }).nullish())
    .query(({ input }) => {
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

  // Portfolio router with all portfolio-related procedures
  portfolio: portfolioRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
