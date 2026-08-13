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

/**
 * LAN origins allowed during local development only (comma-separated in
 * DEV_TRUSTED_ORIGINS, e.g. "http://192.168.100.60:3000").
 *
 * Better Auth CSRF-checks every /api/auth/* request by comparing the browser's
 * Origin header against `baseURL` plus `trustedOrigins`. `baseURL` is a single
 * fixed origin, so hitting `vite dev --host` from a phone at the machine's LAN
 * IP fails with "Invalid origin" even though it is the same server — the host
 * differs, and that is exactly what the check is for.
 *
 * The production gate is the point, not decoration: a LAN IP in the trusted set
 * on a hosted deploy would widen the CSRF surface for no benefit, so the list is
 * dropped whenever NODE_ENV === "production" (which Vercel sets at runtime).
 * The var is also absent from Vercel's env, making this belt AND braces.
 */
const devTrustedOrigins =
  process.env.NODE_ENV === "production"
    ? []
    : (process.env.DEV_TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.AUTH_DATABASE_URL,
  }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: devTrustedOrigins,
  emailAndPassword: {
    enabled: true,
    // Single-tenant invariant (ADR-007): the SERVER rejects new-account
    // creation. Sign-in stays enabled for the one seeded account. See the
    // module doc + src/auth/seed-account.ts for the deterministic seed path.
    disableSignUp: true,
  },
  // D5 (2026-07-24 hosted-security grill) — rate limiting that is ACTUALLY
  // DB-backed.
  //
  // `storage: "database"` is the whole decision. Better Auth defaults to
  // `storage: "memory"`, which on Vercel is close to worthless: every
  // serverless instance holds its own counter, instances scale out and recycle,
  // so an attacker distributed across cold starts gets a fresh budget each
  // time. `rateLimit: { enabled: true }` on its own LOOKS finished, passes
  // review, and ships a control that does not work. Persisting the counter into
  // numisma_auth (the "rateLimit" table in better-auth.schema.sql — hand-added,
  // because the vendored schema only had user/session/account/verification) is
  // what makes the budget shared across instances.
  //
  // `enabled: true` is an EXPLICIT override, not decoration: Better Auth
  // resolves `enabled` as `options.rateLimit?.enabled ?? isProduction`
  // (context/create-context.mjs), so leaving it out turns rate limiting OFF in
  // development — absent exactly where you would test it, and exactly where
  // auth:verify-limit runs.
  //
  // NO LOCKOUT — DELIBERATELY. Every security checklist says "lock the account
  // after N failed attempts", and a future reader will be tempted to add it.
  // Do not. This product admits EXACTLY ONE account (see disableSignUp above).
  // With one account, lockout hands any anonymous attacker a permanent denial
  // of the fund view: five failed logins from anywhere on the internet and the
  // owner's only remedy is DB surgery. LOCKOUT CONVERTS A FAILED ATTACK INTO A
  // SUCCESSFUL ONE. Rate limiting degrades attacker throughput without ever
  // fully closing the owner's door, which is the correct shape for
  // single-tenant. This reasoning holds ONLY because the system is
  // single-tenant; if a second tenant is ever added, revisit it.
  //
  // ACCEPTED COST: DB-backed limiting writes to Neon on every auth attempt,
  // including rejected ones — attack traffic costs money. D6 says that is
  // bounded by an explicit Neon spend threshold, which prefers an outage over a
  // surprise bill.
  //
  // WHAT ACTUALLY BOUNDS IT TODAY (verified 2026-07-25, ADR-011 amendment):
  // the Neon FREE plan's hard caps — 100 CU-hrs compute, 0.5 GB storage, 5 GB
  // transfer — which suspend the database rather than billing past it. There is
  // NO spend threshold, and none can be set: `vercel integration balance neon`
  // reports no balance to attach one to on Free. The outage-over-bill posture
  // holds, but structurally rather than by the configured control D6 names.
  //
  // THE TRIGGER TO WATCH: upgrading the Neon plan. A paid plan replaces hard
  // caps with billable usage, so upgrading WITHOUT setting a threshold silently
  // converts D6's deliberate choice into the alternative it rejected — an
  // unbounded bill under sustained attack. Read `create-threshold` carefully if
  // that day comes: its args are (resource, minimum, spend, limit) and it
  // configures AUTO-RECHARGE — buying capacity to stay up — which is the
  // opposite of what D6 wants unless `limit` is doing the work.
  //
  // Verified by attack, not by inspection: `pnpm --filter @numisma/web
  // auth:verify-limit` (src/auth/verify-rate-limit.ts). Configuration alone
  // cannot distinguish a working limit from a fake one.
  rateLimit: {
    enabled: true,
    storage: "database",
    // Global floor for every /api/auth/* path.
    window: 60,
    max: 60,
    customRules: {
      // Window-based backoff on the credential-stuffing path itself. This
      // REPLACES Better Auth's built-in /sign-in special rule (10s/3), trading
      // a fast-resetting burst limit for a longer window an attacker cannot
      // simply wait out at 18 attempts/minute. Ten tries per five minutes is
      // ample for a human fumbling a manager-generated password one-handed.
      "/sign-in/email": { window: 300, max: 10 },
    },
  },
  // D7 — 30-day rolling session.
  //
  // Deliberately NOT restated here: httpOnly / secure / sameSite: lax. Better
  // Auth's cookie defaults are already correct; this block sets LIFETIME only.
  //
  // The counterintuitive part: a SHORT session actively weakens the primary
  // control, which is a strong unique manager-generated password. At 7 days
  // that password gets re-typed weekly, one-handed, outdoors, in a hurry —
  // pressure that pushes toward a shorter password or toward trusting a device
  // you otherwise wouldn't. What a short session buys is protection against a
  // stolen UNLOCKED phone: already behind Face ID, and a targeted scenario this
  // control set is not sized for. Trading a real degradation of the primary
  // control for a marginal gain against a secondary threat is the wrong trade.
  //
  // What makes a long session safe is a revocation path that actually works,
  // and this system has an unusually good one: single account, direct Neon
  // access, so `DELETE FROM session` in numisma_auth logs out every device
  // instantly. Rotating BETTER_AUTH_SECRET invalidates every session and is the
  // second half of the same button.
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // renewed daily on use — this is what makes it rolling
  },
  // Keeps auth cookies working through TanStack Start's server-function layer.
  plugins: [tanstackStartCookies()],
});
