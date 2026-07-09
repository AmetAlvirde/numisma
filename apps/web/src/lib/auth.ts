/**
 * Better Auth server instance (Deliverable D) — email + password ONLY.
 *
 * SINGLE-TENANT gate (ADR-007 / slice #125): the product admits exactly one
 * seeded account. Open self-service signup is removed here at the SERVER:
 * `emailAndPassword.disableSignUp` makes the `/api/auth/sign-up/email` route
 * reject every new-account request (`EMAIL_PASSWORD_SIGN_UP_DISABLED`) while
 * `enabled: true` keeps SIGN-IN working for the seeded account. The single
 * account is established out-of-band by the deterministic, idempotent seed —
 * `pnpm --filter @numisma/web auth:seed` (see src/auth/seed-account.ts) — which
 * writes through the internal adapter, not the disabled HTTP signup route.
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
    // Single-tenant invariant (ADR-007): the SERVER rejects new-account
    // creation. Sign-in stays enabled for the one seeded account. See the
    // module doc + src/auth/seed-account.ts for the deterministic seed path.
    disableSignUp: true,
  },
  // Keeps auth cookies working through TanStack Start's server-function layer.
  plugins: [tanstackStartCookies()],
});
