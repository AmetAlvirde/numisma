import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { auth } from "./auth.ts";
import { loadDashboard, type SessionGateDeps } from "./dashboard.ts";
import type { SnapshotHistory } from "../projection/contract.ts";

/**
 * Single-tenant gate (ADR-007 / slice #125). Two invariants:
 *
 *  1. Open self-service signup is disabled at the auth SERVER — the account can
 *     only be established by the deterministic seed (src/auth/seed-account.ts),
 *     never by a visitor self-registering. Sign-in stays enabled so the seeded
 *     account keeps working.
 *  2. An anonymous visitor leaks nothing: the session gate redirects to /login
 *     with a zero-byte body and never reads the projection snapshot. This drives
 *     the same injectable `loadDashboard` seam slice #124 built — inject an
 *     `auth` whose `getSession` returns null (an anonymous request) and assert
 *     the redirect + that `getSnapshot` was never called.
 */

describe("single-tenant: self-service signup is disabled at the server", () => {
  it("keeps email/password sign-in enabled but rejects new-account signup", () => {
    // The auth server's own resolved config is the source of truth for the
    // /api/auth/sign-up/email route's behavior: `disableSignUp` makes it throw
    // EMAIL_PASSWORD_SIGN_UP_DISABLED, while `enabled` keeps sign-in working.
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });
});

describe("single-tenant: an anonymous visitor reaches no fund data", () => {
  /** An auth whose getSession models an anonymous request: always no session. */
  const anonymousAuth = {
    api: { getSession: async () => null },
  } as unknown as SessionGateDeps["auth"];

  const SNAPSHOT: SnapshotHistory = {
    status: "stale",
    storedVersion: 99,
    expectedVersions: { min: 4, max: 5 },
  };

  it("redirects to /login (zero-byte body) and never reads the snapshot", async () => {
    let snapshotRead = false;
    const deps: SessionGateDeps = {
      getHeaders: () => new Headers(),
      auth: anonymousAuth,
      getSnapshot: async () => {
        snapshotRead = true;
        return SNAPSHOT;
      },
    };

    try {
      await loadDashboard(deps);
      throw new Error("expected loadDashboard to redirect the anonymous visitor");
    } catch (err) {
      expect(isRedirect(err)).toBe(true);
      const options = (err as { options: { to?: string; body?: unknown } })
        .options;
      expect(options.to).toBe("/login");
      // Zero-byte body: the redirect carries no fund data payload.
      expect(options.body).toBeUndefined();
    }

    // The read-only projection pool is never touched on the anonymous path —
    // no snapshot, no fund data leaves the server.
    expect(snapshotRead).toBe(false);
  });
});
