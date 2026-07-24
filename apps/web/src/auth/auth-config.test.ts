import { describe, expect, it } from "vitest";
import { auth } from "../lib/auth.ts";

/**
 * D5 + D7 config invariants (2026-07-24 hosted-security grill).
 *
 * These are cheap regression guards on decisions whose failure mode is silent.
 * `storage: "database"` reverting to the Better Auth default (`"memory"`) would
 * not break a single test, would not error at runtime, and would still return
 * 429 on a single local instance — while shipping a counter that resets on
 * every Vercel cold start. Likewise `enabled` falling back to its default makes
 * rate limiting production-only, i.e. absent wherever it can be tested.
 *
 * The paired live check is `pnpm --filter @numisma/web auth:verify-limit`,
 * which proves the limit actually bites. This file only proves the config never
 * quietly drifts back to the default.
 */

describe("D5: rate limiting is DB-backed and on everywhere", () => {
  it("persists the counter to the database, not per-instance memory", () => {
    expect(auth.options.rateLimit?.storage).toBe("database");
  });

  it("is enabled explicitly, so it is not silently off in development", () => {
    // Better Auth resolves this as `enabled ?? isProduction`; an omitted value
    // means "off in dev", which is where auth:verify-limit runs.
    expect(auth.options.rateLimit?.enabled).toBe(true);
  });

  it("applies a stricter window to the sign-in path than the global floor", () => {
    const global = auth.options.rateLimit;
    const signIn = global?.customRules?.["/sign-in/email"];

    expect(signIn).toEqual({ window: 300, max: 10 });
    expect(global?.window).toBe(60);
    expect(global?.max).toBe(60);
  });

  it("ships NO lockout — deliberately, because lockout would deny the one owner", () => {
    // Single-tenant: a lockout turns any anonymous attacker's FAILED run into a
    // successful permanent denial of the fund view, remediable only by DB
    // surgery. If a future change introduces account-locking config here, this
    // assertion is the place that argues with it.
    expect(
      Object.keys(auth.options.rateLimit ?? {}).some((k) =>
        /lock/i.test(k),
      ),
    ).toBe(false);
  });
});

describe("D7: 30-day rolling session", () => {
  it("expires in 30 days and renews daily on use", () => {
    expect(auth.options.session?.expiresIn).toBe(60 * 60 * 24 * 30);
    expect(auth.options.session?.updateAge).toBe(60 * 60 * 24);
  });

  it("sets lifetime ONLY, leaving cookie flags to Better Auth's defaults", () => {
    // httpOnly / secure / sameSite: lax are already right; restating them here
    // would only create a second place to get them wrong. So the session block
    // must carry exactly the two lifetime keys and nothing else, and no
    // `advanced` cookie override may appear alongside it.
    expect(Object.keys(auth.options.session ?? {}).sort()).toEqual([
      "expiresIn",
      "updateAge",
    ]);
    expect("advanced" in auth.options).toBe(false);
  });
});
