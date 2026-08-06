/**
 * `S7` — committed, available, and the rungs that substantiate them.
 *
 * EVERY FIXTURE HERE IS A SYNTHETIC LADDER (`O7`). No real price, quantity, balance,
 * rung or Tempo percentage appears in this file, and none may ever be added: this
 * repository is public and a ladder's rung prices are exactly the shape ADR-007 bars
 * from leaving the machine. The assertions below are about PROPERTIES — that a delta
 * equals a rung's own value, that a sum equals its parts, that a number did not move —
 * never about a figure.
 */
import { describe, expect, it } from "vitest";
import { buildCompositionReport } from "../index.js";
import { parseFixture } from "../fund-composition.fixtures.js";
import type { FundReviewData } from "../contracts.js";
import { formatAvailableCapital } from "../format.js";
import { composeAvailableCapital } from "./available.js";
import { committedByReserve, committedRungs, SLACK_EPSILON } from "./committed.js";
import { checkFundingCoverage } from "./ingest.js";
import type { OrderRecord } from "./records.js";
import { pickRestingOrdersAsOf } from "./select.js";

/** Obviously-fake round numbers. The ladder is five identical rungs. */
const RUNG_PRICE = 100;
const RUNG_QUANTITY = 2;
const RUNG_VALUE = RUNG_PRICE * RUNG_QUANTITY; // 200
const RUNG_COUNT = 5;
const LADDER_VALUE = RUNG_VALUE * RUNG_COUNT; // 1000
/**
 * A rung price that is NOT exactly representable in binary. Every other figure in this
 * file is chosen to be exact; this one is chosen to be inexact, so the two zero
 * thresholds have something to disagree about.
 */
const RESIDUE_PRICE = 0.1;

const CAPITAL_RESERVE = "reserve-capital";
const WEALTH_RESERVE = "reserve-wealth";

/**
 * A fund with two live reserves in two different Tempos — deliberately, because the
 * funding container in the real ladder is NOT the Tempo the glance's Reserve slot
 * resolves, and a one-reserve fixture could not tell the two apart.
 */
function syntheticFund(capitalAmount = LADDER_VALUE): FundReviewData {
  return parseFixture({
    fund: { id: "synthetic-fund", name: "Synthetic Fund", baseCurrency: "USD" },
    review: { asOf: "2026-01-31", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [
      { id: "venue-usd", name: "Synthetic Venue", platform: "BITGET", currency: "USD" },
      { id: "other-usd", name: "Other Venue", platform: "XTB", currency: "USD" },
    ],
    instruments: [{ id: "test-usd", name: "Test Asset", symbol: "TEST", currency: "USD" }],
    reserves: [
      {
        id: CAPITAL_RESERVE,
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "venue-usd",
        currency: "USD",
        amount: capitalAmount,
      },
      {
        id: WEALTH_RESERVE,
        portfolioId: "core",
        tempo: "Wealth",
        executionMode: "live",
        accountId: "other-usd",
        currency: "USD",
        amount: 500,
      },
    ],
    positions: [
      {
        id: "test-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "venue-usd",
        instrumentId: "test-usd",
        direction: "long",
        currency: "USD",
        status: "open",
        openedAt: "2026-01-01",
        markPrice: 120,
        lots: [{ quantity: 3, cost: 300, tier: "c1" }],
      },
    ],
  });
}

/** `n` synthetic rungs, all resting, all declaring `reserveId`. */
function ladder(reserveId = CAPITAL_RESERVE, count = RUNG_COUNT): OrderRecord[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `rung-${index}`,
    observedAt: `2026-01-0${index + 1}T10:00:00`,
    kind: "orderPlaced" as const,
    currency: "USD" as const,
    symbol: "TEST/USD",
    side: "buy" as const,
    price: RUNG_PRICE,
    quantity: RUNG_QUANTITY,
    fundingReserveId: reserveId,
  }));
}

function capitalOf(records: OrderRecord[], data = syntheticFund()) {
  const report = composeAvailableCapital(data, pickRestingOrdersAsOf(records));
  const capital = report.reserves.find((reserve) => reserve.reserveId === CAPITAL_RESERVE);
  if (!capital) throw new Error("fixture must carry the Capital reserve");
  return { report, capital };
}

describe("available is a THIRD number — it never touches value (`D4`, testing decision 8)", () => {
  it("leaves the ENTIRE composition report byte-identical, not merely fundValueUsd", () => {
    const load = { status: "loaded", sourcePath: "synthetic", loadedAt: "2026-01-31T00:00:00Z" } as const;
    const withoutOrders = buildCompositionReport(syntheticFund(), { load });

    // The ladder is composed against its own copy of the same fund, then the report is
    // built AGAIN from a fresh copy. If anything in the available-capital path mutated
    // the fund, folded an order into a line, or reached a total, these two serializations
    // diverge. Comparing the whole report rather than one field is the point: a widening
    // that added a field anywhere under `dashboard` fails here too.
    const data = syntheticFund();
    composeAvailableCapital(data, pickRestingOrdersAsOf(ladder()));
    const withOrders = buildCompositionReport(data, { load });

    expect(JSON.stringify(withOrders)).toBe(JSON.stringify(withoutOrders));
  });

  it("leaves fundValueUsd and EVERY CompositionRow.usdValue identical, field by field", () => {
    const load = { status: "loaded", sourcePath: "synthetic", loadedAt: "2026-01-31T00:00:00Z" } as const;
    const before = buildCompositionReport(syntheticFund(), { load });

    const data = syntheticFund();
    const capital = composeAvailableCapital(data, pickRestingOrdersAsOf(ladder()));
    const after = buildCompositionReport(data, { load });

    // The ladder really does encumber the whole balance — without this the test below
    // would pass vacuously over a fund nothing was committed against.
    const encumbered = capital.reserves.find((r) => r.reserveId === CAPITAL_RESERVE);
    expect(encumbered?.committed).toBeGreaterThan(0);

    expect(Object.is(after.totals.fundValueUsd, before.totals.fundValueUsd)).toBe(true);
    expect(
      Object.is(after.dashboard.summary.fundValueUsd, before.dashboard.summary.fundValueUsd),
    ).toBe(true);

    const rowsOf = (report: typeof before) =>
      report.dashboard.sections.flatMap((section) =>
        section.rows.map((row) => [`${section.id}/${row.id}`, row.usdValue] as const),
      );
    const beforeRows = rowsOf(before);
    const afterRows = rowsOf(after);
    expect(afterRows.length).toBe(beforeRows.length);
    expect(beforeRows.length).toBeGreaterThan(0);
    for (const [index, [rowKey, usdValue]] of beforeRows.entries()) {
      const [afterKey, afterValue] = afterRows[index]!;
      expect(afterKey).toBe(rowKey);
      // `Object.is`, not `toBeCloseTo`: "byte-identical" is the claim.
      expect(Object.is(afterValue, usdValue)).toBe(true);
    }
  });
});

describe("the rung list SUBSTANTIATES the committed figure", () => {
  it("sums to committed, exactly, for the reserve it is listed under", () => {
    const { capital } = capitalOf(ladder());
    expect(capital.rungs).toHaveLength(RUNG_COUNT);
    const sum = capital.rungs.reduce((total, rung) => total + rung.committed, 0);
    expect(sum).toBeCloseTo(capital.committed, 10);
  });

  it("lists a rung under the reserve it DECLARES, never under another", () => {
    const { report } = capitalOf([...ladder(CAPITAL_RESERVE, 2), ...ladder(WEALTH_RESERVE, 1)]);
    for (const reserve of report.reserves) {
      for (const rung of reserve.rungs) {
        expect(rung.fundingReserveId).toBe(reserve.reserveId);
      }
    }
  });

  it("computes value − committed as available, with value left as the fold reported it", () => {
    const { capital } = capitalOf(ladder());
    expect(capital.value).toBe(LADDER_VALUE);
    expect(capital.committed).toBeCloseTo(LADDER_VALUE, 10);
    expect(capital.available).toBeCloseTo(capital.value - capital.committed, 10);
  });

  it("a reserve with no rungs reports zero committed and its full value available", () => {
    const { report } = capitalOf(ladder());
    const wealth = report.reserves.find((reserve) => reserve.reserveId === WEALTH_RESERVE);
    expect(wealth?.committed).toBe(0);
    expect(wealth?.rungs).toEqual([]);
    expect(wealth?.available).toBe(wealth?.value);
  });
});

describe("a partially-filled rung encumbers only its unfilled REMAINDER", () => {
  it("drops committed by the filled portion and keeps the remainder resting", () => {
    const partial: OrderRecord = {
      id: "rung-0",
      observedAt: "2026-01-10T10:00:00",
      kind: "orderFilled",
      currency: "USD",
      filledQuantity: RUNG_QUANTITY / 2,
    };
    const whole = capitalOf(ladder()).capital;
    const withPartial = capitalOf([...ladder(), partial]).capital;

    // The delta is the FILLED half of one rung's value — asserted as a movement, and
    // derived from the rung the fill names rather than written down as a figure.
    const filledHalf = whole.rungs.find((rung) => rung.orderId === "rung-0")!.committed / 2;
    expect(whole.committed - withPartial.committed).toBeCloseTo(filledHalf, 10);
    expect(withPartial.rungs).toHaveLength(RUNG_COUNT);
    expect(
      withPartial.rungs.find((rung) => rung.orderId === "rung-0")?.remainingQuantity,
    ).toBeCloseTo(RUNG_QUANTITY / 2, 10);
  });
});

describe("`T4`'s invariant, in its corrected form — `slack = value − committed ≥ 0`", () => {
  it("holds over the whole synthetic book", () => {
    const { report } = capitalOf(ladder());
    for (const reserve of report.reserves) {
      expect(reserve.available).toBeGreaterThanOrEqual(0);
    }
  });

  it("a CANCELLED rung moves slack by exactly that rung's value — the DELTA, not the state", () => {
    const records = ladder();
    const before = capitalOf(records).capital;

    const cancelled = before.rungs[2]!;
    const after = capitalOf([
      ...records,
      {
        id: cancelled.orderId,
        observedAt: "2026-01-20T10:00:00",
        kind: "orderCancelled",
        currency: "USD",
      },
    ]).capital;

    // THE ASSERTION IS A MOVEMENT (`O6`). The expected magnitude is read off the
    // CANCELLED RUNG ITSELF in the before-state, so no assertion about either resting
    // state alone can satisfy it: a bug that made `available` a constant, or that
    // rebuilt it from a stale book, still fails here because the movement would be zero
    // or would not equal that rung. The delta is also asserted non-zero, so a formula
    // that ignored cancellations entirely cannot slip through as "close enough".
    const delta = after.available - before.available;
    expect(delta).toBeCloseTo(cancelled.committed, 10);
    expect(delta).toBeGreaterThan(0);
    expect(after.committed - before.committed).toBeCloseTo(-cancelled.committed, 10);

    // And the invariant still holds on BOTH sides of the movement.
    expect(before.available).toBeGreaterThanOrEqual(0);
    expect(after.available).toBeGreaterThanOrEqual(0);
  });
});

describe("`slack < 0` REJECTS — and the report cannot disagree with the guard that rejects", () => {
  it("the import-boundary guard rejects a reserve that cannot fund its ladder (`O1`)", () => {
    const resting = pickRestingOrdersAsOf(ladder());
    const coverage = checkFundingCoverage(resting, syntheticFund(LADDER_VALUE - RUNG_VALUE));
    expect(coverage.status).toBe("over-committed");
    if (coverage.status !== "over-committed") throw new Error("unreachable");
    expect(coverage.shortfalls[0]?.slack).toBeLessThan(0);
  });

  it("ONE committed formula: the guard's committed and the report's committed agree", () => {
    // This is the anti-drift test for the FORMULA. A rendered `available` that disagreed
    // with the guard which ACCEPTED the orders would be worse than today's honest
    // silence, so both sides are computed from the shared committed formula and this
    // asserts they cannot part company about the arithmetic — including in the
    // over-committed case, where a second formula would be most likely to differ.
    //
    // It is NOT the anti-drift test for the ARGUMENTS, and it never was: it used to
    // hand-build the guard's balance array to agree with the fixture fund, which is
    // exactly how #172 stayed invisible. Both sides now take the SAME fund value, and
    // `funding-parity.test.ts` covers the argument divergences this file cannot see.
    const shortBalance = LADDER_VALUE - RUNG_VALUE;
    const fund = syntheticFund(shortBalance);
    const resting = pickRestingOrdersAsOf(ladder());
    const coverage = checkFundingCoverage(resting, fund);
    const { capital } = capitalOf(ladder(), fund);

    if (coverage.status !== "over-committed") throw new Error("fixture must over-commit");
    expect(coverage.shortfalls[0]?.committed).toBe(capital.committed);
    expect(coverage.shortfalls[0]?.slack).toBe(capital.available);
    expect(capital.available).toBeLessThan(0);
  });

  it("the guard's epsilon and the report's banner agree about float residue", () => {
    // The test above CANNOT catch this: `100 × 2 × 5 = 1000` is exactly representable in
    // binary, so it never produces residue for the two thresholds to disagree over.
    // `0.1` is not, so three rungs of `0.1 × 1` sum to a hair MORE than a balance of
    // `0.3` — the exact case `checkFundingCoverage`'s epsilon exists to ACCEPT, and the
    // exact case the report used to shout "available is NEGATIVE" over.
    const residual = ladder(CAPITAL_RESERVE, 3).map((record) => ({
      ...record,
      price: RESIDUE_PRICE,
      quantity: 1,
    })) as OrderRecord[];
    const balance = 0.3;
    const resting = pickRestingOrdersAsOf(residual);

    // Sanity: the fixture really does generate residue, or the rest proves nothing.
    const { capital } = capitalOf(residual, syntheticFund(balance));
    expect(capital.committed).not.toBe(balance); // 0.30000000000000004 ≠ 0.3
    expect(capital.available).toBeLessThan(0);
    expect(Math.abs(capital.available)).toBeLessThan(SLACK_EPSILON);

    // The guard ACCEPTS it …
    expect(checkFundingCoverage(resting, syntheticFund(balance)).status).toBe("ok");
    // … so the report must not call the same book an impossible state.
    const rendered = formatAvailableCapital(
      composeAvailableCapital(syntheticFund(balance), resting),
    );
    expect(rendered).not.toContain("NEGATIVE");

    // And the NUMBER is untouched — only the trigger moved. A genuinely negative
    // available still gets the banner, and still renders its own value.
    const genuine = formatAvailableCapital(
      composeAvailableCapital(syntheticFund(LADDER_VALUE - RUNG_VALUE), pickRestingOrdersAsOf(ladder())),
    );
    expect(genuine).toContain("NEGATIVE");
  });

  it("the shared helper is the SOLE source of both — rungs fold to committedByReserve", () => {
    const resting = pickRestingOrdersAsOf(ladder());
    const folded = committedByReserve(resting);
    const summed = committedRungs(resting).reduce(
      (total, rung) => total + rung.committed,
      0,
    );
    expect(folded.get(CAPITAL_RESERVE)).toBeCloseTo(summed, 10);
  });
});

describe("a rung the fold cannot place is surfaced, never silently dropped or mis-summed", () => {
  it("reports a rung naming an unknown reserve as unmatched", () => {
    const { report } = capitalOf(ladder("reserve-that-does-not-exist", 1));
    expect(report.unmatched).toHaveLength(1);
    expect(report.unmatched[0]?.reason).toBe("unfundable-reserve");
  });

  it("refuses to add a rung priced in another currency into a reserve's balance", () => {
    const foreign: OrderRecord = {
      ...ladder(CAPITAL_RESERVE, 1)[0]!,
      id: "rung-mxn",
      currency: "MXN",
    } as OrderRecord;
    const { report, capital } = capitalOf([foreign]);
    expect(capital.committed).toBe(0);
    expect(report.unmatched[0]?.reason).toBe("currency-mismatch");
  });

  it("a resting SELL does not encumber a cash reserve", () => {
    const sell = { ...ladder(CAPITAL_RESERVE, 1)[0]!, id: "rung-sell", side: "sell" as const };
    const { capital } = capitalOf([sell as OrderRecord]);
    expect(capital.committed).toBe(0);
    expect(capital.rungs).toEqual([]);
  });
});
