/**
 * The Discard Channel at the push (spec #320, slice #331) — REPORT, NEVER REFUSE.
 *
 * `loadPreferences` already returns its discards (slice 1). This file pins what the
 * unattended shells do with them, and the ORDER in which they do it: the snapshot is
 * upserted FIRST and the diagnostic is emitted AFTER. `buildGlanceForAnchor` runs
 * before `upsertSnapshot`, so a diagnostic raised at load time is one refactor away
 * from withholding the push; the ordering is asserted here rather than assumed from
 * the shape of `push.ts`.
 *
 * NO DATABASE and NO private data: a throwaway store on disk plus a fake pool that
 * records the SQL it is handed, exactly like `backfill-core.test.ts`. Every sidecar
 * line below is AUTHORED — invented policy for an invented reserve, never a copy of
 * anything the fund actually holds — and so is every expected diagnostic string.
 */
import { rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  resolvePreferencesPath,
  unattendedPreferencesVerdict,
} from "@numisma/preferences";
import { runBackfill } from "./backfill-core.ts";
import {
  buildDcaForAnchor,
  buildGlanceForAnchor,
  loadCurrentFold,
  PREFERENCES_DIAGNOSTIC_KIND,
  pushAnchorAndReport,
} from "./push-core.ts";
import { RunReport } from "./unattended-report.ts";
import { makeTempStore, priceMarkedLine } from "./push-core.fixtures.ts";

/** Two anchored dates, so the backfill's per-run dedup has something to loop over. */
const TWO_ANCHORS =
  `${priceMarkedLine("m1", "2026-06-05", 160)}\n` +
  `${priceMarkedLine("m2", "2026-06-09", 175)}\n`;

const ANCHOR = "2026-06-09";

/**
 * An AUTHORED policy line the validator accepts: a 25% reserve floor effective the day
 * after the temp store's genesis, routing to an invented reserve id.
 */
const ACCEPTED_POLICY = JSON.stringify({
  effectiveAt: "2026-06-02",
  split: { wealth: 7, reserve: 3 },
  splitBasis: "perClose",
  routingReserveId: "authored-reserve-alpha",
  reserveTargetPct: 25,
});

/**
 * An AUTHORED policy line the validator REJECTS, for `effective-at`: 2026-02-30 is
 * shaped like an ISO date and is not one. Its `routingReserveId` carries a token found
 * nowhere else in the suite, so "the diagnostic never quotes the line" is checkable by
 * searching the emitted prose for it.
 */
const QUARANTINE_TOKEN = "authored-reserve-quarantine-token";
const REJECTED_POLICY = JSON.stringify({
  effectiveAt: "2026-02-30",
  split: { wealth: 7, reserve: 3 },
  splitBasis: "perClose",
  routingReserveId: QUARANTINE_TOKEN,
  reserveTargetPct: 25,
});

const dirs: string[] = [];
const savedDataDir = process.env.NUMISMA_DATA_DIR;

afterEach(async () => {
  if (savedDataDir === undefined) {
    delete process.env.NUMISMA_DATA_DIR;
  } else {
    process.env.NUMISMA_DATA_DIR = savedDataDir;
  }
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** A throwaway store holding `log`, and `preferences` when a sidecar is wanted. */
async function useStore(log: string, preferences?: string): Promise<string> {
  const { dir } = await makeTempStore(log);
  dirs.push(dir);
  process.env.NUMISMA_DATA_DIR = dir;
  if (preferences !== undefined) {
    await writeFile(resolvePreferencesPath(dir), preferences, "utf8");
  }
  return dir;
}

/**
 * A pool and an emitter that share ONE sequence log, which is the only way to assert
 * "the upsert landed before the diagnostic" rather than merely believe it.
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

/** Fold one anchor and build everything the push hands to the upsert. */
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

describe("the push reports what it discarded, AFTER it has pushed", () => {
  it("upserts the snapshot, names the line and the reason, and finishes non-zero", async () => {
    await useStore(TWO_ANCHORS, `${ACCEPTED_POLICY}\n${REJECTED_POLICY}\n`);
    const run = recordingRun();

    const { exitCode } = await pushOnce(run, new RunReport());

    // 1. The snapshot landed. This is the conjunct the whole idiom exists to protect.
    expect(run.sequence.filter((step) => step === "upsert")).toHaveLength(1);
    // 2. One diagnostic, naming the file, the 1-based line and the closed-vocabulary
    //    reason. Line 2 is the rejected one; line 1 was accepted.
    expect(run.emitted).toHaveLength(1);
    expect(run.emitted[0]).toContain("preferences.jsonl");
    expect(run.emitted[0]).toContain("line 2");
    expect(run.emitted[0]).toContain("effective-at");
    // 3. The run is marked. An unread stderr log is not a report.
    expect(exitCode).not.toBe(0);
  });

  it("emits only AFTER the upsert has landed", async () => {
    await useStore(TWO_ANCHORS, `${ACCEPTED_POLICY}\n${REJECTED_POLICY}\n`);
    const run = recordingRun();

    await pushOnce(run, new RunReport());

    // The ordering IS the ruling: a diagnostic raised before the write could withhold
    // the write. `indexOf` rather than `[0]` so the assertion still means something if
    // a second diagnostic kind joins the channel.
    expect(run.sequence.indexOf("upsert")).toBeLessThan(run.sequence.indexOf("emit"));
  });

  it("never quotes the rejected line", async () => {
    await useStore(TWO_ANCHORS, `${ACCEPTED_POLICY}\n${REJECTED_POLICY}\n`);
    const run = recordingRun();

    await pushOnce(run, new RunReport());

    expect(run.emitted.join("\n")).not.toContain(QUARANTINE_TOKEN);
    expect(run.emitted.join("\n")).not.toContain("2026-02-30");
  });

  it("REFUSAL IS IMPOSSIBLE: every line rejected still publishes, with no floor invented", async () => {
    await useStore(
      TWO_ANCHORS,
      `${REJECTED_POLICY}\nthis line is authored garbage, not JSON\n`,
    );
    const run = recordingRun();
    const channel = new RunReport();

    const { derived, exitCode } = await pushOnce(run, channel);

    expect(run.sequence.filter((step) => step === "upsert")).toHaveLength(1);
    // R1 — no floor is ever invented. The slot suppresses; the run still publishes.
    expect(derived.report.glance.reserveTargetPct).toBeUndefined();
    expect(run.emitted).toHaveLength(2);
    expect(exitCode).not.toBe(0);
  });

  it("exits ZERO for a missing sidecar — the normal starting state, not an anomaly", async () => {
    await useStore(TWO_ANCHORS);
    const run = recordingRun();

    const { exitCode } = await pushOnce(run, new RunReport());

    expect(exitCode).toBe(0);
    expect(run.emitted).toEqual([]);
  });

  it("exits ZERO for a clean sidecar", async () => {
    await useStore(TWO_ANCHORS, `${ACCEPTED_POLICY}\n`);
    const run = recordingRun();

    const { derived, exitCode } = await pushOnce(run, new RunReport());

    expect(exitCode).toBe(0);
    expect(run.emitted).toEqual([]);
    expect(derived.report.glance.reserveTargetPct).toBe(25);
  });
});

describe("CHANNEL SEPARATION — the operator's log is not the phone's payload", () => {
  it("no preferences diagnostic reaches the glance block or the projection payload", async () => {
    await useStore(TWO_ANCHORS, `${ACCEPTED_POLICY}\n${REJECTED_POLICY}\n`);
    const run = recordingRun();

    const { derived } = await pushOnce(run, new RunReport());

    const wire = JSON.stringify(derived.report);
    for (const token of [
      "skipped",
      "effective-at",
      "preferences.jsonl",
      QUARANTINE_TOKEN,
    ]) {
      expect(wire).not.toContain(token);
    }
    // The glance the payload was built from carries the FLOOR and nothing about how
    // the floor was read. Asserted as a SUBSET of the wire's own closed key set
    // (`projection-payload.test.ts` owns that set) rather than an equality, so this
    // test fails on a leaked diagnostic key and not on an unrelated wire addition.
    const WIRE_GLANCE_KEYS = [
      "reserveTargetPct",
      "feedGap",
      "suppressed",
      "venueDark",
    ];
    for (const key of Object.keys(derived.report.glance)) {
      expect(WIRE_GLANCE_KEYS).toContain(key);
    }
  });
});

describe("CO-TENANCY — this report claims the channel, not the surface", () => {
  it("emits a co-tenant kind's lines beside its own, and returns only ITS OWN exit code", async () => {
    await useStore(TWO_ANCHORS, `${ACCEPTED_POLICY}\n${REJECTED_POLICY}\n`);
    const run = recordingRun();
    const channel = new RunReport();
    // A stand-in for a second diagnostic kind that filed BEFORE the push ran — the
    // shape #326's fold report will take. It is authored and means nothing.
    channel.add("co-tenant", ["a co-tenant kind had something to say"]);

    const { exitCode } = await pushAnchorAndReport({
      pool: run.pool,
      report: (await loadCurrentFold(ANCHOR)).report,
      anchor: await buildGlanceForAnchor(await loadCurrentFold(ANCHOR)),
      dca: await buildDcaForAnchor(await loadCurrentFold(ANCHOR)),
      channel,
      emit: run.emit,
    });

    // Both kinds reached the operator. Neither starved the other.
    expect(run.emitted).toContain("a co-tenant kind had something to say");
    expect(run.emitted.some((line) => line.includes("line 2"))).toBe(true);
    // The returned code is the PREFERENCES verdict alone. A co-tenant whose policy is
    // prose-only-and-always-zero composes by folding its own code in at the shell; it
    // does not have this one imposed on it, and cannot impose its own here.
    expect(exitCode).toBe(1);
    expect(channel.linesFor("co-tenant")).toHaveLength(1);
  });
});

describe("THE BACKFILL LOOPS, SO THE REPORT MUST NOT", () => {
  it("reports each distinct skip once per RUN, not once per anchor", async () => {
    await useStore(TWO_ANCHORS, `${ACCEPTED_POLICY}\n${REJECTED_POLICY}\n`);
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    const channel = new RunReport();
    let exitCode = 0;

    const results = await runBackfill({
      pool,
      // Exactly the three lines `backfill.ts` runs: verdict, prose to the channel,
      // exit code accumulated SEPARATELY from the prose.
      onPreferencesLoad: (loaded) => {
        const verdict = unattendedPreferencesVerdict(loaded);
        channel.add(PREFERENCES_DIAGNOSTIC_KIND, verdict.messages);
        exitCode = Math.max(exitCode, verdict.exitCode);
      },
    });

    // Two anchors, each of which re-read the sidecar and re-found the same bad line.
    expect(results).toHaveLength(2);
    expect(channel.linesFor(PREFERENCES_DIAGNOSTIC_KIND)).toHaveLength(1);
    expect(exitCode).not.toBe(0);
  });
});
