/**
 * The gap-line loader — the half of #185's TUI surface that was untestable as
 * written. The prototype reached `apps/web`'s derivation through a COMPUTED
 * specifier (`new URL(...).href`) precisely so `tsc` could not follow it, which
 * left the edge untypechecked and the loader undrivable. With the derivation in
 * `@numisma/event-store` — which `apps/tui` already declares — it is an ordinary
 * import and an ordinary function, so it gets ordinary tests.
 *
 * Synthetic events in a throwaway store. No real log is read.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { PortfolioEvent } from "@numisma/engine";
import { resolveEventStorePaths, type EventStorePaths } from "@numisma/event-store";
import { afterEach, describe, expect, it } from "vitest";
import { loadGapLines } from "./gap-lines.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

async function storeWithLog(lines: readonly string[]): Promise<EventStorePaths> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-gap-lines-"));
  created.push(dir);
  const paths = resolveEventStorePaths(dir);
  await writeFile(paths.log, lines.map((line) => `${line}\n`).join(""), "utf8");
  return paths;
}

function mark(date: string, instrumentId = "cx-a"): PortfolioEvent {
  return { id: `pm-${instrumentId}-${date}`, asOf: date, type: "PriceMarked", instrumentId, price: 100 };
}

function deposit(date: string): PortfolioEvent {
  return { id: `dep-${date}`, asOf: date, type: "Deposit", reserveId: "cash-core", amount: 500, tier: "c1" };
}

const NOW = new Date("2026-08-05T12:00:00Z"); // 06:00 CDMX; yesterday = 2026-08-04

describe("loadGapLines", () => {
  it("SAYS NOTHING when every day in the window carried a mark", async () => {
    // Silence is the feature. A startup channel that speaks on a healthy log is a
    // startup channel you learn to scroll past.
    const paths = await storeWithLog([JSON.stringify(mark("2026-08-04"))]);
    const lines = await loadGapLines(paths, { since: "2026-08-04", now: NOW });
    expect(lines).toEqual([]);
  });

  it("names each lost day, one line per day", async () => {
    const paths = await storeWithLog([
      JSON.stringify(mark("2026-08-02")),
      JSON.stringify(deposit("2026-08-03")),
    ]);
    const lines = await loadGapLines(paths, { since: "2026-08-02", now: NOW });
    expect(lines).toEqual([
      "Numisma: 2026-08-03 — NO MARKS. The day is anchored but no price mark landed on it; the day is lost.",
      "Numisma: 2026-08-04 — NO DATA. No event of any kind carries this date; the day is lost.",
    ]);
  });

  it("never names today, however late in the day the TUI is started", async () => {
    const paths = await storeWithLog([JSON.stringify(mark("2026-08-04"))]);
    // 23:59 CDMX on 2026-08-05 — the ceiling is still yesterday.
    const lines = await loadGapLines(paths, {
      since: "2026-08-04",
      now: new Date("2026-08-06T05:59:00Z"),
    });
    expect(lines.join("\n")).not.toContain("2026-08-05");
  });

  it("SAYS SO — non-fatally — when the report cannot be derived", async () => {
    // A liveness report that can brick the dashboard is worse than none, so this
    // never throws. But it must not go SILENT either: a detector that says nothing
    // when it is broken is indistinguishable from a detector saying "all clear",
    // which is the whole failure this increment exists to remove.
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-gap-lines-"));
    created.push(dir);
    const paths = resolveEventStorePaths(dir);
    await writeFile(paths.log, `${JSON.stringify(mark("2026-08-04"))}\n{ not an event }\n`, "utf8");

    const lines = await loadGapLines(paths, { since: "2026-08-04", now: NOW });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Numisma: lost days were NOT checked/);
    expect(lines[0]).toMatch(/quarantine/i);
  });

  it("reports an absent log as lost days rather than as a failure", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-gap-lines-"));
    created.push(dir);
    const paths = resolveEventStorePaths(dir);
    const lines = await loadGapLines(paths, { since: "2026-08-04", now: NOW });
    expect(lines).toEqual([
      "Numisma: 2026-08-04 — NO DATA. No event of any kind carries this date; the day is lost.",
    ]);
  });
});
