/**
 * THE OPERATOR NOTICE'S SHELL — a self-executing script, deliberately THIN.
 *
 *   pnpm operator-notice     # rewrite operator-notice.txt beside the durable log
 *
 * Every decision it could make has already been made in `@numisma/event-store`:
 * what the notice says (`operator-notice.ts`, pure), where it goes and how it is
 * written (`operator-notice-io.ts`). This file resolves the store, reads the clock
 * ONCE, and hands both over. It exists only because the wrapper needs something
 * invocable, and it lives in `apps/price-feed` because that is the app the wrapper
 * already drives.
 *
 * ZERO-ARGUMENT, AND IT MUST STAY THAT WAY. An unattended step that takes a date is
 * a step that eventually writes the wrong one. The window is the derivation's own
 * default — the launchd era floor and a ceiling of yesterday — which is exactly what
 * the TUI's liveness banner uses, and this notice is that banner's push twin: the
 * two must not describe different windows.
 *
 * NO ENVIRONMENT OF ITS OWN. The notice is resolved from the SAME data dir as
 * `gap-report.json` and `job-heartbeat.json`, through the one rule in ADR-006
 * (`resolveDataDirDefault` — absolute, homedir-derived, `NUMISMA_DATA_DIR` the only
 * override). There is no notice-specific path variable and there must never be one:
 * a second knob is a second way for the writer and the reader to end up in different
 * directories, which for a delivery channel means silence that looks like health.
 *
 * ── IT ALWAYS EXITS 0, AND IT IS NEVER SILENT ABOUT FAILING ───────────────────
 * The wrapper runs under `set -e`, so a non-zero exit here would abort the run
 * before `backfill` — a NOTICE WRITER THAT BRICKS THE RUN IS WORSE THAN NO NOTICE.
 * A derivation that fails is already carried into the file as a line by the writer
 * itself; what is left is a disk failure, which cannot be written to the file it
 * failed to write. That one case goes to stderr, into the run log the wrapper tees,
 * and the run continues. This is the only channel left at that point, and saying
 * nothing would be the failure this whole increment exists to remove.
 */
import { resolveDataDirDefault, resolveEventStorePaths, writeOperatorNotice } from "@numisma/event-store";

writeOperatorNotice(resolveEventStorePaths(resolveDataDirDefault()), { now: new Date() }).then(
  (path) => {
    console.log(`[operator-notice] wrote ${path}`);
    process.exit(0);
  },
  (error: unknown) => {
    console.error(
      "[operator-notice] could NOT write the notice:",
      error instanceof Error ? error.message : error,
    );
    // Exit 0 ON PURPOSE — see the header. The run must reach `backfill`.
    process.exit(0);
  },
);
