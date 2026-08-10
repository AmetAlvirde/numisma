/**
 * `pnpm plans` — the READ-ONLY desk command over the `plans.jsonl` sidecar.
 *
 * It reads two things and writes none: the fold (for which positions EXIST as of the
 * query date — the single fact that separates `pending` against `active`) and the
 * sidecar itself. It never appends a plan line, never touches git, and is not on the
 * ingest path, so a broken sidecar cannot kill the NAV fold or withhold a push. The
 * fold does not read this file at all.
 *
 * ADR-001's split, once more: every decision about what the file MEANS is pure
 * (`listPlansAsOf` in the engine, `formatPlansReport` beside this shell) and only the
 * two reads and the exit code live here.
 *
 * THE EXIT CODE IS THE POINT. `0` iff the file loaded and every line in it was
 * readable; otherwise non-zero, after the diagnostics are printed. The policy is
 * `unattendedPlansVerdict`'s, reached through the formatter — a launchd job's stderr
 * goes to a log nobody reads, so the verdict has to be a value something can check.
 *
 * `--as-of <YYYY-MM-DD>` renders the sidecar as the fund saw it on a prior date, the
 * same flag the fold surfaces take; with no flag the query date is TODAY in the
 * fund's own trading-day timezone, never the machine's idea of a date.
 */
import { tradingDayAsOf } from "@numisma/engine";
import { REPORT_TIME_ZONE, loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
import { loadPlans, resolvePlansPath } from "@numisma/preferences";
import { formatPlansReport } from "./plans-report.js";
import { parseAsOfArg } from "./spine-args.js";

try {
  const asOfFlag = parseAsOfArg(process.argv);
  const asOf = asOfFlag ?? tradingDayAsOf(new Date(), REPORT_TIME_ZONE);
  const data = await loadFoldedReview(resolveEventStorePaths(), asOfFlag);

  // BORN-NESS, from the fold: open positions and closed ones alike. A position that
  // has been closed was realized — it is not a declaration awaiting its first fill —
  // so omitting the closed book would render a finished trade `pending` forever.
  const existingPositionIds = new Set<string>([
    ...data.positions.map((position) => position.id),
    ...(data.closedPositions ?? []).map((closed) => closed.positionId),
  ]);

  const sourcePath = resolvePlansPath();
  const report = formatPlansReport({
    loaded: await loadPlans(sourcePath),
    asOf,
    existingPositionIds,
    sourcePath,
  });
  process.stdout.write(`${report.text}\n`);
  process.exitCode = report.exitCode;
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
}
