/**
 * Better Auth server instance (Deliverable D) — email + password ONLY.
 *
 * Owns a SEPARATE `numisma_auth` DB via its own RW pg Pool from
 * AUTH_DATABASE_URL. This is deliberately disjoint from the projection DB:
 * auth NEVER touches PROJECTION_DATABASE_URL / PROJECTION_WRITE_DATABASE_URL.
 *
 * The Pool is constructed with `{ connectionString }` (possibly undefined at
 * import time); pg connects lazily on first query, so importing this module
 * never crashes the dev server when the env is absent.
 */
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Pool } from "pg";

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.AUTH_DATABASE_URL,
  }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
  // Keeps auth cookies working through TanStack Start's server-function layer.
  plugins: [tanstackStartCookies()],
});
