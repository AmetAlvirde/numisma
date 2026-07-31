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
import {
  buildOrderPlacedRecords,
  checkFundingCoverage,
  synthesizeOrderId,
} from "./ingest.js";
import { pickRestingOrdersAsOf } from "./select.js";

const HEADER = BITGET_OPEN_ORDERS_HEADER.join(",");

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

  it("is closed at the reader on status — one observed value, everything else skipped", () => {
    const parsed = parseBitgetOpenOrdersCsv(csv(row({ status: "PartiallyFilled" })));
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.orders).toHaveLength(0);
    expect(parsed.skips.map((skip) => skip.problem)).toEqual(["unknown-status"]);
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
    expect(checkFundingCoverage(resting, [{ id: "reserve-a", amount: 1000 }]).status).toBe("ok");
  });

  it("REJECTS a batch whose committed sum exceeds the declared reserve", () => {
    const resting = restingFrom(csv(row({ price: "1000", quantity: "1" })), "reserve-a");
    const coverage = checkFundingCoverage(resting, [{ id: "reserve-a", amount: 100 }]);
    expect(coverage.status).toBe("over-committed");
    if (coverage.status !== "over-committed") return;
    expect(coverage.shortfalls).toHaveLength(1);
    expect(coverage.shortfalls[0]?.fundingReserveId).toBe("reserve-a");
    // slack = balance − committed, and slack < 0 is the impossible state.
    expect(coverage.shortfalls[0]?.slack).toBeLessThan(0);
  });

  it("holds slack >= 0 at exact equality rather than tripping on IEEE noise", () => {
    const resting = restingFrom(csv(row({ price: "0.1", quantity: "3" })), "reserve-a");
    expect(checkFundingCoverage(resting, [{ id: "reserve-a", amount: 0.3 }]).status).toBe("ok");
  });

  it("rejects a declared reserve that does not exist, rather than reading it as zero", () => {
    const resting = restingFrom(csv(row()), "reserve-ghost");
    const coverage = checkFundingCoverage(resting, [{ id: "reserve-a", amount: 1000 }]);
    expect(coverage.status).toBe("unknown-reserve");
    if (coverage.status !== "unknown-reserve") return;
    expect(coverage.fundingReserveIds).toEqual(["reserve-ghost"]);
  });
});
