/**
 * Pool configuration for the two UNATTENDED projection writers (`push.ts`,
 * `backfill.ts`). It exists because of a specific, observed failure, and every
 * value here is chosen against that failure rather than as generic hygiene.
 *
 * WHAT HAPPENED (2026-08-11 22:06 CDMX). The 22:01 scheduled run reached step 6,
 * opened a pool against the Neon pooler, upserted 11 anchors, and then the laptop
 * slept. The TCP connection died with it — but nothing on either end said so: the
 * server never sent a FIN the client could see, and node-postgres imposes NO
 * client-side deadline on a query by default. So `await pool.query(...)` for anchor
 * 12/43 simply never settled. The run was still sitting there TWENTY HOURS later,
 * having burned 0.49s of CPU.
 *
 * WHY A HANG IS WORSE THAN A CRASH HERE, and this is the part that makes it worth
 * a file. A crashed run goes red, writes a heartbeat, and the next hourly fire
 * heals it — `backfill` is idempotent precisely so that can work. A HUNG run does
 * none of that. It never reaches the EXIT trap, so the heartbeat still describes
 * the PREVIOUS run and reads perfectly healthy. And because launchd is a per-label
 * singleton (see run-daily-fetch.sh's header, which says so explicitly), the wedged
 * process holds the job slot: every remaining fire in the 18:00-23:00 window is
 * skipped, and the following evening's window is skipped too. The plist's own
 * header spells out the consequence — once the CDMX date rolls, `isFreshBar`
 * refuses yesterday's bar and the day is unrecoverable. One dead socket therefore
 * costs an unbounded number of days, silently.
 *
 * THE HANG-BREAKER IS `query_timeout`, NOT the other three. Be precise about this,
 * because the obvious candidates do not cover the observed case:
 *   - `connectionTimeoutMillis` caps only the CONNECT phase. The connection here
 *     was already established and already working, so this would never have fired.
 *   - `statement_timeout` is enforced by the SERVER. On a socket the server can no
 *     longer reach, its verdict cannot get back to us, so it cannot end our wait.
 *   - `keepAlive` lets the KERNEL discover the dead peer and error the socket. It
 *     is the closest thing to a real fix, but its timing is an OS tunable we do not
 *     set and should not depend on for an upper bound.
 * Only `query_timeout` is enforced client-side, in-process, on a timer we own — so
 * it is the only one that bounds this failure no matter what the network does. The
 * others are kept because they each shorten a DIFFERENT failure, not as backup.
 *
 * `statement_timeout` IS DELIBERATELY THE SHORTER OF THE TWO. When a query is
 * genuinely slow rather than orphaned, we want the server to abort it and return a
 * real PG error (`57014 query_canceled`) naming the statement. Reversing the order
 * would let the client give up first on a connection that was fine, leaving the
 * server still working on a statement nobody will read, and reporting a generic
 * client timeout in place of a diagnosable one.
 */
import type { PoolConfig } from "pg";

/**
 * Connect phase only. Generous because the Neon pooler cold-starts a compute on
 * the first connection of the evening, and failing that is a real regression.
 */
export const PROJECTION_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Server-side per-statement cap. Measured against reality, not guessed: a healthy
 * backfill upserts all 43 anchors inside a single second (the `pushed_at` spread on
 * 2026-08-12 was 03:28:08.098 → 03:28:08.632), so ~100ms per statement. 60s is
 * three orders of magnitude of headroom and still bounded.
 */
export const PROJECTION_STATEMENT_TIMEOUT_MS = 60_000;

/** Client-side per-query cap — the hang-breaker. Strictly above the server's cap. */
export const PROJECTION_QUERY_TIMEOUT_MS = 90_000;

/** How long an idle socket waits before the kernel starts probing the peer. */
export const PROJECTION_KEEPALIVE_DELAY_MS = 10_000;

/**
 * Build the pool config for an unattended projection writer.
 *
 * Exported as a VALUE rather than applied inline at each `new Pool(...)` so the
 * invariants above can be asserted by a test without standing up a database — the
 * seam is the config object, and that is the whole point of it being one.
 */
export function projectionPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    connectionTimeoutMillis: PROJECTION_CONNECT_TIMEOUT_MS,
    statement_timeout: PROJECTION_STATEMENT_TIMEOUT_MS,
    query_timeout: PROJECTION_QUERY_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: PROJECTION_KEEPALIVE_DELAY_MS,
  };
}
