/**
 * The composed liveness channel: the job heartbeat and the lost days, in the order
 * an operator needs them, on the one pre-alternate-screen surface.
 *
 * Synthetic events and synthetic breadcrumbs in a throwaway store.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { PortfolioEvent } from "@numisma/engine";
import { heartbeatPath, resolveEventStorePaths, type EventStorePaths } from "@numisma/event-store";
import { afterEach, describe, expect, it } from "vitest";
import { loadLivenessLines } from "./liveness-lines.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

const NOW = new Date("2026-08-05T12:00:00Z"); // ceiling = 2026-08-04

function mark(date: string): PortfolioEvent {
  return { id: `pm-cx-a-${date}`, asOf: date, type: "PriceMarked", instrumentId: "cx-a", price: 100 };
}

/** A heartbeat in the wrapper's exact printf shape. `day` is the CDMX run day. */
function heartbeat(day: string, exitCode: number, lastStep: string): string {
  const utcStamp = `${new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T00:05:00Z`;
  return (
    `{\n  "schemaVersion": 1,\n  "startedAt": "${utcStamp}",\n` +
    `  "finishedAt": "${utcStamp}",\n  "exitCode": ${exitCode},\n  "lastStep": "${lastStep}"\n}\n`
  );
}

async function store(options: { events?: readonly PortfolioEvent[]; heartbeat?: string }) {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-liveness-"));
  created.push(dir);
  const paths: EventStorePaths = resolveEventStorePaths(dir);
  await writeFile(
    paths.log,
    (options.events ?? []).map((event) => `${JSON.stringify(event)}\n`).join(""),
    "utf8",
  );
  if (options.heartbeat !== undefined) {
    await writeFile(heartbeatPath(paths), options.heartbeat, "utf8");
  }
  return paths;
}

describe("loadLivenessLines", () => {
  it("says NOTHING when the job ran clean and no day is lost", async () => {
    const paths = await store({
      events: [mark("2026-08-04")],
      heartbeat: heartbeat("2026-08-04", 0, "complete"),
    });
    expect(await loadLivenessLines(paths, NOW, { since: "2026-08-04" })).toEqual([]);
  });

  it("puts the heartbeat FIRST — the cause before the effect", async () => {
    // A failed run is why the days are lost. Reading the consequence first and the
    // reason last is the wrong way round on a channel you scan in two seconds.
    const paths = await store({
      events: [mark("2026-08-02")],
      heartbeat: heartbeat("2026-08-04", 127, "resolve-tools"), // ran, and failed
    });
    const lines = await loadLivenessLines(paths, NOW, { since: "2026-08-02" });
    expect(lines[0]).toContain("FAILED");
    expect(lines[0]).toContain("exit 127");
    expect(lines.slice(1)).toHaveLength(2); // 08-03 and 08-04
    expect(lines.slice(1).every((line) => line.includes("the day is lost"))).toBe(true);
  });

  it("keeps every heartbeat line ahead of the gap lines when the run is also stale", async () => {
    // A run that failed AND has not run since is two facts, so the heartbeat
    // contributes two lines. BOTH still precede the lost days.
    const paths = await store({
      events: [mark("2026-08-02")],
      heartbeat: heartbeat("2026-08-02", 127, "resolve-tools"),
    });
    const lines = await loadLivenessLines(paths, NOW, { since: "2026-08-02" });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("FAILED");
    expect(lines[1]).toContain("has not completed since");
    expect(lines.slice(2).every((line) => line.includes("the day is lost"))).toBe(true);
  });

  it("still names lost days when no heartbeat was ever written", async () => {
    // The backstop that makes heartbeat silence safe: no breadcrumb, but the marks
    // stopped landing, so the gap report speaks.
    const paths = await store({ events: [mark("2026-08-02")] });
    const lines = await loadLivenessLines(paths, NOW, { since: "2026-08-02" });
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.includes("the day is lost"))).toBe(true);
  });

  it("still speaks for a failed job on a day whose marks did land", async () => {
    // The complement: the fetch succeeded and the run died later (step 3 or 4), so
    // the log looks perfect and only the heartbeat knows.
    const paths = await store({
      events: [mark("2026-08-04")],
      heartbeat: heartbeat("2026-08-04", 1, "post-check"),
    });
    const lines = await loadLivenessLines(paths, NOW, { since: "2026-08-04" });
    expect(lines).toEqual([
      "Numisma: the daily price job FAILED on 2026-08-04 — exit 1 at step 'post-check'. " +
        "Nothing pushed this to you; that is why it is here.",
    ]);
  });

  it("never throws, whatever it finds on disk", async () => {
    const paths = await store({ events: [mark("2026-08-04")], heartbeat: "{ truncat" });
    await expect(loadLivenessLines(paths, NOW, { since: "2026-08-04" })).resolves.toEqual([]);
  });
});
