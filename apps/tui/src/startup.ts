/**
 * The startup data path the real app (`app.ts`, `pnpm dev`) and the openTUI
 * verification harness (`smoke-startup-openTui.ts`) both drive, extracted so the
 * sequence is exercised by tests rather than only by a hand-run terminal. Mirrors
 * the `mountApp` extraction (the render wiring) for the half before the renderer:
 * parse `--as-of`, ingest the inbox, surface the count report, and hand back the
 * fold loader + source label the renderer mounts.
 *
 * Per ADR-001 this is access-surface orchestration over `@numisma/engine`: the
 * fold and event validation stay in the engine; the write IO (`ingestInbox`)
 * stays in `event-store.ts` and the read IO (`loadFoldedReview`) in
 * `@numisma/event-store`; this only sequences them.
 */
import type { FoldedReview } from "@numisma/engine";
import { loadFoldedReview, type EventStorePaths } from "@numisma/event-store";
import { ingestInbox, type IngestReport } from "./event-store.js";
import { parseAsOfArg } from "./spine-args.js";
import { formatFoldCheckFailure } from "./fold-lines.js";
import { formatGapCheckFailure } from "./gap-lines.js";

/** What the renderer needs after the startup data path runs. */
export interface StartupPlan {
  /** The resolved `--as-of` date, or undefined for current state. */
  asOf: string | undefined;
  /** Source label shown in the load footer. */
  sourcePath: string;
  /**
   * Folds genesis + log to the resolved `asOf` (or current) and returns the fold's
   * WHOLE ENVELOPE — `{data, skipped}`.
   *
   * IT DOES NOT UNWRAP, and that is PRD #323 R4 reaching the last surface it had left
   * to reach: a thunk typed `Promise<FundReviewData>` hands its consumer a fold
   * indistinguishable from one taken over a complete log, which is #293 reproduced one
   * layer out from the shell. The renderer takes `.data` at the composition root and
   * says so there; the discards are reported on the startup channel BEFORE the
   * alternate screen opens, because after that nothing written to stderr is visible.
   */
  loadData: () => Promise<FoldedReview>;
}

/** Seams the host injects: where the report goes, and (for tests) the ingest fn. */
export interface StartupDeps {
  /** Surface the one-line ingest report (stderr in the app; captured in tests). */
  emit: (line: string) => void;
  /** The inbox ingest. Defaults to the real {@link ingestInbox}. */
  ingest?: (paths: EventStorePaths) => Promise<IngestReport>;
  /**
   * The liveness lines — the job heartbeat and the lost days — when this entry
   * point wants them. **OMITTED MEANS SILENT, AND THERE IS DELIBERATELY NO
   * DEFAULT.** Only `pnpm dev` supplies it; `report`, `spine` and the openTUI smoke
   * harness leave it out, so they never reach for the derivation at all. A default
   * here would make every entry point speak, which is the difference between a
   * startup channel you read and one you learn to scroll past.
   */
  livenessLines?: (() => Promise<string[]>) | undefined;
  /**
   * The fold's dropped-event lines (PRD #323 seam E), for the entry point that wants
   * them. **OMITTED MEANS SILENT, AND THERE IS DELIBERATELY NO DEFAULT** — the same
   * rule {@link livenessLines} states and for the same reason: `report`, `spine` and
   * `plans` enumerate their own fold's discards at their own call site, so a default
   * here would print them twice on those surfaces and once on surfaces that never
   * asked. Only `pnpm dev` supplies it, because only `pnpm dev` hands the terminal to
   * a renderer and has nowhere else to say it.
   *
   * It takes the resolved `asOf` because the fold this reports on must be the fold the
   * dashboard will render — reporting current-state discards over an `--as-of 2026-06-30`
   * view would name events the rendered fold never even read.
   */
  foldLines?: ((asOf: string | undefined) => Promise<string[]>) | undefined;
}

/**
 * The user-facing one-liner surfaced before the dashboard mounts: how many new
 * transactions were ingested and how many duplicates were skipped. Kept as a pure
 * function so the wording the user reads is pinned by a test, independent of the
 * stderr/alternate-screen plumbing that carries it.
 */
export function formatIngestReport(report: IngestReport): string {
  return (
    `Numisma: ${report.newCount} new transaction(s) ingested, ` +
    `${report.duplicateCount} duplicate(s) skipped.`
  );
}

/**
 * Run the startup data path: parse `--as-of`, ingest the inbox (dedup / append /
 * archive), surface the count report, and return the fold loader + source label.
 * Throws on a malformed `--as-of` or a fail-loud ingest rejection so the host can
 * exit non-zero with the durable log left unchanged — the report is emitted only
 * after a successful ingest, so a rejected startup surfaces the error, not a count.
 *
 * Note: `parseAsOfArg` validates only the `YYYY-MM-DD` shape. The semantic guard
 * (an `asOf` earlier than `genesis.review.asOf`) lives in the engine fold and is
 * reached lazily through the `loadData` thunk, not here — deliberately, so this
 * seam stays pure orchestration and does not duplicate the engine's genesis read
 * (ADR-001). The consequence is surface-dependent and intentional: `pnpm spine` /
 * `report` await the fold inside their own try/catch and exit non-zero, while the
 * app path (`pnpm dev`) emits the ingest report, enters the alternate screen, then
 * renders mount-app's load-failure panel rather than exiting — graceful degradation
 * once the dashboard owns the terminal, not a missed fail-loud case.
 */
export async function prepareStartup(
  paths: EventStorePaths,
  argv: string[],
  deps: StartupDeps,
): Promise<StartupPlan> {
  const asOf = parseAsOfArg(argv);
  const ingest = deps.ingest ?? ingestInbox;
  const report = await ingest(paths);
  deps.emit(formatIngestReport(report));
  // AFTER the ingest report, deliberately: the ingest may have just appended the
  // very events the gap report is about, so it must run against the log as it now
  // stands. And guarded, because a liveness line must never be able to stop the
  // dashboard from mounting — `loadGapLines` already catches its own failures; this
  // is the seam refusing to trust that any injected adapter does.
  if (deps.livenessLines !== undefined) {
    let lines: string[];
    try {
      lines = await deps.livenessLines();
    } catch (error) {
      lines = [formatGapCheckFailure(error)];
    }
    for (const line of lines) {
      deps.emit(line);
    }
  }
  // A CO-TENANT ON THE SAME CHANNEL, filed under its own kind and bounded under its own
  // kind — `loadFoldLines` caps the fold's lines and `loadGapLines` caps the gap's,
  // each over its own lines and never over the concatenation, so neither can starve the
  // other (PR #322's lesson; ADR-020's reserved capacity). Guarded here for the same
  // reason the liveness lines are: a diagnostic must never be able to stop the
  // dashboard from mounting, and this seam refuses to trust that an injected adapter
  // catches its own failures.
  if (deps.foldLines !== undefined) {
    let lines: string[];
    try {
      lines = await deps.foldLines(asOf);
    } catch (error) {
      lines = [formatFoldCheckFailure(error)];
    }
    for (const line of lines) {
      deps.emit(line);
    }
  }
  const sourcePath = asOf ? `${paths.log} as-of ${asOf}` : paths.log;
  return {
    asOf,
    sourcePath,
    // THE WHOLE ENVELOPE, unwrapped nowhere in this seam — see {@link StartupPlan.loadData}.
    loadData: () => loadFoldedReview(paths, asOf),
  };
}
