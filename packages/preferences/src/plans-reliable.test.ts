// PROTOTYPE (`prototype/plans-sidecar`) — the RELIABLE half of the DCA plan sidecar's
// IO: the genuinely append-only writer preserves prior lines so as-of replay stays
// honest; the validating loader parses the ENVELOPE BEFORE dispatching on `kind` and
// RETURNS every line it skipped, split into `unknownKind` (checkout older than data)
// vs `invalid` (corrupt) rather than dropping silently the way `loadPreferences`
// does; blank lines are tolerated; a missing file is not an error.
//
// EVERY LADDER HERE IS SYNTHETIC (`S8`, and the standing memory that transaction data
// is private). The real ladder's rung prices and sizes are FIGURES and live in
// accumulus; nothing in this file is a real number from the fund.
//
// Sibling: `preferences-reliable.test.ts`, whose shape this follows deliberately.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { DcaLadderPlan, DcaTimePlan } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { appendNoPlan, appendPlan, loadPlans, resolvePlansPath } from "./plans.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-plans-"));
  createdDirs.push(dir);
  const path = resolvePlansPath(resolve(dir, "data"));
  await mkdir(dirname(path), { recursive: true });
  return path;
}

/** A SYNTHETIC ladder. Round, obviously-invented numbers — never the fund's. */
function ladder(effectiveAt: string, positionId = "pos-synthetic-1"): DcaLadderPlan {
  return {
    kind: "dcaLadder",
    positionId,
    effectiveAt,
    tierOrder: ["c2", "c1"],
    rungs: [
      { id: "r1", priceUsd: 50_000, sizeUsd: 100 },
      { id: "r2", priceUsd: 45_000, sizeUsd: 200 },
    ],
  };
}

/** A SYNTHETIC cadence plan. */
function timed(effectiveAt: string, positionId = "pos-synthetic-1"): DcaTimePlan {
  return {
    kind: "dcaTime",
    positionId,
    effectiveAt,
    tierOrder: ["c1"],
    cadence: "weekly",
    amountUsd: 50,
    startsAt: effectiveAt,
  };
}

describe("appendPlan — genuinely append-only", () => {
  it("preserves ALL prior lines across successive appends", async () => {
    const path = await tempPath();
    await appendPlan(path, ladder("2026-06-01"));
    await appendPlan(path, ladder("2026-06-10"));
    await appendPlan(path, timed("2026-06-20"));

    const loaded = await loadPlans(path);
    expect(loaded.plans.map((p) => p.effectiveAt)).toEqual([
      "2026-06-01",
      "2026-06-10",
      "2026-06-20",
    ]);
    expect(loaded.plans.map((p) => p.kind)).toEqual(["dcaLadder", "dcaLadder", "dcaTime"]);
  });

  it("supersedes by appending, never by rewriting — the old line survives on disk", async () => {
    const path = await tempPath();
    await appendPlan(path, ladder("2026-06-01"));
    await appendPlan(path, ladder("2026-07-01"));

    // The whole basis of as-of replay: superseding must not destroy what it replaced.
    const raw = await readFile(path, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(raw).toContain("2026-06-01");
  });

  it("writes a noPlan terminator carrying its free-form reason", async () => {
    const path = await tempPath();
    await appendPlan(path, ladder("2026-06-01"));
    await appendNoPlan(path, "pos-synthetic-1", "2026-07-01", "ladder fully filled");

    const loaded = await loadPlans(path);
    expect(loaded.plans).toHaveLength(2);
    expect(loaded.plans[1]).toEqual({
      kind: "noPlan",
      positionId: "pos-synthetic-1",
      effectiveAt: "2026-07-01",
      reason: "ladder fully filled",
    });
  });

  it("omits `reason` entirely when none is given", async () => {
    const path = await tempPath();
    await appendNoPlan(path, "pos-synthetic-1", "2026-07-01");

    const loaded = await loadPlans(path);
    expect(loaded.plans[0]).not.toHaveProperty("reason");
  });
});

describe("loadPlans — tolerant reads", () => {
  it("returns empty everything for a MISSING file (a plan-less fund is normal)", async () => {
    const path = await tempPath();
    await expect(loadPlans(path)).resolves.toEqual({
      plans: [],
      unknownKind: [],
      invalid: [],
    });
  });

  it("tolerates blank lines, including a trailing newline and interior gaps", async () => {
    const path = await tempPath();
    await writeFile(
      path,
      `\n${JSON.stringify(ladder("2026-06-01"))}\n\n   \n${JSON.stringify(timed("2026-06-05"))}\n\n`,
      "utf8",
    );

    const loaded = await loadPlans(path);
    expect(loaded.plans).toHaveLength(2);
    expect(loaded.invalid).toEqual([]);
    expect(loaded.unknownKind).toEqual([]);
  });

  it("preserves the file's APPEND order, even when it is non-monotonic", async () => {
    const path = await tempPath();
    await appendPlan(path, ladder("2026-07-01"));
    await appendPlan(path, ladder("2026-06-01"));

    // The loader does not sort; the pure engine selector owns as-of ordering.
    const loaded = await loadPlans(path);
    expect(loaded.plans.map((p) => p.effectiveAt)).toEqual(["2026-07-01", "2026-06-01"]);
  });
});

describe("loadPlans — unknown kind is SKIPPED AND REPORTED, never silent, never fatal", () => {
  it("skips a future kind and returns it fully attributed", async () => {
    const path = await tempPath();
    await appendPlan(path, ladder("2026-06-01"));
    await writeFile(
      path,
      `${JSON.stringify({
        kind: "dcaVolatility",
        positionId: "pos-synthetic-2",
        effectiveAt: "2026-06-15",
        somethingNewer: true,
      })}\n`,
      { flag: "a" },
    );

    const loaded = await loadPlans(path);
    // The readable line still loads — one unreadable line is not a global error.
    expect(loaded.plans).toHaveLength(1);
    expect(loaded.invalid).toEqual([]);
    expect(loaded.unknownKind).toHaveLength(1);

    // FULL attribution is what makes S6's per-position "not readable" implementable.
    const skip = loaded.unknownKind[0]!;
    expect(skip.reason).toBe("unknownKind");
    expect(skip.kind).toBe("dcaVolatility");
    expect(skip.positionId).toBe("pos-synthetic-2");
    expect(skip.effectiveAt).toBe("2026-06-15");
    expect(skip.line).toBe(2);
    // The instruction is "pull", not "the file is broken".
    expect(skip.detail).toContain("older than the data");
  });

  it("never throws on an unknown kind — this is NOT events.jsonl's cliff", async () => {
    const path = await tempPath();
    await writeFile(
      path,
      `${JSON.stringify({ kind: "fromTheFuture", positionId: "p", effectiveAt: "2026-06-01" })}\n`,
      "utf8",
    );
    // rejection-check.ts throws on an unreadable events.jsonl line because NAV would
    // be wrong. A plan is descriptive-only: only a VIEW is incomplete.
    await expect(loadPlans(path)).resolves.toBeDefined();
  });
});

describe("loadPlans — invalid lines are quarantined and DISTINGUISHED from unknownKind", () => {
  it("reports a non-JSON line with no attribution it cannot honestly claim", async () => {
    const path = await tempPath();
    await writeFile(path, `{not json at all\n${JSON.stringify(ladder("2026-06-01"))}\n`, "utf8");

    const loaded = await loadPlans(path);
    expect(loaded.plans).toHaveLength(1);
    expect(loaded.unknownKind).toEqual([]);
    expect(loaded.invalid).toHaveLength(1);
    expect(loaded.invalid[0]).toEqual({
      reason: "invalid",
      line: 1,
      detail: "not valid JSON",
    });
  });

  it("scrapes partial attribution from a line whose ENVELOPE is broken", async () => {
    const path = await tempPath();
    // A readable positionId, but an effectiveAt that is not a strict ISO date.
    await writeFile(
      path,
      `${JSON.stringify({
        kind: "dcaLadder",
        positionId: "pos-synthetic-9",
        effectiveAt: "06/01/2026",
        tierOrder: ["c1"],
        rungs: [{ id: "r1", priceUsd: 1, sizeUsd: 1 }],
      })}\n`,
      "utf8",
    );

    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    expect(loaded.invalid).toHaveLength(1);
    // The skip lands on the right ROW even though the line is unusable.
    expect(loaded.invalid[0]!.positionId).toBe("pos-synthetic-9");
    expect(loaded.invalid[0]!.effectiveAt).toBeUndefined();
  });

  it("rejects a date-time stamp, which would sort wrong under string comparison", async () => {
    const path = await tempPath();
    await writeFile(
      path,
      `${JSON.stringify({ ...ladder("2026-06-01"), effectiveAt: "2026-06-01T00:00:00Z" })}\n`,
      "utf8",
    );

    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    expect(loaded.invalid).toHaveLength(1);
  });

  it("classifies a KNOWN kind with a malformed body as invalid, not unknownKind", async () => {
    const path = await tempPath();
    await writeFile(
      path,
      `${JSON.stringify({ ...ladder("2026-06-01"), rungs: [] })}\n` +
        `${JSON.stringify({ ...ladder("2026-06-02"), tierOrder: ["c1", "c1"] })}\n` +
        `${JSON.stringify({ ...timed("2026-06-03"), cadence: "fortnightly" })}\n` +
        `${JSON.stringify({ ...timed("2026-06-04"), amountUsd: 0 })}\n`,
      "utf8",
    );

    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    expect(loaded.unknownKind).toEqual([]);
    // The build HAS a reader for these kinds; the data did not satisfy it.
    expect(loaded.invalid).toHaveLength(4);
    expect(loaded.invalid.every((s) => s.reason === "invalid")).toBe(true);
    expect(loaded.invalid.map((s) => s.line)).toEqual([1, 2, 3, 4]);
    expect(loaded.invalid[0]!.detail).toContain("dcaLadder");
  });

  it("rejects a rung with a non-positive price or a duplicate id", async () => {
    const path = await tempPath();
    await writeFile(
      path,
      `${JSON.stringify({
        ...ladder("2026-06-01"),
        rungs: [{ id: "r1", priceUsd: 0, sizeUsd: 100 }],
      })}\n` +
        `${JSON.stringify({
          ...ladder("2026-06-02"),
          rungs: [
            { id: "dup", priceUsd: 1000, sizeUsd: 100 },
            { id: "dup", priceUsd: 900, sizeUsd: 100 },
          ],
        })}\n`,
      "utf8",
    );

    const loaded = await loadPlans(path);
    expect(loaded.plans).toEqual([]);
    expect(loaded.invalid).toHaveLength(2);
  });

  it("does not echo the offending line into `detail` — bodies carry FIGURES", async () => {
    const path = await tempPath();
    // A distinctive number standing in for a real rung price.
    await writeFile(
      path,
      `${JSON.stringify({
        kind: "dcaLadder",
        positionId: "pos-synthetic-1",
        effectiveAt: "2026-06-01",
        tierOrder: ["c1"],
        rungs: [{ id: "r1", priceUsd: 123_456.78, sizeUsd: 1 }],
        // a stray field is fine; what makes it invalid is the empty tierOrder below
        tierOrderBroken: true,
      })}\n`.replace('"tierOrder":["c1"]', '"tierOrder":[]'),
      "utf8",
    );

    const loaded = await loadPlans(path);
    expect(loaded.invalid).toHaveLength(1);
    // A diagnostic that quoted the line would launder rung prices into logs.
    expect(loaded.invalid[0]!.detail).not.toContain("123456.78");
    expect(loaded.invalid[0]!.detail).not.toContain("123,456.78");
  });
});

describe("resolvePlansPath", () => {
  it("names the file plans.jsonl beside preferences.jsonl", async () => {
    expect(resolvePlansPath("/tmp/whatever")).toBe("/tmp/whatever/plans.jsonl");
  });
});
