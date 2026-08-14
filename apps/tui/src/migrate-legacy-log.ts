/**
 * One-shot runner for the durable-log migration (ADR-003 amendment, PRD #82 slice
 * M1). Reads an operator-authored `data/migration-cash-legs.json` — a map from a
 * legacy open/close event `id` to the real cash leg it was missing — and rewrites
 * `data/events.jsonl` in place to the v2 cash-leg shape via `migrateLegacyLog`.
 *
 * The cash leg CANNOT be reconstructed by code (the settling Reserve and the
 * proceeds/funding split are real-world facts only the operator holds), so this tool
 * grafts what the operator supplies and re-validates through the same ingest gates
 * every event passes; it fails loud and writes nothing if any legacy record has no
 * supplied leg, or if a supplied leg is invalid or non-conserving. This is a
 * deliberate one-time reconstruction — append-only holds going forward.
 *
 * The mapping file lives under `data/` (git-ignored: `*.json`), so no real
 * transaction amounts enter the repo. Shape:
 *
 *   {
 *     "<closeEventId>": { "settlement": { "reserveId": "<id>", "proceeds": 123.45 } },
 *     "<openEventId>":  { "funding":    { "reserveId": "<id>", "amount":   678.90 } }
 *   }
 *
 * Run: `pnpm migrate:log`.
 */
import { readFile } from "node:fs/promises";
import type { SuppliedCashLeg } from "@numisma/engine";
import { formatFoldDiscards, resolveEventStorePaths } from "@numisma/event-store";
import { migrateLegacyLog } from "./event-store.js";

const MAPPING_PATH = "data/migration-cash-legs.json";

async function readCashLegs(): Promise<Map<string, SuppliedCashLeg>> {
  let raw: string;
  try {
    raw = await readFile(MAPPING_PATH, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      // No mapping yet: let migrateLegacyLog fail loud, listing which ids need a leg.
      return new Map();
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as Record<string, SuppliedCashLeg>;
  return new Map(Object.entries(parsed));
}

async function main(): Promise<void> {
  const paths = resolveEventStorePaths();
  const cashLegs = await readCashLegs();
  const report = await migrateLegacyLog(paths, cashLegs);
  // What the migration's own folds read and could not apply, to stderr — the operator is
  // standing here and this is the one path the ingest gates never covered (#293). It
  // does not change the outcome below: the rewrite already happened and it preserved
  // this history verbatim, damage included (ADR-020, report never refuse). Empty on a
  // clean log, so a clean migration's output is byte-identical to before.
  for (const line of formatFoldDiscards({ skipped: report.discarded })) {
    process.stderr.write(`${line}\n`);
  }
  const touched = report.migratedCount + report.unchangedCount;
  if (touched === 0) {
    process.stdout.write(`No durable log to migrate at ${report.outputPath}.\n`);
    return;
  }
  process.stdout.write(
    `Migration complete: ${report.migratedCount} legacy record(s) migrated, ` +
      `${report.unchangedCount} unchanged. Log rewritten at ${report.outputPath}.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
