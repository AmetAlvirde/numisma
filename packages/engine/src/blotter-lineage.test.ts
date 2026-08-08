// T5 — blotter lineage across many partial trims plus a final full close. A sequence
// of `PositionTrimmed` events on one position, followed by a final `PositionClosed`,
// must produce closed-book rows that ALL share the surviving position's `positionId`:
// every partial trim row carries `partial: true`, and the final full close omits it
// (partial absent/false). Locks the shared-id grouping so a position's realized
// history threads a single lineage id no matter how many times it is trimmed.
import {
  buildEventReference,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";
const POSITION_ID = "btc-pos";

function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "binance-usd", name: "Desk", platform: "BINANCE", currency: "USD" }],
    instruments: [{ id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
      {
        id: "sink-usdt",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "binance-usd",
        currency: "USD",
        amount: 100,
      },
    ],
    positions: [
      {
        id: POSITION_ID,
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        markPrice: 100,
        currency: "USD",
        lots: [
          { quantity: 10, cost: 50, tier: "c1" },
          { quantity: 10, cost: 60, tier: "c2" },
        ],
      },
    ],
  };
}

// Accept an event through the real parse + batch-aware cross-ref gate, judged against
// the ACCEPTED PREFIX so a later trim sees the shrunk per-tier balances. The gate's
// world is re-derived from `genesis + accepted` (ADR-015) rather than a shared
// reference being advanced in place — which is what "batch-aware" now means. The
// caller appends the returned event to `accepted`.
function accept(
  seed: FundReviewData,
  accepted: readonly PortfolioEvent[],
  raw: unknown,
): PortfolioEvent {
  const parsed = parseEvent(raw);
  if (parsed.kind !== "ok") throw new Error(`parse: ${parsed.path} ${parsed.message}`);
  const crossRef = crossReferenceEvent(parsed.value, buildEventReference(seed, accepted));
  if (crossRef.kind !== "ok") throw new Error(`crossref: ${crossRef.path} ${crossRef.message}`);
  return parsed.value;
}

describe("blotter lineage — many partial trims + a final full close thread one id", () => {
  it("shares one positionId across all rows; partials carry partial:true, the close omits it", () => {
    const seed = genesis();
    const events: PortfolioEvent[] = [];

    // Four partial trims, settling each removed portion at the mark (proceeds = qty*100).
    const trims = [
      { tier: "c1", quantity: 2 },
      { tier: "c1", quantity: 2 },
      { tier: "c2", quantity: 3 },
      { tier: "c2", quantity: 3 },
    ] as const;
    trims.forEach((removal, i) => {
      events.push(
        accept(seed, events, {
          id: `trim-${i}`,
          asOf: "2026-06-02",
          type: "PositionTrimmed",
          positionId: POSITION_ID,
          removals: [removal],
          settlement: { reserveId: "sink-usdt", proceeds: removal.quantity * 100 },
        }),
      );
    });

    // Final full close of the surviving 6 c1 + 4 c2 = 10 units at the mark.
    events.push(
      accept(seed, events, {
        id: "close",
        asOf: "2026-06-03",
        type: "PositionClosed",
        positionId: POSITION_ID,
        settlement: { reserveId: "sink-usdt", proceeds: 1000 },
      }),
    );

    const data = foldEvents(seed, events);
    const rows = data.closedPositions ?? [];

    // Five rows: four partial trims + one full close.
    expect(rows).toHaveLength(5);
    // All rows thread the SAME lineage id.
    expect(rows.every((row) => row.positionId === POSITION_ID)).toBe(true);
    expect(new Set(rows.map((row) => row.positionId)).size).toBe(1);

    const partials = rows.filter((row) => row.partial === true);
    const fullCloses = rows.filter((row) => !row.partial);
    // Exactly the four trims are partials; the final close is not.
    expect(partials).toHaveLength(4);
    expect(fullCloses).toHaveLength(1);
    // Every partial row explicitly carries partial:true; the full close omits the flag.
    expect(partials.every((row) => row.partial === true)).toBe(true);
    expect(fullCloses[0]?.partial).toBeUndefined();

    // Lineage is fully retired: the position no longer survives after the final close.
    expect(data.positions.find((position) => position.id === POSITION_ID)).toBeUndefined();
  });
});
