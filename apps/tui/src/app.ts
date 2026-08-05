import { mountApp } from "./mount-app.js";
import { resolveEventStorePaths } from "@numisma/event-store";
import { loadOrders, resolveOrdersPath } from "@numisma/preferences";
import { loadAvailableCapital } from "./available-capital.js";
import { prepareStartup, type StartupPlan } from "./startup.js";
import { loadGapLines } from "./gap-lines.js";

// PROTOTYPE (mvi 2026-06-29-portfolio-persistence): the real TUI surface now
// renders the FOLD over the event log, not a single hand-edited snapshot. On
// startup it ingests any dropped inbox, then folds genesis + log to `--as-of`
// (or current state). SHORTCUT: the ingest report is written to stderr before
// the alternate screen takes over (no in-TUI banner yet); `r` reloads = re-fold
// (the same data file evolves only when a new inbox is dropped + restarted). The
// startup data path itself lives in `prepareStartup` (a tested seam shared with
// the openTUI verification harness); this file owns only the renderer wiring.
const paths = resolveEventStorePaths();
const plan = await runStartup();

const core = await loadOpenTuiCore();
const renderer = await core.createCliRenderer({
  exitOnCtrlC: true,
  clearOnShutdown: true,
  consoleMode: "disabled",
  screenMode: "alternate-screen",
  targetFps: 20,
});

const ordersPath = resolveOrdersPath();

await mountApp(renderer, {
  core,
  loadData: plan.loadData,
  sourcePath: plan.sourcePath,
  // `S7` — the orders sidecar joined to the fold at READ time, as of the same date the
  // fold rendered. Never merged: the two files stay two files.
  loadAvailableCapital: (data) =>
    loadAvailableCapital(data, { ordersPath, loadOrders: (path) => loadOrders(path) }, plan.asOf),
});

renderer.start();

async function runStartup(): Promise<StartupPlan> {
  try {
    return await prepareStartup(paths, process.argv, {
      emit: (line) => process.stderr.write(`${line}\n`),
      // THE ONLY ENTRY POINT THAT ASKS. `report`, `spine` and the openTUI smoke
      // harness omit this, so they stay silent by construction rather than by a
      // flag. Lost days land on the same pre-alternate-screen channel as the ingest
      // report — the surface that reaches you without you going to look for it.
      gapLines: () => loadGapLines(paths, { now: new Date() }),
    });
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
