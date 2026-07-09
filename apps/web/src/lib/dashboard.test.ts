import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { loadDashboard, type SessionGateDeps } from "./dashboard.ts";
import type { LatestSnapshot } from "../projection/contract.ts";

/**
 * The exact cookie a real browser carries after login. The prototype's one real
 * bug was this cookie being dropped between `getRequest()` and
 * `auth.api.getSession({ headers })`, silently downgrading every authenticated
 * render to the /login redirect. These tests drive that seam for real.
 */
const SESSION_COOKIE = "numisma.session_token=abc123.sig456";

/** A distinctive snapshot so the assertions prove the value came from getSnapshot. */
const SNAPSHOT: LatestSnapshot = {
  status: "stale",
  storedVersion: 99,
  expectedVersion: 1,
};

/**
 * A fake auth whose `getSession` authenticates ONLY when the forwarded headers
 * actually carry the session cookie — and RECORDS the headers it received so a
 * test can assert the cookie genuinely reached it. This is what a pure
 * mocked-session return cannot do: here the session outcome is a function of the
 * forwarded cookie, so dropping/blanking that cookie is observable.
 */
function cookieCheckingAuth(validCookie: string) {
  const received: { headers: Headers | undefined } = { headers: undefined };
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        received.headers = headers;
        return headers.get("cookie") === validCookie
          ? { session: { id: "s1" }, user: { id: "u1" } }
          : null;
      },
    },
  } as unknown as SessionGateDeps["auth"];
  return { auth, received };
}

/** Build injectable deps around a request carrying `cookie` (omit for none). */
function depsWithCookie(
  cookie: string | undefined,
  validCookie: string,
): { deps: SessionGateDeps; received: { headers: Headers | undefined } } {
  const headers = new Headers();
  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }
  const { auth, received } = cookieCheckingAuth(validCookie);
  return {
    deps: {
      getHeaders: () => headers,
      auth,
      getSnapshot: async () => SNAPSHOT,
    },
    received,
  };
}

describe("loadDashboard session gate", () => {
  it("returns the latest snapshot for an authenticated session", async () => {
    const { deps } = depsWithCookie(SESSION_COOKIE, SESSION_COOKIE);
    await expect(loadDashboard(deps)).resolves.toEqual(SNAPSHOT);
  });

  it("redirects to /login (zero-byte body) when there is no session", async () => {
    // No cookie on the request -> getSession returns null -> gate redirects.
    const { deps } = depsWithCookie(undefined, SESSION_COOKIE);
    try {
      await loadDashboard(deps);
      throw new Error("expected loadDashboard to throw a redirect");
    } catch (err) {
      expect(isRedirect(err)).toBe(true);
      const options = (err as { options: { to?: string; body?: unknown } })
        .options;
      expect(options.to).toBe("/login");
      // Zero-byte body preserved: the redirect carries no body payload.
      expect(options.body).toBeUndefined();
    }
  });

  it("does not read the snapshot when unauthenticated", async () => {
    const headers = new Headers(); // no cookie
    const { auth } = cookieCheckingAuth(SESSION_COOKIE);
    let snapshotRead = false;
    const deps: SessionGateDeps = {
      getHeaders: () => headers,
      auth,
      getSnapshot: async () => {
        snapshotRead = true;
        return SNAPSHOT;
      },
    };
    await expect(loadDashboard(deps)).rejects.toSatisfy(isRedirect);
    // The read credential / projection pool is never touched on the auth-fail path.
    expect(snapshotRead).toBe(false);
  });
});

describe("regression: the incoming request cookie reaches auth.api.getSession", () => {
  it("forwards the incoming cookie unchanged to getSession", async () => {
    const { deps, received } = depsWithCookie(SESSION_COOKIE, SESSION_COOKIE);

    const result = await loadDashboard(deps);

    // Authenticated: proves the forwarded headers satisfied getSession.
    expect(result).toEqual(SNAPSHOT);
    // The precise assertion a mocked-session return cannot make: the very cookie
    // carried on the incoming request arrived at getSession, byte-for-byte.
    expect(received.headers).toBeDefined();
    expect(received.headers?.get("cookie")).toBe(SESSION_COOKIE);
    // And it is the same Headers object the request exposed, not a rebuilt blank.
    expect(received.headers).toBe(deps.getHeaders());
  });

  it("fails the gate when the incoming cookie is blanked (the dropped-cookie regression)", async () => {
    // Simulate the prototype bug's shape: the request arrives with an EMPTY
    // cookie instead of the real session token. Because getSession's outcome
    // depends on the forwarded cookie, the drop is observable — the gate falls
    // back to /login instead of authenticating.
    const { deps, received } = depsWithCookie("", SESSION_COOKIE);

    await expect(loadDashboard(deps)).rejects.toSatisfy(isRedirect);
    // getSession still ran and still saw the (blanked) headers — the forwarding
    // path executed; it is the cookie value that failed, exactly as in the bug.
    expect(received.headers?.get("cookie")).toBe("");
  });
});
