/**
 * THE FAILING TRAIL APPEND — the two failures no arrangement of real files can open,
 * and the reason they need a file of their own.
 *
 * `appendReconciliation` must never throw, whatever fails underneath it: the fill is
 * already durable when it runs and nothing on that path may refuse a fill, roll one
 * back, or block a return. A rejected echo and an unmakeable directory are reachable
 * with the real filesystem and are covered in the reliable suite. These two are not:
 *
 *   - **The LOCK cannot be taken.** A held lock is a ten-second wait by design, and a
 *     lock that fails for any other reason (a permission error on the lock sibling)
 *     needs the filesystem to refuse one specific `open`.
 *   - **The RENAME fails.** The window is between `writeFile` and `rename`, and every
 *     real candidate fails the read or the lock first, so the test would pass
 *     vacuously.
 *
 * So `open` and `rename` are mocked, and only those: everything else is the real
 * filesystem in a real temp directory. This file exists separately because that mock
 * is module-wide and has no business near the format tests.
 *
 * What it locks, in both cases: the append WARNS, writes nothing, leaves the prior
 * image byte-identical, and RETURNS NORMALLY rather than throwing.
 *
 * Every record here is synthetic and carries no figure.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReconciliationRecord } from "@numisma/engine";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Flipped by a test to make the next `rename` fail the way a full volume would. */
let renameFails = false;
/** Flipped by a test to make the lock sibling impossible to create. */
let lockFails = false;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (path: string, flags: string) => {
      if (lockFails && String(path).endsWith(".lock")) {
        throw Object.assign(new Error("EACCES: permission denied, open"), { code: "EACCES" });
      }
      return actual.open(path, flags);
    },
    rename: async (from: string, to: string) => {
      if (renameFails) {
        throw Object.assign(new Error("ENOSPC: no space left on device, rename"), {
          code: "ENOSPC",
        });
      }
      return actual.rename(from, to);
    },
  };
});

const { appendReconciliation, loadReconciliations } = await import("./reconciliations.js");

const createdDirs: string[] = [];

afterEach(async () => {
  renameFails = false;
  lockFails = false;
  vi.restoreAllMocks();
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-trail-append-"));
  createdDirs.push(dir);
  return dir;
}

const RECORD: ReconciliationRecord = {
  positionId: "ladder-demo-01",
  eventId: "evt-demo-0008",
  fillKind: "PositionAddedTo",
  asOf: "2026-09-11",
  toldAt: "2026-09-11T18:03:44-06:00",
  lotTier: "c2",
  declared: {
    status: "active",
    kind: "dcaLadder",
    planId: "9f1c2b64-0000-4000-8000-de5060000001",
    effectiveAt: "2026-08-15",
    tierOrder: ["c1", "c2"],
  },
  mismatches: [],
};

const LATER: ReconciliationRecord = {
  ...RECORD,
  eventId: "evt-demo-0009",
  asOf: "2026-09-18",
  toldAt: "2026-09-18T18:00:04-06:00",
};

/** Capture every stderr warn emitted during `run`. */
async function warnsDuring(run: () => Promise<void>): Promise<string[]> {
  const warns: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warns.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return warns;
}

describe("appendReconciliation degrades instead of throwing", () => {
  it("warns and writes nothing when the lock cannot be taken", async () => {
    const dir = await tempDir();
    const path = join(dir, "reconciliations.jsonl");
    await appendReconciliation(path, RECORD);
    const before = await readFile(path, "utf8");

    lockFails = true;
    const warns = await warnsDuring(async () => {
      // No `rejects` matcher: the whole point is that this resolves.
      await appendReconciliation(path, LATER);
    });

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("append failed");
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("warns and leaves the PRIOR image untouched when the rename fails", async () => {
    const dir = await tempDir();
    const path = join(dir, "reconciliations.jsonl");
    await appendReconciliation(path, RECORD);
    const before = await readFile(path, "utf8");

    renameFails = true;
    const warns = await warnsDuring(async () => {
      await appendReconciliation(path, LATER);
    });

    expect(warns).toHaveLength(1);
    // Crash-atomicity: a failed append loses no committed line and leaves no litter.
    expect(await readFile(path, "utf8")).toBe(before);
    expect(await readdir(dir)).toEqual(["reconciliations.jsonl"]);
  });

  it("leaves the trail readable after a failed append — the loss is one line, not the file", async () => {
    const dir = await tempDir();
    const path = join(dir, "reconciliations.jsonl");
    await appendReconciliation(path, RECORD);

    renameFails = true;
    await warnsDuring(async () => {
      await appendReconciliation(path, LATER);
    });
    renameFails = false;

    const loaded = await loadReconciliations(path);
    expect(loaded.load.status).toBe("loaded");
    expect(loaded.skipped).toEqual([]);
    expect(loaded.reconciliations.map((record) => record.eventId)).toEqual(["evt-demo-0008"]);
  });

  it("never warns and never loses a line when nothing fails", async () => {
    const dir = await tempDir();
    const path = join(dir, "reconciliations.jsonl");

    const warns = await warnsDuring(async () => {
      await appendReconciliation(path, RECORD);
      await appendReconciliation(path, LATER);
    });

    expect(warns).toEqual([]);
    const loaded = await loadReconciliations(path);
    expect(loaded.reconciliations.map((record) => record.line)).toEqual([1, 2]);
  });
});
