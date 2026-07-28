/**
 * Session-gated dashboard server function (Deliverable E).
 *
 * Runs SERVER-SIDE ONLY. It (1) checks the Better Auth session and redirects to
 * /login when unauthenticated, then (2) reads the snapshot history through the
 * READ-ONLY projection pool. The read credential and raw `pg` access live only
 * in this server function — they never reach the browser bundle.
 *
 * The gate's core is factored into {@link loadDashboard}, which takes its
 * request headers, its auth surface, and its snapshot reader as INJECTED
 * dependencies (see {@link SessionGateDeps}). That injection seam lets a test
 * drive the REAL header-forwarding path — the incoming request cookie reaching
 * `auth.api.getSession({ headers })` — instead of stubbing the session result.
 * That forwarding is the exact seam whose drop made the prototype silently fall
 * back to login while a mocked-session test stayed green.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import { auth } from "./auth.ts";
import {
  getReaderPool,
  getSnapshotHistory,
  type SnapshotHistory,
} from "../projection/contract.ts";

/**
 * The session gate's injectable dependencies. Kept deliberately narrow so the
 * gate's header-forwarding path can be exercised for real in a test (inject the
 * incoming headers + an auth whose `getSession` reads the forwarded cookie)
 * rather than bypassed by stubbing the session return.
 *
 * Reused by slice #125 (single-tenant gate), which layers its account check on
 * the same injected `auth` surface.
 */
export interface SessionGateDeps {
  /**
   * Yields the INCOMING request's Headers — the ones carrying the session
   * cookie. This is what must reach `auth.api.getSession` unchanged.
   */
  getHeaders: () => Headers;
  /** The auth surface consulted for the session; only `api.getSession` is used. */
  auth: { api: Pick<typeof auth.api, "getSession"> };
  /**
   * Reads the projection's anchor history once the session is verified. Widened
   * from a single latest snapshot in slice #148 — D4's named reference needs more
   * than one day, and the query always read them all anyway.
   */
  getSnapshot: () => Promise<SnapshotHistory>;
}

/**
 * Session gate core. Forwards the incoming request headers (session cookie
 * included) to `auth.api.getSession`, redirects to `/login` (zero-byte body)
 * when there is no session, else returns the snapshot history.
 *
 * The `getHeaders()` -> `getSession({ headers })` hand-off is the reliability
 * seam: if the forwarded headers ever drop the cookie, an authenticated caller
 * silently falls back to the login redirect. Injecting `getHeaders` and `auth`
 * lets a test assert the cookie genuinely arrives — the assertion a stubbed
 * session return cannot make.
 */
export async function loadDashboard(
  deps: SessionGateDeps,
): Promise<SnapshotHistory> {
  // getHeaders() yields the underlying web Request's `.headers` — a real Headers
  // carrying the incoming cookie. (getRequestHeaders() returns a Headers instance
  // too — do NOT Object.entries() it, that yields nothing.)
  const headers = deps.getHeaders();
  const session = await deps.auth.api.getSession({ headers });
  if (!session) {
    throw redirect({ to: "/login" });
  }
  return deps.getSnapshot();
}

export const getDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<SnapshotHistory> =>
    loadDashboard({
      getHeaders: () => getRequest().headers,
      auth,
      getSnapshot: () => getSnapshotHistory(getReaderPool()),
    }),
);
