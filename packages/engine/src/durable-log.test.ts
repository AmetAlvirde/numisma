// Behavior locks for the two pure durable-log derivations: `deriveHeadDigest` (its
// fields, and that `fundValueUsd` matches the canonical `buildCompositionReport` —
// byte-for-byte, the named ADR-003 anti-drift invariant) and
// `formatIngestCommitMessage` (its shape and deterministic, sorted verb ordering).
import { describe, expect, it } from "vitest";
import {
  buildCompositionReport,
  deriveHeadDigest,
  foldEvents,
  formatIngestCommitMessage,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { genesis } from "./cash-settlement.fixtures.js";

/** A genesis with no reserves and no positions — the empty/zero fold. */
function emptyGenesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: "2026-06-01", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "venue", name: "Venue", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "aapl-usd", name: "Apple", symbol: "AAPL", currency: "USD" }],
    reserves: [],
    positions: [],
  };
}

/**
 * A genesis whose single live position values to a non-round float
 * (`3 × 0.1 === 0.30000000000000004`), so a `toFixed`/round anywhere in the value
 * path would visibly change the byte pattern.
 */
function nonRoundFloatGenesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: "2026-06-01", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "venue", name: "Venue", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "aapl-usd", name: "Apple", symbol: "AAPL", currency: "USD" }],
    reserves: [],
    positions: [
      {
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "venue",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: 0.1,
        currency: "USD",
        lots: [{ quantity: 3, cost: 0.1, tier: "c1" }],
      },
    ],
  };
}

/**
 * A genesis with one LIVE and one PAPER (non-live) position. `fundValueUsd` values
 * only the live one; `openPositionCount` counts BOTH — the D1 divergence.
 */
function excludedPopulationGenesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: "2026-06-01", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "venue", name: "Venue", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "aapl-usd", name: "Apple", symbol: "AAPL", currency: "USD" }],
    reserves: [],
    positions: [
      {
        id: "live-pos",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "venue",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: 150,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
      {
        id: "paper-pos",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "paper",
        accountId: "venue",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: 150,
        currency: "USD",
        lots: [{ quantity: 5, cost: 100, tier: "c1" }],
      },
    ],
  };
}

describe("deriveHeadDigest", () => {
  it("summarizes a folded read model, sourcing fundValueUsd from the canonical fold", () => {
    const folded = foldEvents(genesis(), []).data;
    const report = buildCompositionReport(folded);

    const headDigest = deriveHeadDigest(folded, "evt-42", "0.7.2");

    expect(headDigest).toEqual({
      schemaVersion: 1,
      asOf: folded.review.asOf,
      fundValueUsd: report.totals.fundValueUsd,
      openPositionCount: folded.positions.length,
      closedPositionCount: (folded.closedPositions ?? []).length,
      headEventId: "evt-42",
      appVersion: "0.7.2",
    });
    // fundValueUsd is the canonical fund value, not a hand re-sum.
    expect(headDigest.fundValueUsd).toBe(report.totals.fundValueUsd);
    expect(headDigest.fundValueUsd).toBeGreaterThan(0);
  });

  it("reflects the open/closed counts after a close folds through", () => {
    const close: PortfolioEvent = {
      id: "close-alt",
      asOf: "2026-06-03",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "tiered", proceeds: 800 },
    };
    const folded = foldEvents(genesis(), [close]).data;

    const headDigest = deriveHeadDigest(folded, "close-alt", "0.7.2");

    expect(headDigest.openPositionCount).toBe(0);
    expect(headDigest.closedPositionCount).toBe(1);
    expect(headDigest.fundValueUsd).toBe(
      buildCompositionReport(folded).totals.fundValueUsd,
    );
  });

  it("carries a null headEventId for the genesis-only state", () => {
    const folded = foldEvents(genesis(), []).data;
    const headDigest = deriveHeadDigest(folded, null, "0.7.2");
    expect(headDigest.headEventId).toBeNull();
    expect(headDigest.schemaVersion).toBe(1);
  });

  // --- Engine edge locks (ADR-003 anti-drift amendment) ---------------------

  it("keeps a non-round-float value byte-identical to the report total (the anti-drift guard)", () => {
    // 3 × 0.1 === 0.30000000000000004 — a value a stray toFixed/round would mangle.
    const folded = foldEvents(nonRoundFloatGenesis(), []).data;
    const report = buildCompositionReport(folded);
    const headDigest = deriveHeadDigest(folded, "h", "v");

    // Byte-for-byte equal to the canonical total — never rounded, never reformatted.
    expect(headDigest.fundValueUsd).toBe(report.totals.fundValueUsd);
    // The value is genuinely non-round, so a toFixed/round WOULD change it: this is
    // what makes the equality above a real anti-drift lock rather than a tautology.
    expect(Number.isInteger(headDigest.fundValueUsd)).toBe(false);
    expect(headDigest.fundValueUsd).not.toBe(Number(headDigest.fundValueUsd.toFixed(2)));
  });

  it("reports a zero fund value and zero counts for the empty/zero fold, still equal to the report total", () => {
    const folded = foldEvents(emptyGenesis(), []).data;
    const report = buildCompositionReport(folded);
    const headDigest = deriveHeadDigest(folded, null, "v");

    expect(headDigest.fundValueUsd).toBe(0);
    expect(headDigest.fundValueUsd).toBe(report.totals.fundValueUsd);
    expect(headDigest.openPositionCount).toBe(0);
    expect(headDigest.closedPositionCount).toBe(0);
  });

  it("treats an absent closedPositions field as a closed count of 0 (the `?? []` guard)", () => {
    // A raw read model with NO `closedPositions` key at all (foldEvents would normalize
    // it to `[]`; here we prove the derivation itself tolerates `undefined`).
    const raw = emptyGenesis();
    expect(raw.closedPositions).toBeUndefined();

    const headDigest = deriveHeadDigest(raw, null, "v");
    expect(headDigest.closedPositionCount).toBe(0);
  });

  it("counts ALL open positions incl. non-live while fundValueUsd stays the report total (D1 divergence)", () => {
    // Two positions on the book: one live, one paper. fundValueUsd values only the
    // live one; openPositionCount counts both. The two intentionally diverge.
    const folded = foldEvents(excludedPopulationGenesis(), []).data;
    const report = buildCompositionReport(folded);
    const headDigest = deriveHeadDigest(folded, "h", "v");

    // openPositionCount = all logged open positions, INCLUDING the excluded non-live one.
    expect(headDigest.openPositionCount).toBe(2);
    expect(headDigest.openPositionCount).toBe(folded.positions.length);
    // The composition report excluded the paper position from the value.
    expect(report.dashboard.summary.dataSafety.nonLiveExcluded).toBe(1);
    // fundValueUsd remains byte-identical to the canonical (live-only) total — so the
    // divergence is documented, not a drift: only ONE position (the live one) is valued.
    expect(headDigest.fundValueUsd).toBe(report.totals.fundValueUsd);
    expect(headDigest.fundValueUsd).toBe(2 * 150);
  });
});

describe("formatIngestCommitMessage", () => {
  it("produces the documented shape for a single verb", () => {
    const message = formatIngestCommitMessage({
      verbs: { PriceMarked: 7 },
      totalCount: 7,
      asOf: "2026-07-07",
      appVersion: "0.7.2",
      timestamp: "2026-07-07T18:00:00Z",
    });

    expect(message).toBe(
      [
        "data: ingest 7 event(s) — PriceMarked×7",
        "",
        "PriceMarked×7",
        "asOf: 2026-07-07",
        "numisma-version: 0.7.2",
      ].join("\n"),
    );
  });

  it("sorts verbs deterministically regardless of input key order", () => {
    const message = formatIngestCommitMessage({
      verbs: { PriceMarked: 7, Deposit: 1, PositionOpened: 2 },
      totalCount: 10,
      asOf: "2026-07-07",
      appVersion: "1.0.0",
      timestamp: "2026-07-07T18:00:00Z",
    });

    expect(message).toBe(
      [
        "data: ingest 10 event(s) — Deposit×1, PositionOpened×2, PriceMarked×7",
        "",
        "Deposit×1",
        "PositionOpened×2",
        "PriceMarked×7",
        "asOf: 2026-07-07",
        "numisma-version: 1.0.0",
      ].join("\n"),
    );
  });

  it("is a pure function of its input (same input → identical output)", () => {
    const input = {
      verbs: { Withdraw: 3, Deposit: 3 },
      totalCount: 6,
      asOf: "2026-07-07",
      appVersion: "1.0.0",
      timestamp: "2026-07-07T18:00:00Z",
    };
    expect(formatIngestCommitMessage(input)).toBe(formatIngestCommitMessage(input));
  });

  it("renders an empty summary and body for a zero-verb, zero-count batch", () => {
    const message = formatIngestCommitMessage({
      verbs: {},
      totalCount: 0,
      asOf: "2026-07-07",
      appVersion: "1.0.0",
      timestamp: "2026-07-07T18:00:00Z",
    });

    // No verbs → empty summary after the em dash, empty body line before the trailers.
    expect(message).toBe(
      [
        "data: ingest 0 event(s) — ",
        "",
        "",
        "asOf: 2026-07-07",
        "numisma-version: 1.0.0",
      ].join("\n"),
    );
  });

  it("sorts verb keys by UTF-16 code unit, documenting non-ASCII ordering", () => {
    // `Ábano` (U+00C1) sorts AFTER ASCII `Zebra` (U+005A) under code-unit ordering —
    // the behavior of a bare String comparison. This locks that ordering, not a locale.
    const message = formatIngestCommitMessage({
      verbs: { Zebra: 1, "Ábano": 2 },
      totalCount: 3,
      asOf: "2026-07-07",
      appVersion: "1.0.0",
      timestamp: "2026-07-07T18:00:00Z",
    });

    expect(message).toBe(
      [
        "data: ingest 3 event(s) — Zebra×1, Ábano×2",
        "",
        "Zebra×1",
        "Ábano×2",
        "asOf: 2026-07-07",
        "numisma-version: 1.0.0",
      ].join("\n"),
    );
  });
});
