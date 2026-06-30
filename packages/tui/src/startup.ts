/**
 * The startup data path the real app (`app.ts`, `pnpm dev`) and the openTUI
 * verification harness (`smoke-startup-openTui.ts`) both drive, extracted so the
 * sequence is exercised by tests rather than only by a hand-run terminal. Mirrors
 * the `mountApp` extraction (the render wiring) for the half before the renderer:
 * parse `--as-of`, ingest the inbox, surface the count report, and hand back the
 * fold loader + source label the renderer mounts.
 *
 * Per ADR-001 this is access-surface orchestration over `@numisma/engine`: the
 * fold and event validation stay in the engine; the IO (`ingestInbox`,
 * `loadFoldedReview`) stays in `event-store.ts`; this only sequences them.
 */
import type { FundReviewData } from "@numisma/engine";
import {
  ingestInbox,
  loadFoldedReview,
  parseAsOfArg,
  type EventStorePaths,
  type IngestReport,
} from "./event-store.js";

/** What the renderer needs after the startup data path runs. */
export interface StartupPlan {
  /** The resolved `--as-of` date, or undefined for current state. */
  asOf: string | undefined;
  /** Source label shown in the load footer. */
  sourcePath: string;
  /** Folds genesis + log to the resolved `asOf` (or current) for rendering. */
  loadData: () => Promise<FundReviewData>;
}

/** Seams the host injects: where the report goes, and (for tests) the ingest fn. */
export interface StartupDeps {
  /** Surface the one-line ingest report (stderr in the app; captured in tests). */
  emit: (line: string) => void;
  /** The inbox ingest. Defaults to the real {@link ingestInbox}. */
  ingest?: (paths: EventStorePaths) => Promise<IngestReport>;
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
  const sourcePath = asOf ? `${paths.log} as-of ${asOf}` : paths.log;
  return {
    asOf,
    sourcePath,
    loadData: () => loadFoldedReview(paths, asOf),
  };
}
