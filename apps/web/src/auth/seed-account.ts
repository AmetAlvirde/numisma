/**
 * Seed the SINGLE tenant account deterministically (ADR-007 / slice #125).
 *
 *   pnpm --filter @numisma/web auth:seed
 *
 * The product is single-tenant, single-account: open self-service signup is
 * disabled at the auth server (`emailAndPassword.disableSignUp`, see
 * src/lib/auth.ts), so the one account must be established by a repeatable
 * seed/invite step — NOT a one-off manual signup.
 *
 * This writes through Better Auth's INTERNAL adapter (`auth.$context`), not the
 * disabled `/api/auth/sign-up/email` HTTP route, so disabling signup does not
 * break seeding. It mirrors exactly what the signup route did internally on a
 * fresh account (createUser + a `credential` account carrying the hashed
 * password), which is what `signIn.email` reads — so the seeded account can log
 * in immediately.
 *
 * Deterministic + idempotent: the account is defined by NUMISMA_SEED_EMAIL /
 * NUMISMA_SEED_PASSWORD (+ optional NUMISMA_SEED_NAME). If a user with that
 * email already exists, the run is a no-op (never a duplicate, never a throw).
 *
 * ADR-008 disjointness: this touches ONLY the `numisma_auth` RW store behind
 * AUTH_DATABASE_URL (via the same `auth` instance the web uses). It NEVER reads
 * or writes PROJECTION_DATABASE_URL / PROJECTION_WRITE_DATABASE_URL.
 */
import { auth } from "../lib/auth.ts";

async function main(): Promise<void> {
  if (!process.env.AUTH_DATABASE_URL) {
    throw new Error("AUTH_DATABASE_URL is not set (the numisma_auth RW store)");
  }
  const email = process.env.NUMISMA_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.NUMISMA_SEED_PASSWORD;
  if (!email) {
    throw new Error("NUMISMA_SEED_EMAIL is not set (the single account's email)");
  }
  if (!password) {
    throw new Error(
      "NUMISMA_SEED_PASSWORD is not set (the single account's password)",
    );
  }
  const name = process.env.NUMISMA_SEED_NAME?.trim() || email;

  const ctx = await auth.$context;

  // Idempotent: the account is defined by its email. A second run finds the
  // existing user and no-ops, so the seed can be re-run safely and never
  // creates a second account (the single-tenant invariant).
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing?.user) {
    console.log(`[auth:seed] account already present (${email}) — no-op`);
    return;
  }

  // Same two internal-adapter writes the signup route performs on a fresh
  // account: the user row, then a `credential` account carrying the hashed
  // password that `signIn.email` verifies against.
  const hash = await ctx.password.hash(password);
  const user = await ctx.internalAdapter.createUser({
    email,
    name,
    emailVerified: true,
  });
  if (!user) {
    throw new Error("[auth:seed] failed to create the seed user");
  }
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });

  console.log(`[auth:seed] single account seeded (${email})`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(
      "[auth:seed] failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  },
);
