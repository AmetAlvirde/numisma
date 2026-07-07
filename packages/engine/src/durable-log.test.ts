// PROTOTYPE (mvi portable-durable-log). Behavior locks for the two pure durable-log
// derivations: `deriveCheckpoint` (its fields, and that `fundValueUsd` matches the
// canonical `buildCompositionReport`) and `formatIngestCommitMessage` (its shape and
// deterministic, sorted verb ordering).
import { describe, expect, it } from "vitest";
import {
  buildCompositionReport,
  deriveCheckpoint,
  foldEvents,
  formatIngestCommitMessage,
  type PortfolioEvent,
} from "./index.js";
import { genesis } from "./cash-settlement.fixtures.js";

describe("deriveCheckpoint", () => {
  it("summarizes a folded read model, sourcing fundValueUsd from the canonical fold", () => {
    const folded = foldEvents(genesis(), []);
    const report = buildCompositionReport(folded);

    const checkpoint = deriveCheckpoint(folded, "evt-42", "0.7.2");

    expect(checkpoint).toEqual({
      schemaVersion: 1,
      asOf: folded.review.asOf,
      fundValueUsd: report.totals.fundValueUsd,
      openPositionCount: folded.positions.length,
      closedPositionCount: (folded.closedPositions ?? []).length,
      headEventId: "evt-42",
      appVersion: "0.7.2",
    });
    // fundValueUsd is the canonical fund value, not a hand re-sum.
    expect(checkpoint.fundValueUsd).toBe(report.totals.fundValueUsd);
    expect(checkpoint.fundValueUsd).toBeGreaterThan(0);
  });

  it("reflects the open/closed counts after a close folds through", () => {
    const close: PortfolioEvent = {
      id: "close-alt",
      asOf: "2026-06-03",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "tiered", proceeds: 800 },
    };
    const folded = foldEvents(genesis(), [close]);

    const checkpoint = deriveCheckpoint(folded, "close-alt", "0.7.2");

    expect(checkpoint.openPositionCount).toBe(0);
    expect(checkpoint.closedPositionCount).toBe(1);
    expect(checkpoint.fundValueUsd).toBe(
      buildCompositionReport(folded).totals.fundValueUsd,
    );
  });

  it("carries a null headEventId for the genesis-only state", () => {
    const folded = foldEvents(genesis(), []);
    const checkpoint = deriveCheckpoint(folded, null, "0.7.2");
    expect(checkpoint.headEventId).toBeNull();
    expect(checkpoint.schemaVersion).toBe(1);
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
});
