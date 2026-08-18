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
 * a step that eventually writes the wrong one. The window is the composer's own
 * default — `defaultGapReportSince` and a ceiling of yesterday — which is exactly
 * what the TUI's liveness banner uses, and this notice is that banner's push twin:
 * the two must not describe different windows.
 *
 * THE TWIN PROPERTY BINDS THE WINDOW, NOT THE RENDERING, and the distinction is
 * load-bearing: `operator-notice.ts` rules that the banner ENUMERATES venue-dark
 * days while the notice COUNTS them, so the two surfaces are ALREADY REQUIRED to
 * render one finding differently. A recency bound on the notice's venue-dark count
 * (`MAX_NOTICE_VENUE_DARK_DAYS`) is therefore a rendering decision and no breach of
 * the sentence above — the derivation still walks the whole shared window on both
 * surfaces. Read the other way, this claim makes the notice unfixable, which is how
 * #381 read it. Nothing here is retired.
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
 *
 * SO NEITHER ARM CALLS `process.exit`, AND THAT IS WHAT KEEPS THE PROMISE ABOVE.
 * Exiting 0 is not something this file has to do; it is what already happens. The
 * rejection is handled by the second argument below, so nothing goes unhandled and
 * the process leaves with 0 on its own once the event loop drains. An explicit
 * `process.exit(0)` would add no guarantee and would take one away: under the wrapper
 * both streams are a PIPE into a `tee` process substitution, writes to a pipe are
 * ASYNCHRONOUS, and `process.exit` terminates without flushing them. It would drop
 * exactly the disk-failure diagnostic this comment just called the only channel left,
 * and drop it ONLY in the deployed shape — against an interactive TTY the write is
 * synchronous, so nothing is ever seen to go missing while testing by hand.
 */
import { resolveDataDirDefault, resolveEventStorePaths, writeOperatorNotice } from "@numisma/event-store";

writeOperatorNotice(resolveEventStorePaths(resolveDataDirDefault()), { now: new Date() }).then(
  (path) => {
    console.log(`[operator-notice] wrote ${path}`);
  },
  (error: unknown) => {
    // HANDLED, AND THEN NOTHING — the handling is what makes the exit 0, and the
    // absence of a `process.exit` is what lets this line reach the run log. See the
    // header; the run must reach `backfill`, and it must reach it knowing this.
    console.error(
      "[operator-notice] could NOT write the notice:",
      error instanceof Error ? error.message : error,
    );
  },
);
