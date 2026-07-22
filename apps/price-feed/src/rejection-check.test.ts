// Spine-rejection surfacing suite (slice #108). The claim under test: a fetched
// mark that would trip the spine's ±50% magnitude guard is REPORTED, attributably
// and distinctly from a provider failure — never swallowed into a silent gap. The
// pre-check reuses the engine's real `crossReferenceEvent` guard (no re-implemented
// rule), so these tests exercise the exact gate `pnpm spine` enforces. No live
// network and no live data files: an in-memory engine genesis fixture and a fresh
// temp data dir.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildEventReference,
  deriveMxnMark,
  markFromQuote,
  PRICE_MARK_MAGNITUDE_THRESHOLD,
  type FundReviewData,
  type Quote,
} from "@numisma/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findMarkRejections,
  loadSpineReference,
  marksFromRun,
  scanFetchedMarks,
} from "./rejection-check.js";
import type { FetchRunResult } from "./fetch-prices.js";
import { resolvePriceFeedPaths } from "./paths.js";

const GENESIS_AS_OF = "2026-06-01";
/** Last known close for `btc` seeded from the held position's markPrice. */
const BTC_LAST_CLOSE = 65_000;

/** A minimal genesis holding a `btc` position, so `btc`'s last close is known. */
function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "btc", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
      {
        id: "cash-core",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 1000,
      },
    ],
    positions: [
      {
        id: "btc-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "btc",
        direction: "long",
        markPrice: BTC_LAST_CLOSE,
        currency: "USD",
        lots: [{ quantity: 1, cost: 40_000, tier: "c1" }],
      },
    ],
  };
}

function quote(instrumentId: string, price: number): Quote {
  return {
    instrumentId,
    symbol: `${instrumentId.toUpperCase()}USDT`,
    asOf: "2026-07-03",
    price,
    source: "binance",
    fetchedAt: "2026-07-03T18:05:00.000Z",
  };
}

describe("findMarkRejections — the ±50% guard is surfaced, not swallowed", () => {
  it("reports a fetched mark that trips the magnitude guard", () => {
    const reference = buildEventReference(genesis());
    // +100% vs the 65k last close — a real doubling or a unit slip; either way the
    // spine would reject it, and today that is a silent missing mark.
    const doomed = markFromQuote(quote("btc", BTC_LAST_CLOSE * 2));

    const rejections = findMarkRejections([doomed], reference);

    expect(rejections).toHaveLength(1);
    const [rejection] = rejections;
    expect(rejection?.instrumentId).toBe("btc");
    expect(rejection?.price).toBe(130_000);
    expect(rejection?.path).toBe("price");
    // The reason is the engine guard's OWN message, verbatim — no drifting copy.
    expect(rejection?.reason).toMatch(/beyond the 50% sanity threshold/);
  });

  it("passes a plausible within-threshold move (no false rejection)", () => {
    const reference = buildEventReference(genesis());
    // +40% — inside the ±50% band, a plausible weekly move.
    const fine = markFromQuote(quote("btc", BTC_LAST_CLOSE * 1.4));

    expect(findMarkRejections([fine], reference)).toEqual([]);
  });

  it("distinguishes a guard rejection from an unknown-instrument rejection by path", () => {
    const reference = buildEventReference(genesis());
    // `doge` has no genesis instrument row → rejected on instrumentId, not price.
    const unknown = markFromQuote(quote("doge", 0.2));

    const [rejection] = findMarkRejections([unknown], reference);
    expect(rejection?.path).toBe("instrumentId");
    expect(rejection?.reason).toMatch(/does not contain/);
  });

  it("tracks the live threshold dial through the passthrough option", () => {
    const reference = buildEventReference(genesis());
    const move = markFromQuote(quote("btc", BTC_LAST_CLOSE * 1.4)); // +40%

    // Tighten the dial below the move → the same mark now trips it.
    expect(findMarkRejections([move], reference, { magnitudeThreshold: 0.3 })).toHaveLength(1);
    expect(PRICE_MARK_MAGNITUDE_THRESHOLD).toBe(0.5);
  });
});

describe("derived MXN marks are pre-checked at USD×FIX, not the raw USD quote (regression)", () => {
  // Guards against the #107↔#108 integration bug: the pre-check must read the run's
  // OWN constructed marks. A `*-mxn` mark is `USD × FIX`; re-deriving markFromQuote
  // off the raw USD quote pre-checks a value ~1/FIX of the real mark and falsely
  // trips the guard against an MXN last-close.
  function genesisWithMxn(): FundReviewData {
    const base = genesis();
    return {
      ...base,
      instruments: [
        ...base.instruments,
        { id: "nu-mxn", name: "Nu MXN-listed", symbol: "NU", currency: "MXN" },
      ],
      positions: [
        ...base.positions,
        {
          id: "nu-core",
          portfolioId: "core",
          tempo: "Capital",
          executionMode: "live",
          accountId: "xtb-usd",
          instrumentId: "nu-mxn",
          direction: "long",
          markPrice: 200, // last MXN close
          currency: "MXN",
          lots: [{ quantity: 10, cost: 1500, tier: "c1" }],
        },
      ],
    };
  }

  it("passes the derived MXN value and would have rejected the raw USD re-derivation", () => {
    const reference = buildEventReference(genesisWithMxn());
    const usdLeg = quote("nu-mxn", 11); // 11 USD leg
    const derived = deriveMxnMark(usdLeg, { rate: 20, date: "2026-07-03" });
    expect(derived.price).toBe(220); // 11 × 20, not 11
    expect(derived.usdMxn).toBe(20);

    // Correct: the derived 220 is +10% vs the 200 MXN last close — within ±50%, no reject.
    expect(findMarkRejections([derived], reference)).toEqual([]);
    // The old bug re-derived markFromQuote(usdLeg) = 11 — a ~95% drop vs 200 → falsely rejected.
    expect(findMarkRejections([markFromQuote(usdLeg)], reference)).toHaveLength(1);
  });

  it("marksFromRun returns the run's constructed marks verbatim (no re-derivation)", () => {
    const derived = deriveMxnMark(quote("nu-mxn", 11), { rate: 20, date: "2026-07-03" });
    const result: FetchRunResult = {
      quotes: [quote("nu-mxn", 11)],
      totalCount: 1,
      storedCount: 1,
      emittedCount: 1,
      skippedCount: 0,
      markEmitted: true,
      marks: [derived],
      failures: [],
      staleMarkSkips: [],
    };
    expect(marksFromRun(result)).toEqual([derived]);
    // Before the mark time, nothing is pre-checked even if marks are present.
    expect(marksFromRun({ ...result, markEmitted: false, marks: [] })).toEqual([]);
  });
});

describe("loadSpineReference + scanFetchedMarks — reads the real genesis/log off disk", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "rejection-check-test-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function writeGenesis(): Promise<void> {
    const { genesis: genesisPath } = resolvePriceFeedPaths(dataDir);
    await mkdir(dirname(genesisPath), { recursive: true });
    await writeFile(genesisPath, JSON.stringify(genesis()), "utf8");
  }

  /** A run result as if `btc` was fetched at `price` and its mark emitted. */
  function runResult(price: number): FetchRunResult {
    return {
      quotes: [quote("btc", price)],
      totalCount: 1,
      storedCount: 1,
      emittedCount: 1,
      skippedCount: 0,
      markEmitted: true,
      // `btc` is a direct instrument, so its emitted mark is `markFromQuote`; the
      // pre-check reads these constructed marks, not a re-derivation from quotes.
      marks: [markFromQuote(quote("btc", price))],
      failures: [],
      staleMarkSkips: [],
    };
  }

  it("builds the reference from a real genesis and reports the guard rejection", async () => {
    await writeGenesis();
    const paths = resolvePriceFeedPaths(dataDir);

    const world = await loadSpineReference(paths);
    expect(world?.reference).toBeDefined();

    const scan = await scanFetchedMarks(runResult(BTC_LAST_CLOSE * 3), paths);
    expect(scan.skipped).toBe(false);
    expect(scan.rejections).toHaveLength(1);
    expect(scan.rejections[0]?.instrumentId).toBe("btc");
  });

  it("passes a plausible mark cleanly against the real genesis", async () => {
    await writeGenesis();
    const scan = await scanFetchedMarks(runResult(BTC_LAST_CLOSE * 1.1), resolvePriceFeedPaths(dataDir));
    expect(scan.rejections).toEqual([]);
    expect(scan.skipped).toBe(false);
  });

  it("degrades safely when there is no genesis to check against (skipped, not thrown)", async () => {
    // No genesis written → the pre-check cannot run, but the fetch is not crashed.
    const scan = await scanFetchedMarks(runResult(BTC_LAST_CLOSE * 3), resolvePriceFeedPaths(dataDir));
    expect(scan.skipped).toBe(true);
    expect(scan.rejections).toEqual([]);
  });

  it("does not pre-check before the mark time (no marks emitted this run)", async () => {
    await writeGenesis();
    const preMarkResult: FetchRunResult = {
      ...runResult(BTC_LAST_CLOSE * 3),
      emittedCount: 0,
      markEmitted: false,
    };
    const scan = await scanFetchedMarks(preMarkResult, resolvePriceFeedPaths(dataDir));
    expect(scan.rejections).toEqual([]);
    expect(scan.skipped).toBe(false);
  });

  it("reports a pre-check as unavailable (non-fatal) when the log is corrupt", async () => {
    await writeGenesis();
    const paths = resolvePriceFeedPaths(dataDir);
    await writeFile(paths.log, "{ not json\n", "utf8");

    const scan = await scanFetchedMarks(runResult(BTC_LAST_CLOSE * 3), paths);
    expect(scan.skipped).toBe(true);
    expect(scan.rejections).toEqual([]);
    expect(scan.unavailableReason).toMatch(/not valid JSON/);
  });
});

describe("scanFetchedMarks folds the pending inbox exactly as ingestInbox does", () => {
  // The pre-check must build the SAME reference the spine builds (genesis + log,
  // then advanced by the pending inbox events in order) and judge the SAME set the
  // spine guards (only marks NEW to the batch, after id dedup). These tests pin the
  // two-way fidelity Findings 4 and 5 restore.
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "rejection-check-fidelity-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  /** A `btc` quote pinned to an explicit trading day, so its mark id varies by asOf. */
  function btcQuote(price: number, asOf: string): Quote {
    return { ...quote("btc", price), asOf };
  }

  /** The engine's real mark for a `btc` close on `asOf` (deterministic `pm-btc-<asOf>` id). */
  function btcMark(price: number, asOf: string) {
    return markFromQuote(btcQuote(price, asOf));
  }

  async function writeGenesisAt(paths: ReturnType<typeof resolvePriceFeedPaths>): Promise<void> {
    await mkdir(dirname(paths.genesis), { recursive: true });
    await writeFile(paths.genesis, JSON.stringify(genesis()), "utf8");
  }

  /** Seed the durable log with already-appended events (JSONL, one event per line). */
  async function writeLog(
    paths: ReturnType<typeof resolvePriceFeedPaths>,
    events: readonly object[],
  ): Promise<void> {
    await mkdir(dirname(paths.log), { recursive: true });
    await writeFile(paths.log, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  }

  /** Seed the shared inbox with pending records (the JSON array spine consumes). */
  async function writeInbox(
    paths: ReturnType<typeof resolvePriceFeedPaths>,
    records: readonly object[],
  ): Promise<void> {
    await mkdir(dirname(paths.inbox), { recursive: true });
    await writeFile(paths.inbox, JSON.stringify(records, null, 2) + "\n", "utf8");
  }

  /** A run result carrying exactly `marks` as its constructed marks. */
  function resultWith(marks: object[], emittedCount: number): FetchRunResult {
    return {
      quotes: [],
      totalCount: marks.length,
      storedCount: marks.length,
      emittedCount,
      skippedCount: marks.length - emittedCount,
      markEmitted: true,
      marks: marks as FetchRunResult["marks"],
      failures: [],
      staleMarkSkips: [],
    };
  }

  it("4a: a pending hand-authored corrective mark advances the reference so a fresh mark PASSES", async () => {
    const paths = resolvePriceFeedPaths(dataDir);
    await writeGenesisAt(paths);
    // Genesis last close is 65k. A corrective mark hand-authored into the inbox lifts
    // btc to 95k (+46%, within ±50% → accepted). The fresh 140k mark this run queued
    // is +47% vs 95k (accepted) but +115% vs the STALE 65k (rejected). Spine folds the
    // corrective first, so it accepts the fresh mark — and so must the pre-check.
    const corrective = btcMark(95_000, "2026-07-02");
    const fresh = btcMark(140_000, "2026-07-03");
    // Inbox as spine sees it AFTER this run merged its fresh mark at the tail.
    await writeInbox(paths, [corrective, fresh]);

    const scan = await scanFetchedMarks(resultWith([fresh], 1), paths);
    expect(scan.skipped).toBe(false);
    expect(scan.rejections).toEqual([]);

    // Contrast: without the corrective folded in, the very same fresh mark trips the
    // guard against the stale 65k close — proving the fold is what saves it.
    await writeInbox(paths, [fresh]);
    const stale = await scanFetchedMarks(resultWith([fresh], 1), paths);
    expect(stale.rejections).toHaveLength(1);
    expect(stale.rejections[0]?.price).toBe(140_000);
  });

  it("4b: a doomed mark left queued by a PRIOR run is still surfaced by a later run", async () => {
    const paths = resolvePriceFeedPaths(dataDir);
    await writeGenesisAt(paths);
    // A prior run queued a +200% mark (195k vs 65k) that spine will reject; nobody has
    // fixed it. This later run re-derives the same (dedup-skipped) mark and adds nothing
    // new — yet the doomed pending mark must NOT let the run exit 0.
    const doomed = btcMark(195_000, "2026-07-03");
    await writeInbox(paths, [doomed]);

    const scan = await scanFetchedMarks(resultWith([doomed], 0), paths);
    expect(scan.skipped).toBe(false);
    expect(scan.rejections).toHaveLength(1);
    expect(scan.rejections[0]?.instrumentId).toBe("btc");
    expect(scan.rejections[0]?.price).toBe(195_000);
    expect(scan.rejections[0]?.reason).toMatch(/beyond the 50% sanity threshold/);
  });

  it("5: a mark whose id is already in the durable LOG is NOT guarded (spine dedup-skips it)", async () => {
    const paths = resolvePriceFeedPaths(dataDir);
    await writeGenesisAt(paths);
    // Today's mark was already ingested (66k, in the log). A same-day re-run reconstructs
    // the same id with a wild price; spine dedup-skips it at event-store.ts:259 BEFORE the
    // guard, so the pre-check must not flag it — even though 999k would trip the guard.
    await writeLog(paths, [btcMark(66_000, "2026-07-03")]);
    const reRun = btcMark(999_000, "2026-07-03"); // same id pm-btc-2026-07-03

    const scan = await scanFetchedMarks(resultWith([reRun], 1), paths);
    expect(scan.skipped).toBe(false);
    expect(scan.rejections).toEqual([]);
  });

  it("5: a mark whose id is already PENDING in the inbox is NOT guarded again", async () => {
    const paths = resolvePriceFeedPaths(dataDir);
    await writeGenesisAt(paths);
    // The mark is already pending (66k, accepted); a re-run's same-id mark with a wild
    // price is dedup-skipped by mergeInbox, so spine only ever guards the pending copy.
    await writeInbox(paths, [btcMark(66_000, "2026-07-03")]);
    const reRun = btcMark(999_000, "2026-07-03"); // same id, dedup-skipped → emittedCount 0

    const scan = await scanFetchedMarks(resultWith([reRun], 0), paths);
    expect(scan.skipped).toBe(false);
    expect(scan.rejections).toEqual([]);
  });

  it("still flags a genuinely NEW >50% mark even with benign pending context folded in", async () => {
    const paths = resolvePriceFeedPaths(dataDir);
    await writeGenesisAt(paths);
    // A benign corrective (70k, +8%) advances the close; the fresh 200k mark is +186%
    // vs that advanced close — genuinely new to the batch and genuinely doomed.
    const benign = btcMark(70_000, "2026-07-02");
    const doomedFresh = btcMark(200_000, "2026-07-03");
    await writeInbox(paths, [benign, doomedFresh]);

    const scan = await scanFetchedMarks(resultWith([doomedFresh], 1), paths);
    expect(scan.skipped).toBe(false);
    expect(scan.rejections).toHaveLength(1);
    expect(scan.rejections[0]?.price).toBe(200_000);
    expect(scan.rejections[0]?.path).toBe("price");
  });
});
