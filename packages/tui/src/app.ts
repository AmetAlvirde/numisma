import { mountApp } from "./mount-app.js";
import {
  ingestInbox,
  loadFoldedReview,
  parseAsOfArg,
  resolveEventStorePaths,
  type EventStorePaths,
} from "./event-store.js";

// PROTOTYPE (mvi 2026-06-29-portfolio-persistence): the real TUI surface now
// renders the FOLD over the event log, not a single hand-edited snapshot. On
// startup it ingests any dropped inbox, then folds genesis + log to `--as-of`
// (or current state). SHORTCUT: the ingest report is written to stderr before
// the alternate screen takes over (no in-TUI banner yet); `r` reloads = re-fold
// (the same data file evolves only when a new inbox is dropped + restarted).
const paths = resolveStartupEventStorePaths();
const asOf = resolveStartupAsOf();
const sourcePath = asOf ? `${paths.log} as-of ${asOf}` : paths.log;

await runStartupIngest(paths);

const core = await loadOpenTuiCore();
const renderer = await core.createCliRenderer({
  exitOnCtrlC: true,
  clearOnShutdown: true,
  consoleMode: "disabled",
  screenMode: "alternate-screen",
  targetFps: 20,
});

await mountApp(renderer, {
  core,
  loadData: () => loadFoldedReview(paths, asOf),
  sourcePath,
});

renderer.start();

function resolveStartupEventStorePaths(): EventStorePaths {
  return resolveEventStorePaths();
}

function resolveStartupAsOf(): string | undefined {
  try {
    return parseAsOfArg(process.argv);
  } catch (error) {
    failStartup(error);
  }
}

async function runStartupIngest(storePaths: EventStorePaths): Promise<void> {
  try {
    const report = await ingestInbox(storePaths);
    process.stderr.write(
      `Numisma: ${report.newCount} new transaction(s) ingested, ` +
        `${report.duplicateCount} duplicate(s) skipped.\n`,
    );
  } catch (error) {
    failStartup(error);
  }
}

function failStartup(error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exit(1);
}

async function loadOpenTuiCore(): Promise<typeof import("@opentui/core")> {
  try {
    return await import("@opentui/core");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `openTUI could not load in this runtime. @opentui/core currently needs Bun or a Node build that exposes node:ffi. This prototype uses Bun only to run openTUI while keeping pnpm for package management. Runtime: ${process.release.name} ${process.version}. Original error: ${detail}`,
    );
  }
}
