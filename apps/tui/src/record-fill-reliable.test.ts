// `O2` — "NEITHER WRITTEN, OR BOTH" — PROVEN AGAINST REAL FILES ON A REAL FILESYSTEM.
//
// `record-fill.test.ts` drives the same flow through an in-memory double. That proves the
// CONTROL FLOW: which write is attempted, in what order, and that the rollback is called.
// It cannot prove the thing the rollback actually rests on, which is rename(2) semantics —
// that a full next image renamed over the log is atomic, and that renaming the PRIOR image
// back leaves the file byte-identical rather than merely equivalent. An in-memory Map
// assigns a string; a filesystem does not. So the rollback is exercised here against real
// files, with real `writeLogImage` / `restoreLogImage` / `appendOrders`.
//
// The failure is injected at the SIDECAR write (rename #2) because that is the only point
// where a rollback is reachable: the log has landed and must be undone.
//
// Every fixture is a SYNTHETIC ladder (`O7`). Invented ids, round decade prices, round
// balances — no real price, quantity, balance or rung enters this repository.
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  foldEvents,
  parseFundReview,
  serializeOrderRecord,
  type FundReviewData,
  type OrderRecord,
  type PortfolioEvent,
} from "@numisma/engine";
import { appendOrders, loadOrders } from "@numisma/preferences";
import { afterEach, describe, expect, it } from "vitest";
import { restoreLogImage, writeLogImage } from "./event-store.js";
import { recordFill, type RecordFillIo } from "./record-fill.js";

const createdDirs: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs) {
    // A case below deliberately makes the data dir unwritable; restore it so the
    // temp-dir cleanup can actually remove it.
    await chmod(resolve(dir, "data"), 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
  createdDirs.length = 0;
});

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-fill-"));
  createdDirs.push(dir);
  const dataDir = resolve(dir, "data");
  await mkdir(dataDir, { recursive: true });
  return dataDir;
}

/** One portfolio, one account, one instrument, one single-tier reserve. All invented. */
function genesisSeed(): FundReviewData {
  const parsed = parseFundReview({
    fund: { id: "fund-synthetic", name: "Synthetic", baseCurrency: "USD" },
    review: { asOf: "2026-01-01", usdMxn: 20 },
    portfolios: [{ id: "portfolio-synthetic", name: "Synthetic" }],
    accounts: [
      { id: "account-synthetic", name: "Synthetic Venue", platform: "SYNTH", currency: "USD" },
    ],
    instruments: [
      { id: "instrument-synthetic", name: "Synthetic Asset", symbol: "TEST", currency: "USD" },
    ],
    reserves: [
      {
        id: "reserve-synthetic",
        portfolioId: "portfolio-synthetic",
        tempo: "Capital",
        executionMode: "live",
        accountId: "account-synthetic",
        currency: "USD",
        amount: 10000,
        lots: [{ quantity: 10000, tier: "c1" }],
      },
    ],
    positions: [],
  });
  if (parsed.kind !== "ok") {
    throw new Error(`synthetic genesis is invalid: ${JSON.stringify(parsed)}`);
  }
  return parsed.value;
}

/** A descending synthetic ladder of three rungs against the one reserve. */
function ladderRecords(): OrderRecord[] {
  return [400, 300, 200].map((price) => ({
    id: `rung-${price}`,
    observedAt: "2026-01-02T09:00:00",
    kind: "orderPlaced" as const,
    currency: "USD" as const,
    symbol: "TEST/USD",
    side: "buy" as const,
    price,
    quantity: 10,
    fundingReserveId: "reserve-synthetic",
  }));
}

/** A real, hand-authored prior log line — a PriceMarked, so it needs no position. */
const PRIOR_LOG_LINE = `${JSON.stringify({
  schemaVersion: 2,
  id: "mark-synthetic",
  asOf: "2026-01-03",
  type: "PriceMarked",
  instrumentId: "instrument-synthetic",
  price: 400,
})}\n`;

/** The prompt answers that open the ladder's Position on the top rung. */
function answers(): string[] {
  return [
    "rung-400",
    "2026-01-05T12:00:00",
    "",
    "r",
    "r",
    "y",
    "position-synthetic",
    "",
    "synthetic entry thesis",
    "synthetic invalidation condition",
    "synthetic risk budget",
    "synthetic horizon",
    "synthetic strategy",
    "",
    "y",
  ];
}

/**
 * Wire the flow to REAL files. Only `appendOrders` is wrapped, and only so a sidecar
 * write failure can be injected — everything that reads or writes the log is the
 * production function operating on a real path.
 */
function realIo(
  dataDir: string,
  options: { onAppend?: () => Promise<void> } = {},
): { io: RecordFillIo; eventsPath: string; ordersPath: string; err: string[] } {
  const eventsPath = resolve(dataDir, "events.jsonl");
  const ordersPath = resolve(dataDir, "orders.jsonl");
  const remaining = answers();
  const err: string[] = [];

  async function readLogImage(): Promise<string | undefined> {
    try {
      return await readFile(eventsPath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async function logEvents(): Promise<PortfolioEvent[]> {
    const image = await readLogImage();
    if (image === undefined) return [];
    return image
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const { schemaVersion: _schemaVersion, ...event } = JSON.parse(line) as Record<
          string,
          unknown
        >;
        return event as unknown as PortfolioEvent;
      });
  }

  return {
    eventsPath,
    ordersPath,
    err,
    io: {
      ordersPath,
      eventsPath,
      loadOrders: (path) => loadOrders(path, { warn: () => undefined }),
      appendOrders: async (path, records) => {
        if (options.onAppend) {
          await options.onAppend();
        }
        await appendOrders(path, records);
      },
      readLogImage,
      writeLogImage: (contents) => writeLogImage(eventsPath, contents),
      restoreLogImage: (prior) => restoreLogImage(eventsPath, prior),
      loadGenesis: async () => genesisSeed(),
      loadLogEvents: logEvents,
      loadFolded: async () => foldEvents(genesisSeed(), await logEvents()),
      ask: async () => remaining.shift() ?? "",
      out: () => undefined,
      err: (message) => err.push(message),
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every `.tmp` entry left in a file's OWN directory — the litter guard for BOTH writers.
 *
 * Over the directory rather than over one guessed name: both `writeLogImage` and
 * `appendOrders` now name their temp uniquely per call (`<path>.<pid>.<n>.tmp`), so
 * asserting the absence of a single `${path}.tmp` passes vacuously — the name it probes
 * is one neither writer can ever produce. The events log and the orders sidecar share
 * one data dir, so a single sweep covers both halves of the fill act.
 */
async function tempLitter(path: string): Promise<string[]> {
  const entries = await readdir(dirname(path));
  return entries.filter((entry) => entry.endsWith(".tmp"));
}

describe("`O2` on a real filesystem — the rollback restores real bytes", () => {
  it("guards against a vacuous pass: a clean act really writes BOTH files", async () => {
    // Without this, every rollback case below could be passing because the flow never
    // reached the write step at all.
    const dataDir = await tempDataDir();
    const { io, eventsPath, ordersPath } = realIo(dataDir);
    await writeFile(ordersPath, ladderRecords().map((r) => `${serializeOrderRecord(r)}\n`).join(""));
    await writeFile(eventsPath, PRIOR_LOG_LINE);

    const outcome = await recordFill(io);

    expect(outcome.status).toBe("recorded");
    const log = await readFile(eventsPath, "utf8");
    expect(log.startsWith(PRIOR_LOG_LINE)).toBe(true);
    expect(log).toContain("fill:rung-400@2026-01-05T12:00:00");
    expect(await readFile(ordersPath, "utf8")).toContain(`"kind":"orderFilled"`);
    // The temp files both writers rename FROM are gone, not left behind — one sweep of
    // the shared data dir catches either writer's litter, whatever it named it.
    expect(await tempLitter(eventsPath)).toEqual([]);
  });

  it("restores a PRE-EXISTING log BYTE-FOR-BYTE when the sidecar write fails", async () => {
    const dataDir = await tempDataDir();
    const { io, eventsPath, ordersPath } = realIo(dataDir, {
      onAppend: async () => {
        throw new Error("synthetic sidecar write failure");
      },
    });
    const ordersImage = ladderRecords().map((r) => `${serializeOrderRecord(r)}\n`).join("");
    await writeFile(ordersPath, ordersImage);
    await writeFile(eventsPath, PRIOR_LOG_LINE);

    const outcome = await recordFill(io);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("write-failed");
    // Pins WHICH branch produced it: the append's, after a successful rollback — not the
    // log write's, which would make the byte-equality below true for the wrong reason.
    expect(outcome.message).toContain("was rolled back to");

    // BYTE-IDENTICAL, read back off disk — not "parses to the same events". A rollback
    // that re-serialized the log would pass an event-equality check while silently
    // rewriting every line of the durable record of fact.
    expect(await readFile(eventsPath, "utf8")).toBe(PRIOR_LOG_LINE);
    expect(await readFile(ordersPath, "utf8")).toBe(ordersImage);
    expect(await tempLitter(eventsPath)).toEqual([]);
  });

  it("restores a log that had a TORN final line byte-for-byte, terminator and all", async () => {
    // The prior image's missing newline is exactly the detail a re-serializing rollback
    // would "helpfully" repair, turning an undo into an edit of the durable log.
    const dataDir = await tempDataDir();
    const torn = PRIOR_LOG_LINE.trimEnd();
    const { io, eventsPath, ordersPath } = realIo(dataDir, {
      onAppend: async () => {
        throw new Error("synthetic sidecar write failure");
      },
    });
    await writeFile(ordersPath, ladderRecords().map((r) => `${serializeOrderRecord(r)}\n`).join(""));
    await writeFile(eventsPath, torn);

    await recordFill(io);

    expect(await readFile(eventsPath, "utf8")).toBe(torn);
  });

  it("REMOVES the log when it did not exist before — absent, not present-and-empty", async () => {
    const dataDir = await tempDataDir();
    const { io, eventsPath, ordersPath } = realIo(dataDir, {
      onAppend: async () => {
        throw new Error("synthetic sidecar write failure");
      },
    });
    const ordersImage = ladderRecords().map((r) => `${serializeOrderRecord(r)}\n`).join("");
    await writeFile(ordersPath, ordersImage);
    // No events.jsonl at all: the act creates it and the honest undo is to remove it.
    expect(await exists(eventsPath)).toBe(false);

    const outcome = await recordFill(io);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.message).toContain("was rolled back to");
    // ABSENT, not zero-length. Slice 3's loader distinguishes "there are no orders" from
    // "I could not read the orders" for exactly this reason, and the log's own read path
    // treats a missing file and an empty one as different facts too.
    expect(await exists(eventsPath)).toBe(false);
    await expect(stat(eventsPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(ordersPath, "utf8")).toBe(ordersImage);
  });

  it("reports `rollback-failed` HONESTLY when the restore itself cannot run", async () => {
    if (process.getuid?.() === 0) {
      // root ignores the mode bits, so the failure cannot be provoked this way.
      return;
    }
    const dataDir = await tempDataDir();
    const { io, eventsPath, ordersPath, err } = realIo(dataDir, {
      // The log's rename has already landed. Make the directory unwritable, so the
      // restore's own temp-write fails with a real EACCES — then fail the append.
      onAppend: async () => {
        await chmod(dataDir, 0o500);
        throw new Error("synthetic sidecar write failure");
      },
    });
    await writeFile(ordersPath, ladderRecords().map((r) => `${serializeOrderRecord(r)}\n`).join(""));
    await writeFile(eventsPath, PRIOR_LOG_LINE);

    const outcome = await recordFill(io);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("rollback-failed");

    // The log really is ahead of the sidecar on disk — this is the crash-window state,
    // reached for real rather than described.
    const log = await readFile(eventsPath, "utf8");
    expect(log).toContain("fill:rung-400@2026-01-05T12:00:00");
    expect(await readFile(ordersPath, "utf8")).not.toContain(`"kind":"orderFilled"`);

    // And the message names that state verbatim rather than reporting a tidy failure:
    // which event landed, which line is missing, and that the operator must author it.
    expect(outcome.message).toContain("fill:rung-400@2026-01-05T12:00:00");
    expect(outcome.message).toContain("rung-400");
    expect(outcome.message).toContain("still resting");
    expect(outcome.message).toContain("by hand");
    expect(err.join("\n")).toContain("REFUSED");
  });
});
