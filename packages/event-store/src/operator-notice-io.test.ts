/**
 * The operator notice's IO shell, against real files in a throwaway data dir.
 *
 * Everything written here is SYNTHETIC and hand-authored — invented instrument
 * marks with round prices, a hand-built heartbeat. Nothing is seeded from a real
 * run's output. What is asserted is the shell's four jobs and nothing more: the
 * path it picks, that a clean window leaves an EMPTY file, that a dirty one carries
 * both signals in cause-then-effect order, and that it OVERWRITES rather than
 * appends or merges.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PortfolioEvent } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEventStorePaths, type EventStorePaths } from "./event-store.js";
import { HEARTBEAT_FILENAME } from "./heartbeat.js";
import {
  OPERATOR_NOTICE_FILENAME,
  loadOperatorNoticeLines,
  operatorNoticePath,
  writeOperatorNotice,
} from "./operator-notice-io.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

async function store(logLines: readonly string[]): Promise<EventStorePaths> {
  const dataDir = await mkdtemp(join(tmpdir(), "numisma-notice-"));
  created.push(dataDir);
  const paths = resolveEventStorePaths(dataDir);
  await writeFile(paths.log, logLines.map((line) => `${line}\n`).join(""), "utf8");
  return paths;
}

/** A hand-authored breadcrumb for a run that could not find node. */
async function seedFailedHeartbeat(paths: EventStorePaths, finishedAt: string): Promise<void> {
  await writeFile(
    join(dirname(paths.log), HEARTBEAT_FILENAME),
    `${JSON.stringify({
      schemaVersion: 2,
      startedAt: finishedAt,
      finishedAt,
      exitCode: 127,
      lastStep: "resolve-tools",
      markWindow: true,
      lastMarkWindowFinishedAt: finishedAt,
    })}\n`,
    "utf8",
  );
}

function event(date: string, instrumentId: string): string {
  const marked: PortfolioEvent = {
    id: `pm-${instrumentId}-${date}`,
    asOf: date,
    type: "PriceMarked",
    instrumentId,
    price: 100,
  };
  return JSON.stringify(marked);
}

/**
 * A WEEKEND window, narrow enough that the fixtures below decide its whole verdict.
 * Saturday and Sunday are the only days on which no venue but the daily one owes a
 * mark, so a clean fixture here is clean WITHOUT thirteen instruments — and the
 * venue-dark side stays out of assertions that are not about it.
 */
const WINDOW = { since: "2026-08-15", until: "2026-08-16" } as const;
const NOW = new Date("2026-08-17T20:00:00-06:00");
const CRYPTO_MARKS = ["2026-08-15", "2026-08-16"].flatMap((date) => [
  event(date, "btc"),
  event(date, "eth"),
  event(date, "render"),
  event(date, "gram"),
]);

describe("operatorNoticePath", () => {
  it("sits beside the log, under the caller's resolved data dir", async () => {
    const paths = await store([]);
    expect(operatorNoticePath(paths)).toBe(
      join(dirname(paths.log), OPERATOR_NOTICE_FILENAME),
    );
  });
});

describe("writeOperatorNotice", () => {
  it("writes an EMPTY file when the job is healthy and the window is clean", async () => {
    const paths = await store(CRYPTO_MARKS);
    const written = await writeOperatorNotice(paths, { now: NOW, window: WINDOW });
    expect(written).toBe(operatorNoticePath(paths));
    expect(await readFile(written, "utf8")).toBe("");
    expect((await stat(written)).size).toBe(0);
  });

  it("carries the heartbeat's cause before the lost days it explains", async () => {
    const paths = await store([]);
    await seedFailedHeartbeat(paths, "2026-08-14T18:30:00-06:00");
    const written = await writeOperatorNotice(paths, { now: NOW, window: WINDOW });
    const lines = (await readFile(written, "utf8")).trimEnd().split("\n");
    expect(lines[0]).toContain("FAILED on 2026-08-14");
    expect(lines.some((line) => line.includes("NO DATA"))).toBe(true);
    expect(lines).toContain(
      "Numisma: 2026-08-16 — recover with: pnpm prices:fetch --as-of=2026-08-16",
    );
    expect(await readFile(written, "utf8")).toMatch(/\n$/);
  });

  it("OVERWRITES a previous run's notice rather than appending to it", async () => {
    const paths = await store([]);
    await writeFile(operatorNoticePath(paths), "Numisma: STALE NEWS from the last run.\n", "utf8");
    const written = await writeOperatorNotice(paths, { now: NOW, window: WINDOW });
    const body = await readFile(written, "utf8");
    expect(body).not.toContain("STALE NEWS");
    expect(body).toContain("NO DATA");
  });

  it("clears a previous run's notice to EMPTY once the window is clean again", async () => {
    const paths = await store(CRYPTO_MARKS);
    await writeFile(operatorNoticePath(paths), "Numisma: STALE NEWS from the last run.\n", "utf8");
    const written = await writeOperatorNotice(paths, { now: NOW, window: WINDOW });
    expect(await readFile(written, "utf8")).toBe("");
  });
});

describe("loadOperatorNoticeLines", () => {
  it("reports a BROKEN derivation as a line instead of throwing", async () => {
    const paths = await store([event("2026-08-15", "btc"), "{ not json at all"]);
    const lines = await loadOperatorNoticeLines(paths, NOW, WINDOW);
    expect(lines.some((line) => line.startsWith("Numisma: lost days were NOT checked ("))).toBe(
      true,
    );
  });

  it("treats an ABSENT log as a window with no anchors, not as a broken check", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "numisma-notice-"));
    created.push(dataDir);
    const paths = resolveEventStorePaths(dataDir);
    const lines = await loadOperatorNoticeLines(paths, NOW, WINDOW);
    // A machine that never hosted the job has no log and no heartbeat. That is not a
    // failure to derive — it is a window in which every day is lost, and saying so is
    // the whole point. "NOT checked" here would hide two real lost days behind a
    // diagnostic about the checker.
    expect(lines.some((line) => line.includes("NOT checked"))).toBe(false);
    expect(lines.filter((line) => line.includes("NO DATA"))).toHaveLength(2);
    expect(lines.every((line) => !line.includes("daily price job"))).toBe(true);
  });
});
