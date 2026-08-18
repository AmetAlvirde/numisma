/**
 * THE FOLD'S DISCARD CHANNEL AT THE UNATTENDED SURFACES (spec #323 slice E, seam E) —
 * the fold's half of ADR-020, one surface over from the preferences sidecar's.
 *
 * `foldEvents` already returns `{data, skipped}` (slice A) and `loadFoldedReview`
 * already propagates it (slice B). This file pins what the two UNATTENDED shells do
 * with it, and the three properties that make the daily channel survivable:
 *
 *  - **One fixed line with a COUNT, never an enumeration.** This line prints daily,
 *    forever. An enumeration is three lines today and forty in a year on the only
 *    daily-read channel, which is PR #322's `formatGapReport` starvation finding one
 *    surface over. The 40-drop test below is the ruling in executable form.
 *  - **Exit ZERO.** A fold discard's locator points into an append-only log, so it
 *    never extinguishes (ADR-020 / spec §3). A permanently-red errand channel is one
 *    nobody reads, and it would be retired for the next real failure.
 *  - **Publish first, report after** — asserted through one shared sequence log, not
 *    read off `push.ts`'s line order (that file is a self-executing script no test may
 *    import).
 *
 * NO DATABASE and NO private data: a throwaway store on disk plus a fake pool that
 * records the SQL it is handed, exactly like `discard-channel.test.ts` beside it.
 * Every event line below is AUTHORED — invented ids naming an invented reserve that
 * was never opened — and so is every expected string.
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { runBackfillAndReport } from "./backfill-core.ts";
import {
  buildDcaForAnchor,
  buildGlanceForAnchor,
  FOLD_DIAGNOSTIC_KIND,
  loadCurrentFold,
  pushAnchorAndReport,
} from "./push-core.ts";
import { RunReport } from "./unattended-report.ts";
import { makeTempStore, priceMarkedLine } from "./push-core.fixtures.ts";

/**
 * A reserve id the authored genesis seed does not declare. Every `Deposit` below names
 * it, so the fold reads the event and drops its cash leg — drop kind 4, the one
 * reachable from all eight `applyToReserve` call sites.
 */
const ABSENT_RESERVE = "authored-reserve-never-opened";

/** One authored `Deposit` onto the absent reserve. `id` is the locator the fold reports. */
function droppedDepositLine(id: string, asOf: string): string {
  return JSON.stringify({
    id,
    asOf,
    type: "Deposit",
    reserveId: ABSENT_RESERVE,
    amount: 250,
    tier: "c1",
  });
}

/** Two anchored dates, so the backfill's per-run dedup has something to loop over. */
const CLEAN_TWO_ANCHORS =
  `${priceMarkedLine("m1", "2026-06-05", 160)}\n` +
  `${priceMarkedLine("m2", "2026-06-09", 175)}\n`;

/** The same two anchors, plus ONE dropped event dated on the FIRST of them. */
const ONE_DROP_TWO_ANCHORS =
  `${priceMarkedLine("m1", "2026-06-05", 160)}\n` +
  `${droppedDepositLine("authored-drop-1", "2026-06-05")}\n` +
  `${priceMarkedLine("m2", "2026-06-09", 175)}\n`;

const ANCHOR = "2026-06-09";

const dirs: string[] = [];
const savedDataDir = process.env.NUMISMA_DATA_DIR;

afterEach(async () => {
  // A GENUINE ABSENCE, never `?? ""`. This delete-vs-assign restore is MORE correct
  // since #348, not less: `resolveDataDir` no longer treats a set-but-empty env var as
  // unset — it REFUSES it. So `?? ""` here would not quietly aim a later test at the
  // operator's REAL private ledger any more; it would blow up every subsequent resolve
  // in the process instead. Deleting the variable is the only restore that returns the
  // environment to the state the suite found it in.
  if (savedDataDir === undefined) {
    delete process.env.NUMISMA_DATA_DIR;
  } else {
    process.env.NUMISMA_DATA_DIR = savedDataDir;
  }
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function useStore(log: string): Promise<string> {
  const { dir } = await makeTempStore(log);
  dirs.push(dir);
  process.env.NUMISMA_DATA_DIR = dir;
  return dir;
}

/**
 * A pool and an emitter sharing ONE sequence log — the only way to assert "the upsert
 * landed before the diagnostic" rather than merely believe it.
 */
function recordingRun(): {
  pool: Pool;
  emit: (line: string) => void;
  sequence: string[];
  emitted: string[];
} {
  const sequence: string[] = [];
  const emitted: string[] = [];
  const pool = {
    query: async () => {
      sequence.push("upsert");
      return { rows: [] };
    },
  } as unknown as Pool;
  return {
    pool,
    emit: (line: string) => {
      sequence.push("emit");
      emitted.push(line);
    },
    sequence,
    emitted,
  };
}

/** Fold one anchor and drive the SHELL's own function, never a copy of its lines. */
async function pushOnce(run: ReturnType<typeof recordingRun>, channel: RunReport) {
  const fold = await loadCurrentFold(ANCHOR);
  const anchor = await buildGlanceForAnchor(fold);
  const dca = await buildDcaForAnchor(fold);
  return pushAnchorAndReport({
    pool: run.pool,
    report: fold.report,
    anchor,
    dca,
    channel,
    emit: run.emit,
  });
}

describe("the push reports what the FOLD dropped, after it has pushed", () => {
  it("upserts, exits ZERO, and prints exactly one fixed-form line carrying the count", async () => {
    await useStore(ONE_DROP_TWO_ANCHORS);
    const run = recordingRun();
    const channel = new RunReport();

    const { exitCode } = await pushOnce(run, channel);

    // 1. The snapshot landed. The conjunct the whole idiom exists to protect.
    expect(run.sequence.filter((step) => step === "upsert")).toHaveLength(1);
    // 2. ONE line, under the fold's own kind, carrying the count.
    const lines = channel.linesFor(FOLD_DIAGNOSTIC_KIND);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("1 event(s)");
    expect(run.emitted).toEqual(lines);
    // 3. Exit ZERO. The errand channel stays reserved for failures that extinguish.
    expect(exitCode).toBe(0);
  });

  it("is BYTE-IDENTICAL to today's output over a clean log", async () => {
    await useStore(CLEAN_TWO_ANCHORS);
    const run = recordingRun();
    const channel = new RunReport();

    const { exitCode } = await pushOnce(run, channel);

    expect(run.emitted).toEqual([]);
    expect(channel.isEmpty).toBe(true);
    expect(exitCode).toBe(0);
  });

  it("emits only AFTER the upsert has landed", async () => {
    await useStore(ONE_DROP_TWO_ANCHORS);
    const run = recordingRun();

    await pushOnce(run, new RunReport());

    expect(run.sequence.indexOf("upsert")).toBeLessThan(run.sequence.indexOf("emit"));
  });

  it("stays ONE line at FORTY distinct drops — the ruling, not a threshold", async () => {
    // Forty authored deposits, each with its own id, each naming the absent reserve.
    // An enumeration would print forty lines on the surface that prints daily forever.
    const drops = Array.from({ length: 40 }, (_, n) =>
      droppedDepositLine(`authored-drop-${n + 1}`, "2026-06-05"),
    ).join("\n");
    await useStore(
      `${priceMarkedLine("m1", "2026-06-05", 160)}\n${drops}\n` +
        `${priceMarkedLine("m2", "2026-06-09", 175)}\n`,
    );
    const run = recordingRun();
    const channel = new RunReport();

    const { exitCode } = await pushOnce(run, channel);

    expect(channel.linesFor(FOLD_DIAGNOSTIC_KIND)).toHaveLength(1);
    expect(run.emitted).toHaveLength(1);
    expect(run.emitted[0]).toContain("40 event(s)");
    // The count is the only variable part: no id, no verb, no reserve name, no figure.
    expect(run.emitted[0]).not.toContain(ABSENT_RESERVE);
    for (let n = 1; n <= 40; n += 1) {
      expect(run.emitted[0]).not.toContain(`authored-drop-${n}`);
    }
    expect(run.emitted[0]).not.toContain("Deposit");
    expect(exitCode).toBe(0);
  });
});

describe("CHANNEL SEPARATION — the operator's log is not the phone's payload", () => {
  it("no fold diagnostic reaches the glance block or the projection payload", async () => {
    await useStore(ONE_DROP_TWO_ANCHORS);
    const run = recordingRun();

    const { derived } = await pushOnce(run, new RunReport());

    const wire = JSON.stringify(derived.report);
    for (const token of ["skipped", "reserve-absent", "authored-drop-1", ABSENT_RESERVE]) {
      expect(wire).not.toContain(token);
    }
    const WIRE_GLANCE_KEYS = ["reserveTargetPct", "feedGap", "suppressed", "venueDark"];
    for (const key of Object.keys(derived.report.glance)) {
      expect(WIRE_GLANCE_KEYS).toContain(key);
    }
  });
});

describe("CO-TENANCY — the fold kind neither starves nor is starved", () => {
  it("survives a co-tenant that files far past the per-kind bound", async () => {
    await useStore(ONE_DROP_TWO_ANCHORS);
    const run = recordingRun();
    const channel = new RunReport();
    // 500 authored lines from another kind, filed BEFORE the push ran. Under a
    // bound over the CONCATENATION the fold's single line would never be seen.
    channel.add(
      "authored-co-tenant",
      Array.from({ length: 500 }, (_, n) => `authored co-tenant line ${n + 1}`),
    );

    await pushOnce(run, channel);

    expect(run.emitted.some((line) => line.includes("1 event(s)"))).toBe(true);
    expect(channel.linesFor(FOLD_DIAGNOSTIC_KIND)).toHaveLength(1);
  });
});

describe("THE BACKFILL FOLDS PER ANCHOR, SO THE REPORT MUST NOT", () => {
  it("reports each distinct skip once per RUN, over two anchors, and exits zero", async () => {
    await useStore(ONE_DROP_TWO_ANCHORS);
    const run = recordingRun();
    const channel = new RunReport();

    const { results, exitCode } = await runBackfillAndReport({
      pool: run.pool,
      channel,
      emit: run.emit,
    });

    // Two anchors: the 06-05 fold sees the drop, and so does the 06-09 fold, which
    // replays the same event again. One line, one count of ONE — not two lines, and
    // not a count of two.
    expect(results).toHaveLength(2);
    expect(channel.linesFor(FOLD_DIAGNOSTIC_KIND)).toHaveLength(1);
    expect(run.emitted).toHaveLength(1);
    expect(run.emitted[0]).toContain("1 event(s)");
    expect(exitCode).toBe(0);
  });

  it("emits ONCE, after the LAST anchor has been upserted", async () => {
    await useStore(ONE_DROP_TWO_ANCHORS);
    const run = recordingRun();

    await runBackfillAndReport({
      pool: run.pool,
      channel: new RunReport(),
      emit: run.emit,
      onComplete: () => {
        run.sequence.push("summary");
      },
    });

    expect(run.sequence).toEqual(["upsert", "upsert", "summary", "emit"]);
  });

  it("says nothing at all over a clean log", async () => {
    await useStore(CLEAN_TWO_ANCHORS);
    const run = recordingRun();
    const channel = new RunReport();

    await runBackfillAndReport({ pool: run.pool, channel, emit: run.emit });

    expect(channel.isEmpty).toBe(true);
    expect(run.emitted).toEqual([]);
  });
});
