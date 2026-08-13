import { describe, expect, it } from "vitest";
import {
  PROJECTION_QUERY_TIMEOUT_MS,
  PROJECTION_STATEMENT_TIMEOUT_MS,
  projectionPoolConfig,
} from "./projection-pool.ts";

/**
 * These assertions are deliberately about PROPERTIES, not values. Pinning "30000 is
 * 30000" would only restate the module's own bytes and would fail whenever someone
 * retuned a number on purpose. What is asserted here is the small set of things
 * that, if quietly dropped, would restore the 20-hour hang of 2026-08-11 — each of
 * which has an oracle outside this file (the observed incident, and the launchd
 * singleton the wrapper depends on).
 */
describe("projectionPoolConfig", () => {
  const config = projectionPoolConfig("postgres://user@localhost:5432/db");

  it("carries the connection string through untouched", () => {
    expect(config.connectionString).toBe("postgres://user@localhost:5432/db");
  });

  /**
   * THE REGRESSION TEST FOR THE INCIDENT. `query_timeout` is the only one of the
   * four settings enforced client-side, so it is the only one that bounds a query
   * whose socket has died silently. Everything else in this file is secondary to
   * this one line: without it, a slept laptop wedges the nightly job indefinitely.
   */
  it("bounds every query client-side, so a dead socket cannot hang the run forever", () => {
    expect(config.query_timeout).toBeGreaterThan(0);
    expect(Number.isFinite(config.query_timeout)).toBe(true);
  });

  it("caps the connect phase as well as the query", () => {
    expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(Number.isFinite(config.connectionTimeoutMillis)).toBe(true);
  });

  /**
   * Order matters, and the reason is diagnostic quality rather than safety: the
   * server must be the one to give up on a genuinely slow statement, so the failure
   * arrives as a PG `query_canceled` naming the statement instead of an anonymous
   * client-side timeout on a connection that was healthy all along.
   */
  it("lets the server's cap fire before the client's", () => {
    expect(PROJECTION_STATEMENT_TIMEOUT_MS).toBeLessThan(PROJECTION_QUERY_TIMEOUT_MS);
    expect(config.statement_timeout).toBe(PROJECTION_STATEMENT_TIMEOUT_MS);
    expect(config.query_timeout).toBe(PROJECTION_QUERY_TIMEOUT_MS);
  });

  /**
   * Keepalive is what lets the KERNEL notice the peer is gone rather than waiting
   * out the full client cap. It does not replace `query_timeout` (its timing is an
   * OS tunable), but with it off, every dead-socket query pays the maximum.
   */
  it("enables TCP keepalive with an explicit initial delay", () => {
    expect(config.keepAlive).toBe(true);
    expect(config.keepAliveInitialDelayMillis).toBeGreaterThan(0);
  });

  /**
   * The wrapper's watchdog kills a wedged run so launchd's per-label singleton
   * releases the job slot before the next hourly fire. That only helps if the pool
   * gives up FIRST — otherwise the watchdog is the sole line of defence and the
   * process dies by signal with no PG error to explain why. One hour is the
   * interval the plist actually fires at; see schedule-window.test.ts, which pins
   * the watchdog against the same oracle from the other side.
   *
   * A BOUND ON ONE QUERY, NOT ON THE COMMAND, and the name says so because the
   * distinction is load-bearing. This sum is one connect plus one query; `backfill`
   * issues 43-44 upserts sequentially and NOTHING here scales with that count. What
   * makes the command as a whole finite is that its loop aborts on the first
   * rejection — a separate invariant, pinned separately in backfill-core.test.ts
   * ("ABORTS on the first failed upsert"). Reading this assertion as a per-run bound
   * is how a per-anchor `catch` could be added without a single test going red.
   */
  it("bounds ONE stalled connect-plus-query well inside the one-hour gap between fires", () => {
    const oneHourMs = 60 * 60 * 1000;
    expect(config.connectionTimeoutMillis! + PROJECTION_QUERY_TIMEOUT_MS).toBeLessThan(
      oneHourMs,
    );
  });
});
