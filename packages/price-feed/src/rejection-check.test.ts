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
    };
  }

  it("builds the reference from a real genesis and reports the guard rejection", async () => {
    await writeGenesis();
    const paths = resolvePriceFeedPaths(dataDir);

    const reference = await loadSpineReference(paths);
    expect(reference).toBeDefined();

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
