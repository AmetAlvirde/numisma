/**
 * The gap report's ONE async surface, tested against a real log file on disk.
 *
 * The events written here are synthetic — invented instrument ids and round
 * numbers, no real position, price or balance. What is being asserted is the
 * shell's two jobs and nothing more: that it reads the log at the paths it was
 * HANDED (so a caller's `NUMISMA_DATA_DIR` resolution is honoured rather than
 * re-derived), and that it refuses to run on a partial log.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PortfolioEvent } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { loadGapReport } from "./gap-report-io.js";
import { resolveEventStorePaths } from "./event-store.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

/** A throwaway data dir holding exactly the log lines given. */
async function storeWithLog(lines: readonly string[]) {
  const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-"));
  created.push(dataDir);
  const paths = resolveEventStorePaths(dataDir);
  await writeFile(paths.log, lines.map((line) => `${line}\n`).join(""), "utf8");
  return paths;
}

function mark(date: string, instrumentId: string): PortfolioEvent {
  return { id: `pm-${instrumentId}-${date}`, asOf: date, type: "PriceMarked", instrumentId, price: 100 };
}

function deposit(date: string): PortfolioEvent {
  return { id: `dep-${date}`, asOf: date, type: "Deposit", reserveId: "cash-core", amount: 500, tier: "c1" };
}

const LATER = new Date("2026-08-05T12:00:00Z");

describe("loadGapReport", () => {
  it("derives the report from the log at the paths it was handed", async () => {
    const paths = await storeWithLog(
      [mark("2026-07-10", "cx-a"), deposit("2026-07-11"), mark("2026-07-12", "cx-a")].map((event) =>
        JSON.stringify(event),
      ),
    );
    const report = await loadGapReport(paths, {
      since: "2026-07-10",
      until: "2026-07-12",
      now: LATER,
    });
    expect(report.lost).toEqual([{ date: "2026-07-11", reason: "no-marks" }]);
    expect(report.anchorsChecked).toBe(3);
  });

  it("treats a missing log as a window with no anchors at all", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-"));
    created.push(dataDir);
    const report = await loadGapReport(resolveEventStorePaths(dataDir), {
      since: "2026-07-10",
      until: "2026-07-11",
      now: LATER,
    });
    expect(report.lost).toEqual([
      { date: "2026-07-10", reason: "no-anchor" },
      { date: "2026-07-11", reason: "no-anchor" },
    ]);
  });

  it("refuses to run on a partial log rather than inventing a lost day", async () => {
    // A quarantined line is a mark this derivation cannot see. Degrading
    // gracefully here would turn a corrupt line into a PHANTOM lost day — a
    // false positive manufactured by the reader, which is the one thing a
    // liveness detector must not do.
    const paths = await storeWithLog([
      JSON.stringify(mark("2026-07-10", "cx-a")),
      "{ this is not an event }",
    ]);
    await expect(
      loadGapReport(paths, { since: "2026-07-10", until: "2026-07-10", now: LATER }),
    ).rejects.toThrow(/quarantine/i);
  });
});
