/**
 * THE ANTI-DRIFT TEST FOR THE GUARD'S ARGUMENTS.
 *
 * `available.test.ts` proves the two surfaces share the committed FORMULA. It cannot
 * prove they share its ARGUMENTS, because it hand-builds the guard's reserve list to
 * agree with the fixture fund — so it can only ever show that one shared function
 * returns one value. This file removes that freedom: BOTH surfaces are derived from a
 * SINGLE fund fixture, with no hand-built balance array anywhere, and every case asserts
 * the guard's verdict and the report's `unmatched`/`available` say the same thing about
 * the same rung.
 *
 * The four cases are the four ways the two used to part company:
 *   1. a live, matching reserve            — both place the rung
 *   2. a PAPER-mode reserve                — the report cannot place it; the guard must refuse
 *   3. an UNSUPPORTED-CURRENCY reserve     — likewise
 *   4. a CROSS-CURRENCY rung               — the money-losing direction: a quote-denominated
 *                                            committed summed into a native balance
 *
 * EVERY FIGURE IS SYNTHETIC (`O7`). Round, obviously-fake numbers; no real balance,
 * price, quantity or rung appears here and none may ever be added.
 */
import { describe, expect, it } from "vitest";
import { parseFixture } from "../fund-composition.fixtures.js";
import type { FundReviewData } from "../contracts.js";
import { composeAvailableCapital } from "./available.js";
import { checkFundingCoverage } from "./coverage.js";
import type { OrderRecord } from "./records.js";
import { pickRestingOrdersAsOf } from "./select.js";

const LIVE_USD = "reserve-live-usd";
const PAPER_USD = "reserve-paper-usd";
const ODD_CURRENCY = "reserve-odd-currency";
const LIVE_MXN = "reserve-live-mxn";

/** Obviously-fake round numbers: two rungs of 100 × 2 = 400 against a balance of 1000. */
const RUNG_PRICE = 100;
const RUNG_QUANTITY = 2;
const RUNG_COUNT = 2;
const LADDER_VALUE = RUNG_PRICE * RUNG_QUANTITY * RUNG_COUNT; // 400
const BALANCE = 1000;

/**
 * One fund carrying all four reserve shapes, so a single fixture feeds both surfaces.
 *
 * `PAPER_USD` and `ODD_CURRENCY` are exactly the reserves `buildCanonicalState` refuses
 * to admit — non-live execution mode, and a currency outside the supported set. They
 * exist in `data.reserves` (which is what the import CLI used to hand the guard) and are
 * absent from `reserveReconciliation` (which is what the report reads). That gap IS the
 * defect under test.
 */
function parityFund(): FundReviewData {
  return parseFixture({
    fund: { id: "synthetic-fund", name: "Synthetic Fund", baseCurrency: "USD" },
    review: { asOf: "2026-01-31", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [
      { id: "venue-usd", name: "Synthetic Venue", platform: "BITGET", currency: "USD" },
      { id: "venue-mxn", name: "Other Venue", platform: "XTB", currency: "MXN" },
    ],
    instruments: [{ id: "test-usd", name: "Test Asset", symbol: "TEST", currency: "USD" }],
    reserves: [
      reserve(LIVE_USD, { executionMode: "live", currency: "USD", accountId: "venue-usd" }),
      reserve(PAPER_USD, { executionMode: "paper", currency: "USD", accountId: "venue-usd" }),
      reserve(ODD_CURRENCY, { executionMode: "live", currency: "EUR", accountId: "venue-usd" }),
      reserve(LIVE_MXN, { executionMode: "live", currency: "MXN", accountId: "venue-mxn" }),
    ],
    positions: [],
  });
}

function reserve(
  id: string,
  overrides: { executionMode: string; currency: string; accountId: string },
) {
  return {
    id,
    portfolioId: "core",
    tempo: "Capital",
    amount: BALANCE,
    ...overrides,
  };
}

/** `RUNG_COUNT` synthetic BUY rungs, all resting, all declaring `reserveId`. */
function ladder(reserveId: string, currency: "USD" | "MXN" = "USD"): OrderRecord[] {
  return Array.from({ length: RUNG_COUNT }, (_unused, index) => ({
    id: `rung-${reserveId}-${index}`,
    observedAt: `2026-01-0${index + 1}T10:00:00`,
    kind: "orderPlaced" as const,
    currency,
    symbol: "TEST/USD",
    side: "buy" as const,
    price: RUNG_PRICE,
    quantity: RUNG_QUANTITY,
    fundingReserveId: reserveId,
  })) as OrderRecord[];
}

/**
 * Drive BOTH surfaces off ONE fund. The guard takes the fund itself, so there is no
 * argument left for a caller to get wrong — which is the fix this file locks.
 */
function bothSurfaces(records: OrderRecord[], data = parityFund()) {
  const resting = pickRestingOrdersAsOf(records);
  return {
    coverage: checkFundingCoverage(resting, data),
    report: composeAvailableCapital(data, resting),
  };
}

describe("the guard and the report admit the SAME reserves (one admission policy)", () => {
  it("both place a ladder against a live, currency-matching reserve", () => {
    const { coverage, report } = bothSurfaces(ladder(LIVE_USD));

    expect(coverage.status).toBe("ok");
    expect(report.unmatched).toEqual([]);
    const placed = report.reserves.find((entry) => entry.reserveId === LIVE_USD);
    expect(placed?.committed).toBe(LADDER_VALUE);
    expect(placed?.available).toBe(BALANCE - LADDER_VALUE);
  });

  it("both REFUSE a rung funded by a PAPER-mode reserve", () => {
    // Before the fix the guard said `ok` here — `data.reserves` carries the paper
    // reserve — while the report listed the rung as `unfundable-reserve` and encumbered
    // nothing. The import said yes and the rendered figure showed the capital as free.
    const { coverage, report } = bothSurfaces(ladder(PAPER_USD));

    expect(coverage.status).toBe("unattributed");
    if (coverage.status !== "unattributed") throw new Error("unreachable");
    expect(coverage.unmatched.map((entry) => entry.rung.fundingReserveId)).toEqual(
      Array.from({ length: RUNG_COUNT }, () => PAPER_USD),
    );
    expect(report.unmatched.map((entry) => entry.reason)).toEqual(
      Array.from({ length: RUNG_COUNT }, () => "unfundable-reserve"),
    );
    expect(report.reserves.some((entry) => entry.reserveId === PAPER_USD)).toBe(false);
  });

  it("both REFUSE a rung funded by an UNSUPPORTED-CURRENCY reserve", () => {
    const { coverage, report } = bothSurfaces(ladder(ODD_CURRENCY));

    expect(coverage.status).toBe("unattributed");
    if (coverage.status !== "unattributed") throw new Error("unreachable");
    expect(coverage.unmatched.map((entry) => entry.rung.fundingReserveId)).toEqual(
      Array.from({ length: RUNG_COUNT }, () => ODD_CURRENCY),
    );
    expect(report.unmatched.map((entry) => entry.reason)).toEqual(
      Array.from({ length: RUNG_COUNT }, () => "unfundable-reserve"),
    );
  });

  it("names BOTH failure classes when the book is wrong in both ways", () => {
    // #179's explicit AC, and the case the four hand-picked ones above could not reach:
    // a book carrying a PAPER-mode ladder AND a cross-currency ladder. The guard used to
    // filter for one class, return on it, and throw the other away — so the operator
    // fixed the reserve declaration, re-ran the whole import including its prompts, and
    // was refused a second time for a fault that was already computed on the first pass.
    const { coverage, report } = bothSurfaces([...ladder(PAPER_USD), ...ladder(LIVE_MXN, "USD")]);

    expect(coverage.status).toBe("unattributed");
    if (coverage.status !== "unattributed") throw new Error("unreachable");
    // `RUNG_COUNT` of EACH reason, and the list is INTERLEAVED rather than blocked by
    // class — the two ladders share a stamp series, so `pickRestingOrdersAsOf` alternates
    // them. That is the shape worth locking: the old guard filtered by reason, so it
    // could not have seen past the first block even if one existed.
    const reasons = coverage.unmatched.map((entry) => entry.reason);
    expect(reasons.filter((reason) => reason === "unfundable-reserve")).toHaveLength(RUNG_COUNT);
    expect(reasons.filter((reason) => reason === "currency-mismatch")).toHaveLength(RUNG_COUNT);
    // And the report says exactly the same thing about exactly the same rungs.
    expect(coverage.unmatched).toEqual(report.unmatched);
  });
});

describe("the guard and the report treat CURRENCY the same way", () => {
  it("both REFUSE a rung quoted in a currency the reserve does not hold", () => {
    // THE MONEY-LOSING DIRECTION. The rungs are quoted in USD and the reserve holds MXN.
    // Before the fix `ReserveBalance` carried no currency at all, so the guard summed a
    // quote-denominated committed straight into a native balance, found slack, and
    // accepted — while the report refused the identical rung as `currency-mismatch`.
    const { coverage, report } = bothSurfaces(ladder(LIVE_MXN, "USD"));

    expect(coverage.status).toBe("unattributed");
    if (coverage.status !== "unattributed") throw new Error("unreachable");
    expect(coverage.unmatched.map((entry) => entry.reason)).toEqual(
      Array.from({ length: RUNG_COUNT }, () => "currency-mismatch"),
    );
    expect(coverage.unmatched.map((entry) => entry.rung.fundingReserveId)).toEqual(
      Array.from({ length: RUNG_COUNT }, () => LIVE_MXN),
    );
    expect(report.unmatched.map((entry) => entry.reason)).toEqual(
      Array.from({ length: RUNG_COUNT }, () => "currency-mismatch"),
    );
    // And the reserve is reported UNENCUMBERED, which is only honest because the import
    // that would have encumbered it was refused.
    const mxn = report.reserves.find((entry) => entry.reserveId === LIVE_MXN);
    expect(mxn?.committed).toBe(0);
    expect(mxn?.available).toBe(BALANCE);
  });

  it("accepts the same rungs once they are quoted in the reserve's own currency", () => {
    // The mirror of the case above: nothing about cross-currency FUNDING is being
    // designed here, so the only thing that makes the ladder placeable is quoting it in
    // the currency the reserve actually holds.
    const { coverage, report } = bothSurfaces(ladder(LIVE_MXN, "MXN"));

    expect(coverage.status).toBe("ok");
    expect(report.unmatched).toEqual([]);
    expect(report.reserves.find((entry) => entry.reserveId === LIVE_MXN)?.committed).toBe(
      LADDER_VALUE,
    );
  });
});

describe("no verdict the guard accepts leaves the report with an unplaceable rung", () => {
  it("holds across every reserve in the fixture, one ladder at a time", () => {
    // The property, not four hand-picked cases: for EVERY reserve the fund declares —
    // admitted or not — an accepted import must leave the report with nothing unmatched,
    // and a refused import must be refused for the reason the report gives.
    for (const reserveId of [LIVE_USD, PAPER_USD, ODD_CURRENCY, LIVE_MXN]) {
      const { coverage, report } = bothSurfaces(ladder(reserveId));
      if (coverage.status === "unattributed") {
        // WHAT THIS PINS IS FORWARDING WITHOUT NARROWING — not agreement between two
        // implementations, and it must not be read as though it were. Both sides now
        // return the SAME array from the SAME `attributeRungs` call, so `toEqual` here is
        // close to tautological as a comparison of two independent derivations: there is
        // only one derivation left. That is the point of #172's shape, not a weakness of
        // it — but it does mean this assertion earns its keep somewhere else.
        //
        // Where it earns it: NARROWING is the defect, and narrowing is what this catches.
        // The guard used to filter `unmatched` by reason, return on the first non-empty
        // filter, and dedup one class down to a set of reserve ids — so the two surfaces
        // named different rungs while both were "derived from attribution". The likeliest
        // future regression is someone re-adding a dedup HERE, in the engine, "for
        // rendering convenience". The rendering does dedup, per reserve, and that is
        // correct — at the import boundary, where the remedy is. Do it in
        // `checkFundingCoverage` and this line fails, which is the whole intent.
        expect(coverage.unmatched).toEqual(report.unmatched);
      } else {
        // `ok` AND `over-committed` both mean attribution succeeded — the report places
        // everything. The old form asserted against `report.unmatched[0]?.reason`, the
        // FIRST entry only, and said nothing at all about `over-committed`; this is total
        // over all three arms.
        expect(report.unmatched).toEqual([]);
      }
    }
  });
});
