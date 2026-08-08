/**
 * The PURE half of the Bitget open-orders ingest: the CSV parse, the synthesized
 * identity, and the funding-coverage check that `O1` rejects on.
 *
 * EVERY FIXTURE IS A SYNTHETIC LADDER (`O7`). The pair, the rung prices, the sizes and
 * the reserve balances below are invented round numbers; the real ladder's figures live
 * only in the private notes vault and never in this repository. What is asserted here is
 * always a PROPERTY — identity is stable, the sentinel is not a string, the reject
 * fires — never a real value.
 */
import { describe, expect, it } from "vitest";
import {
  BITGET_OPEN_ORDERS_HEADER,
  parseBitgetOpenOrdersCsv,
  type BitgetOpenOrder,
} from "./bitget.js";
import { buildOrderPlacedRecords, canonicalDecimal, synthesizeOrderId } from "./ingest.js";
import { checkFundingCoverage } from "./coverage.js";
import { committedRungs } from "./committed.js";
import { parseOrderRecord, serializeOrderRecord } from "./records.js";
import { pickRestingOrdersAsOf } from "./select.js";
import { parseFixture } from "../fund-composition.fixtures.js";
import type { FundReviewData } from "../contracts.js";

const HEADER = BITGET_OPEN_ORDERS_HEADER.join(",");

/**
 * A fund carrying ONE live USD reserve with the given balance.
 *
 * The guard takes the FUND, not a balance array, so its reserve set is derived by the
 * same admission policy the rendered report uses and a test cannot hand it a reserve the
 * report would reject (#172). Balances here remain invented round numbers (`O7`).
 */
function fundWith(amount: number, reserveId = "reserve-a"): FundReviewData {
  return parseFixture({
    fund: { id: "synthetic-fund", name: "Synthetic Fund", baseCurrency: "USD" },
    review: { asOf: "2026-01-31", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "venue-usd", name: "Synthetic Venue", platform: "BITGET", currency: "USD" }],
    instruments: [{ id: "test-usd", name: "Test Asset", symbol: "XYZ", currency: "USD" }],
    reserves: [
      {
        id: reserveId,
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "venue-usd",
        currency: "USD",
        amount,
      },
    ],
    positions: [],
  });
}

/**
 * One synthetic rendered row. Defaults are deliberately obvious fakes: the pair is
 * `XYZUSDT`, prices are round hundreds and sizes are round tenths.
 */
function row(overrides: Partial<Record<string, string>> = {}): string {
  const fields: Record<string, string> = {
    timestamp: "2020-01-01 10:00:00",
    pair: "XYZ/USDT",
    time_in_force: "GTC",
    order_type: "Limit",
    side: "Buy",
    price: "1000",
    quantity: "0.1",
    trigger_price: "-- / --",
    order_value: "100",
    filled_quantity: "0",
    total_quantity: "0.1",
    filled_percent: "0.00%",
    status: "Unfilled",
    action: "Cancel",
    ...overrides,
  };
  return BITGET_OPEN_ORDERS_HEADER.map((column) => fields[column] ?? "").join(",");
}

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

function okOrders(text: string): BitgetOpenOrder[] {
  const parsed = parseBitgetOpenOrdersCsv(text);
  if (parsed.status !== "ok") {
    throw new Error(`expected an ok parse, got ${parsed.status}`);
  }
  return parsed.orders;
}

describe("parseBitgetOpenOrdersCsv — the 14-column rendered table", () => {
  it("reads the observed half of a synthetic ladder", () => {
    const orders = okOrders(
      csv(
        row({ price: "1000", quantity: "0.1", timestamp: "2020-01-01 10:00:00" }),
        row({ price: "900", quantity: "0.2", timestamp: "2020-01-01 10:00:01" }),
      ),
    );

    expect(orders).toHaveLength(2);
    expect(orders.map((order) => order.price)).toEqual([1000, 900]);
    expect(orders.map((order) => order.quantity)).toEqual([0.1, 0.2]);
    expect(orders.map((order) => order.side)).toEqual(["buy", "buy"]);
    expect(orders.map((order) => order.symbol)).toEqual(["XYZUSDT", "XYZUSDT"]);
    // Second-granular, no timezone — exactly what `observedAt` exists to express.
    expect(orders.map((order) => order.observedAt)).toEqual([
      "2020-01-01T10:00:00",
      "2020-01-01T10:00:01",
    ]);
  });

  it("derives the currency from the pair's QUOTE, with no fund-specific constant", () => {
    const [order] = okOrders(csv(row({ pair: "XYZ/USDT" })));
    expect(order?.currency).toBe("USD");

    const parsed = parseBitgetOpenOrdersCsv(csv(row({ pair: "XYZ/ZZZ" })));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    // An unknown quote is skipped and REPORTED — never silently defaulted to the
    // fund's own currency.
    expect(parsed.orders).toHaveLength(0);
    expect(parsed.skips.map((skip) => skip.problem)).toEqual(["unknown-quote-currency"]);
  });

  it("refuses a header it does not recognize, rather than guessing columns", () => {
    const fills = "timestamp,pair,side,price,quantity,fee\n2020-01-01 10:00:00,XYZ/USDT,Buy,1000,0.1,0";
    expect(parseBitgetOpenOrdersCsv(fills).status).toBe("unrecognized-header");
    expect(parseBitgetOpenOrdersCsv("").status).toBe("unrecognized-header");
  });

  it("is closed at the reader on status — a word outside the vocabulary is skipped", () => {
    const parsed = parseBitgetOpenOrdersCsv(csv(row({ status: "Expired" })));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.orders).toHaveLength(0);
    expect(parsed.skips.map((skip) => skip.problem)).toEqual(["unknown-status"]);
  });
});

// #173. The status word used to be the ADMISSION GATE, and the defect ran both ways: a
// row the venue printed as `unfilled` was admitted with its partial silently dropped
// (committed OVERSTATED), while a row printed as partially filled was skipped whole
// (committed UNDERSTATED and its capital reported FREE — the direction that costs money).
// The REMAINDER is the gate now; the status word is only a vocabulary check.
describe("#173 — the venue's filled_quantity is carried, and the REMAINDER decides resting", () => {
  it("admits a partially-filled row with its remainder still open", () => {
    const parsed = parseBitgetOpenOrdersCsv(
      csv(row({ status: "PartiallyFilled", quantity: "10", filled_quantity: "6" })),
    );
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    // Not an `unknown-status` skip any more, and not a skip at all.
    expect(parsed.skips).toEqual([]);
    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0]?.quantity).toBe(10);
    expect(parsed.orders[0]?.filledQuantity).toBe(6);
  });

  it("leaves a row with NO remainder out — it is not resting", () => {
    const parsed = parseBitgetOpenOrdersCsv(
      csv(row({ status: "PartiallyFilled", quantity: "10", filled_quantity: "10" })),
    );
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.orders).toHaveLength(0);
    expect(parsed.skips.map((skip) => skip.problem)).toEqual(["not-resting"]);
  });

  it("carries the partial through to `remainingQuantity` = quantity − filled_quantity", () => {
    const records = buildOrderPlacedRecords(
      okOrders(csv(row({ price: "100", quantity: "10", filled_quantity: "6" }))),
      { fundingReserveId: "reserve-a" },
    );
    const resting = pickRestingOrdersAsOf(records);
    expect(resting).toHaveLength(1);
    expect(resting[0]?.remainingQuantity).toBe(4);
  });

  it("encumbers `price × remainder`, asserted through the ONE committed formula", () => {
    // 10 units at 100 with 6 filled truly encumbers 400. Dropping the partial read 1,000.
    const rungs = committedRungs(
      pickRestingOrdersAsOf(
        buildOrderPlacedRecords(
          okOrders(csv(row({ price: "100", quantity: "10", filled_quantity: "6" }))),
          { fundingReserveId: "reserve-a" },
        ),
      ),
    );
    expect(rungs).toHaveLength(1);
    expect(rungs[0]?.committed).toBe(400);
    // The ORIGINAL size is still carried beside the remainder — it is what the cumulative
    // venue reading is compared against (#176).
    expect(rungs[0]?.quantity).toBe(10);
    expect(rungs[0]?.remainingQuantity).toBe(4);
  });

  it("stays IDEMPOTENT on a re-import: the partial is counted once, not twice", () => {
    const text = csv(row({ price: "100", quantity: "10", filled_quantity: "6" }));
    const first = buildOrderPlacedRecords(okOrders(text), { fundingReserveId: "reserve-a" });
    const second = buildOrderPlacedRecords(okOrders(text), { fundingReserveId: "reserve-a" });
    expect(second).toEqual(first);
    // The partial rides on the PLACEMENT line, which the selector dedupes by id — there is
    // no second `orderFilled` line for a replay to subtract twice.
    const resting = pickRestingOrdersAsOf([...first, ...second]);
    expect(resting).toHaveLength(1);
    expect(resting[0]?.remainingQuantity).toBe(4);
    expect([...first, ...second].filter((record) => record.kind !== "orderPlaced")).toEqual([]);
  });

  it("round-trips the partial through the record contract byte-for-byte", () => {
    const [record] = buildOrderPlacedRecords(
      okOrders(csv(row({ price: "100", quantity: "10", filled_quantity: "6" }))),
      { fundingReserveId: "reserve-a" },
    );
    if (!record) throw new Error("expected one record");
    const line = serializeOrderRecord(record);
    const parsed = parseOrderRecord(JSON.parse(line));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(serializeOrderRecord(parsed.record)).toBe(line);
    expect(pickRestingOrdersAsOf([parsed.record])[0]?.remainingQuantity).toBe(4);
  });

  it("writes NO extra key when there is nothing filled, so existing lines are unchanged", () => {
    const [record] = buildOrderPlacedRecords(okOrders(csv(row({ filled_quantity: "0" }))), {
      fundingReserveId: "reserve-a",
    });
    if (!record) throw new Error("expected one record");
    expect(record).not.toHaveProperty("observedFilledQuantity");
    expect(serializeOrderRecord(record)).not.toContain("observedFilledQuantity");
  });
});

describe("the null sentinel and the authoritative column (testing decision 4)", () => {
  it("does NOT parse `-- / --` as the string it is rendered as", () => {
    const [order] = okOrders(csv(row({ trigger_price: "-- / --" })));
    expect(order?.triggerPrice).toBeNull();
    expect(order?.triggerPrice).not.toBe("-- / --");
    expect(typeof order?.triggerPrice).not.toBe("string");
  });

  it("still reads a trigger price when the venue renders one", () => {
    const [order] = okOrders(csv(row({ trigger_price: "1100" })));
    expect(order?.triggerPrice).toBe(1100);
  });

  it("reconciles on `quantity`, never on the drifting `order_value`", () => {
    // A quote-sized rung truncated to the venue's lot precision: order_value does not
    // equal price × quantity, and quantity is the one that is right.
    const [order] = okOrders(csv(row({ price: "1000", quantity: "0.1", order_value: "99.96" })));
    expect(order?.quantity).toBe(0.1);
    // The drifting column is not carried at all — there is nothing to reconcile against.
    expect(order).not.toHaveProperty("orderValue");
    expect(JSON.stringify(order)).not.toContain("99.96");
  });
});

/**
 * #205 — THE DESCRIPTORS SURVIVE THE WRITE.
 *
 * These are the `KEY_ORDER` guard. `serializeOrderRecord` copies ONLY the keys named in
 * `KEY_ORDER.orderPlaced`, so a field added to `OrderPlacedRecord` and forgotten there is
 * dropped at write with a green `pnpm typecheck` and no other failing test — the value is
 * on the object in memory and absent from every line on disk. Asserting the round trip
 * (build → serialize → parse) rather than the record's own properties is what makes that
 * omission fail here.
 */
describe("the placement descriptors round-trip through the record contract (#205)", () => {
  function placedFrom(overrides: Partial<Record<string, string>> = {}) {
    const [record] = buildOrderPlacedRecords(okOrders(csv(row(overrides))), {
      fundingReserveId: "reserve-a",
    });
    if (!record) throw new Error("expected one record");
    return record;
  }

  it("carries `orderType` and `timeInForce` from the export's own columns onto the line", () => {
    const record = placedFrom({ order_type: "Limit", time_in_force: "GTC" });
    const line = serializeOrderRecord(record);
    const parsed = parseOrderRecord(JSON.parse(line));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    // THROUGH the line, not off the in-memory record: a missing `KEY_ORDER` entry fails
    // exactly here.
    expect(parsed.record).toMatchObject({ orderType: "Limit", timeInForce: "GTC" });
    // Byte-equal on the way back out, which is what `KEY_ORDER` exists to guarantee.
    expect(serializeOrderRecord(parsed.record)).toBe(line);
  });

  it("carries a rendered `triggerPrice` as a NUMBER", () => {
    const record = placedFrom({ trigger_price: "1100" });
    const parsed = parseOrderRecord(JSON.parse(serializeOrderRecord(record)));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.record).toMatchObject({ triggerPrice: 1100 });
  });

  it("OMITS `triggerPrice` for the blank sentinel rather than writing `null`", () => {
    // The observed row carries `null` — the venue positively rendering "no trigger". The
    // record has no honest spelling for that, and a written `null` would be a third state
    // every later reader of an append-only file would have to interpret.
    const record = placedFrom({ trigger_price: "-- / --" });
    expect(record).not.toHaveProperty("triggerPrice");
    const line = serializeOrderRecord(record);
    expect(line).not.toContain("triggerPrice");
    expect(line).not.toContain("null");
  });

  it("writes NO descriptor key at all when the venue rendered the cells blank", () => {
    // A blank is not a descriptor: absence is the only honest spelling of "we were never
    // told", and it is what keeps the comparison from manufacturing a difference.
    const record = placedFrom({ order_type: "", time_in_force: "  " });
    expect(record).not.toHaveProperty("orderType");
    expect(record).not.toHaveProperty("timeInForce");
    const line = serializeOrderRecord(record);
    expect(line).not.toContain("orderType");
    expect(line).not.toContain("timeInForce");
  });

  it("keeps a pre-widening line byte-identical on a re-serialize", () => {
    // The line every existing rung on the file looks like: ten keys, no descriptors. It
    // must still read and re-write to exactly the same bytes.
    const line = JSON.stringify({
      id: "bitget:XYZUSDT:buy:1000:2020-01-01T10:00:00",
      observedAt: "2020-01-01T10:00:00",
      kind: "orderPlaced",
      currency: "USD",
      symbol: "XYZUSDT",
      side: "buy",
      price: 1000,
      quantity: 0.1,
      fundingReserveId: "reserve-a",
    });
    const parsed = parseOrderRecord(JSON.parse(line));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(serializeOrderRecord(parsed.record)).toBe(line);
  });

  it("skips a line whose descriptor is present but empty, on the SAME gate the writer passed", () => {
    // The asymmetry that makes the shared gate worth having: a blank descriptor serializes
    // cleanly and only fails on the way back in, taking the whole placement line with it.
    const base = {
      id: "bitget:XYZUSDT:buy:1000:2020-01-01T10:00:00",
      observedAt: "2020-01-01T10:00:00",
      kind: "orderPlaced",
      currency: "USD",
      symbol: "XYZUSDT",
      side: "buy",
      price: 1000,
      quantity: 0.1,
      fundingReserveId: "reserve-a",
    };
    expect(parseOrderRecord({ ...base, orderType: "" })).toMatchObject({
      status: "skip",
      problem: "malformed",
    });
    expect(parseOrderRecord({ ...base, triggerPrice: 0 })).toMatchObject({
      status: "skip",
      problem: "malformed",
    });
    // An UNKNOWN key is still ignored, not refused — an older build reading a newer line
    // degrades gracefully, and that is unchanged.
    expect(parseOrderRecord({ ...base, someLaterDescriptor: "x" }).status).toBe("ok");
  });
});

describe("`canonicalDecimal` refuses ambiguous comma placement (#177)", () => {
  it("refuses a token whose comma is not in a thousands position", () => {
    // A decimal comma, not a group separator. Stripping it read `10,50` as `1050` — a
    // silent 100x error, baked into a durable id and into the committed sum.
    expect(canonicalDecimal("10,50")).toBeUndefined();
    expect(canonicalDecimal("1,00")).toBeUndefined();
    expect(canonicalDecimal("1000,5")).toBeUndefined();
    // No comma may follow the decimal point either.
    expect(canonicalDecimal("1.000,50")).toBeUndefined();
  });

  it("still accepts valid thousands grouping and the plain spelling", () => {
    expect(canonicalDecimal("1,000.50")).toBe("1000.5");
    expect(canonicalDecimal("10.50")).toBe("10.5");
    expect(canonicalDecimal("1,234,567")).toBe("1234567");
    expect(canonicalDecimal("-1,000")).toBe("-1000");
  });

  it("skips the row whose price carries an ambiguous comma rather than reading it 100x", () => {
    const parsed = parseBitgetOpenOrdersCsv(csv(row({ price: '"10,50"' })));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.orders).toHaveLength(0);
    expect(parsed.skips.map((skip) => skip.problem)).toEqual(["malformed"]);
  });
});

describe("synthesized identity (testing decision 5)", () => {
  it("is `(pair, side, price, submittedAt)` and nothing else", () => {
    const [order] = okOrders(csv(row()));
    expect(order?.id).toBe(
      synthesizeOrderId({
        venue: "bitget",
        symbol: "XYZUSDT",
        side: "buy",
        price: "1000",
        observedAt: "2020-01-01T10:00:00",
      }),
    );
  });

  it("is STABLE across the venue's rendering of the same price", () => {
    const plain = okOrders(csv(row({ price: "1000" })));
    const padded = okOrders(csv(row({ price: "1000.00" })));
    // Quoted, with a thousands separator — the field carries a comma of its own.
    const grouped = okOrders(csv(row({ price: '"1,000.00"' })));
    expect(padded[0]?.id).toBe(plain[0]?.id);
    expect(grouped[0]?.id).toBe(plain[0]?.id);
  });

  it("is stable across the pair's separator styling", () => {
    const slashed = okOrders(csv(row({ pair: "XYZ/USDT" })));
    const joined = okOrders(csv(row({ pair: "XYZUSDT" })));
    expect(joined[0]?.id).toBe(slashed[0]?.id);
  });

  it("changes when the PRICE changes — which is the whole re-price rule", () => {
    const before = okOrders(csv(row({ price: "1000" })));
    const after = okOrders(csv(row({ price: "990" })));
    expect(after[0]?.id).not.toBe(before[0]?.id);
  });

  it("re-importing the SAME export yields the same records, so replay counts them once", () => {
    const text = csv(row({ price: "1000" }), row({ price: "900" }));
    const first = buildOrderPlacedRecords(okOrders(text), { fundingReserveId: "reserve-a" });
    const second = buildOrderPlacedRecords(okOrders(text), { fundingReserveId: "reserve-a" });
    expect(second).toEqual(first);
    expect(pickRestingOrdersAsOf([...first, ...second])).toHaveLength(2);
  });
});

describe("buildOrderPlacedRecords — one declared field", () => {
  it("stamps the batch reserve on every order and records NOTHING else declared", () => {
    const records = buildOrderPlacedRecords(okOrders(csv(row(), row({ price: "900" }))), {
      fundingReserveId: "reserve-a",
    });
    expect(records.map((record) => record.fundingReserveId)).toEqual(["reserve-a", "reserve-a"]);
    for (const record of records) {
      expect(record.kind).toBe("orderPlaced");
      expect(record).not.toHaveProperty("positionId");
      expect(record).not.toHaveProperty("ladderId");
      expect(record).not.toHaveProperty("batchId");
    }
  });

  it("lets ONE rung disagree with the batch, by id", () => {
    const orders = okOrders(csv(row({ price: "1000" }), row({ price: "900" })));
    const dissenting = orders[1]?.id ?? "";
    const records = buildOrderPlacedRecords(orders, {
      fundingReserveId: "reserve-a",
      overrides: { [dissenting]: "reserve-b" },
    });
    expect(records.map((record) => record.fundingReserveId)).toEqual(["reserve-a", "reserve-b"]);
  });
});

describe("checkFundingCoverage — `O1`, and slack >= 0", () => {
  function restingFrom(text: string, fundingReserveId: string) {
    return pickRestingOrdersAsOf(buildOrderPlacedRecords(okOrders(text), { fundingReserveId }));
  }

  it("accepts a batch the declared reserve can fund", () => {
    // 0.1 @ 1000 + 0.1 @ 900 = 190 committed against a 1000 balance.
    const resting = restingFrom(csv(row({ price: "1000" }), row({ price: "900" })), "reserve-a");
    expect(checkFundingCoverage(resting, fundWith(1000)).status).toBe("ok");
  });

  it("REJECTS a batch whose committed sum exceeds the declared reserve", () => {
    const resting = restingFrom(csv(row({ price: "1000", quantity: "1" })), "reserve-a");
    const coverage = checkFundingCoverage(resting, fundWith(100));
    expect(coverage.status).toBe("over-committed");
    if (coverage.status !== "over-committed") return;
    expect(coverage.shortfalls).toHaveLength(1);
    expect(coverage.shortfalls[0]?.fundingReserveId).toBe("reserve-a");
    // slack = balance − committed, and slack < 0 is the impossible state.
    expect(coverage.shortfalls[0]?.slack).toBeLessThan(0);
  });

  it("holds slack >= 0 at exact equality rather than tripping on IEEE noise", () => {
    const resting = restingFrom(csv(row({ price: "0.1", quantity: "3" })), "reserve-a");
    expect(checkFundingCoverage(resting, fundWith(0.3)).status).toBe("ok");
  });

  it("rejects a declared reserve that does not exist, rather than reading it as zero", () => {
    const resting = restingFrom(csv(row()), "reserve-ghost");
    const coverage = checkFundingCoverage(resting, fundWith(1000));
    expect(coverage.status).toBe("unattributed");
    if (coverage.status !== "unattributed") return;
    expect(coverage.unmatched.map((entry) => entry.reason)).toEqual(["unfundable-reserve"]);
    expect(coverage.unmatched.map((entry) => entry.rung.fundingReserveId)).toEqual([
      "reserve-ghost",
    ]);
  });
});
