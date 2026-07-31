// O4 — "nothing speculative touches the durable log" — ASSERTED, NOT ASSUMED.
//
// The whole safety argument of ADR-013 is that a line in `orders.jsonl` cannot reach
// NAV because of WHICH FILE IT IS IN, not because of anyone's discipline in writing it.
// That argument rests on three facts, and a fact nobody asserts is a fact that quietly
// stops being true. All three are asserted against CODE — never against ADR prose,
// which cannot fail a test run.
//
// Every fixture below is synthetic. No real price, size, balance or rung appears here.
import { describe, expect, it } from "vitest";
import { EVENT_SCHEMA_VERSION, parseEvent } from "./events/parse.js";
import type { PortfolioEvent } from "./events/types.js";
import { parseOrderRecord, serializeOrderRecord } from "./orders/records.js";
import type { OrderPlacedRecord } from "./orders/records.js";
import { buildFillAct, fillEventId } from "./orders/fill.js";

/** A synthetic line of the shape `orders.jsonl` actually holds. */
const SYNTHETIC_ORDER: OrderPlacedRecord = {
  id: "rung-synthetic",
  observedAt: "2026-01-01T10:00:00",
  kind: "orderPlaced",
  currency: "USD",
  symbol: "TEST/USD",
  side: "buy",
  price: 100,
  quantity: 1,
  fundingReserveId: "reserve-synthetic",
};

/**
 * The event verbs, derived from the `PortfolioEvent` UNION ITSELF via its discriminant.
 * A verb added to the union with no entry here fails `pnpm typecheck`; an entry here
 * that is not in the union fails too. So this object cannot drift from the union, which
 * is what makes counting its keys a real assertion about the log's verb surface.
 *
 * Asserted against the union and NOT against ADR-003's body, which only ever enumerates
 * NINE — the tenth verb (`ReserveOpened`) lives in the code and in ADR-012.
 */
const EVENT_VERBS: Record<PortfolioEvent["type"], true> = {
  PositionOpened: true,
  PositionClosed: true,
  PositionTrimmed: true,
  PositionAddedTo: true,
  PriceMarked: true,
  Deposit: true,
  Withdraw: true,
  Transfer: true,
  InvalidationMarked: true,
  ReserveOpened: true,
};

describe("O4 — the orders sidecar leaves the durable log untouched", () => {
  it("parseEvent REJECTS an orders.jsonl line", () => {
    // The line is well-formed as an order and must still be nothing at all as an event:
    // it has no `asOf` and no `type`, so the envelope gate turns it away.
    const line = serializeOrderRecord(SYNTHETIC_ORDER);
    const result = parseEvent(JSON.parse(line));
    expect(result.kind).toBe("event-error");
  });

  it("parseEvent still rejects the line if someone hands it a schemaVersion", () => {
    // Guard against a false pass by a shallow reason: the rejection must come from the
    // envelope's own words being absent, not from a missing version marker.
    const dressed = { ...JSON.parse(serializeOrderRecord(SYNTHETIC_ORDER)), schemaVersion: EVENT_SCHEMA_VERSION };
    expect(parseEvent(dressed).kind).toBe("event-error");
  });

  it("the event verb count is TEN", () => {
    expect(Object.keys(EVENT_VERBS)).toHaveLength(10);
  });

  it("EVENT_SCHEMA_VERSION is 2", () => {
    expect(EVENT_SCHEMA_VERSION).toBe(2);
  });
});

describe("`S8` — the fill act introduces NO eleventh verb", () => {
  // The riskiest slice is the one that writes to BOTH files, so the claim that it did not
  // widen the log's verb surface is asserted against the same union map above rather than
  // against a second, drifting list.
  const act = buildFillAct({
    rung: {
      orderId: "rung-synthetic",
      observedAt: "2026-01-01T10:00:00",
      currency: "USD",
      symbol: "TEST/USD",
      side: "buy",
      price: 100,
      remainingQuantity: 1,
      fundingReserveId: "reserve-synthetic",
      committed: 100,
    },
    filledQuantity: 1,
    observedAt: "2026-01-02T10:00:00",
    fundingAmount: 100,
    tier: "c1",
    target: { mode: "add", positionId: "position-synthetic" },
  });

  it("writes a verb the ten-verb union already contains", () => {
    expect(EVENT_VERBS[act.event.type]).toBe(true);
    expect(Object.keys(EVENT_VERBS)).toHaveLength(10);
  });

  it("keeps EVENT_SCHEMA_VERSION at 2", () => {
    expect(EVENT_SCHEMA_VERSION).toBe(2);
  });

  it("writes ONE event — never the PROHIBITED Close+Open custody move (`T9`)", () => {
    // `buildFillAct` returns a single event by type, so a close/open pair is unexpressible
    // rather than merely unwritten.
    expect(act.event.type).toBe("PositionAddedTo");
    expect(act.event.type).not.toBe("PositionClosed");
  });

  it("the act's order half is still an orders.jsonl line parseEvent turns away", () => {
    expect(parseEvent(JSON.parse(serializeOrderRecord(act.order))).kind).toBe("event-error");
  });

  it("the two halves are joined by a DERIVED id, with no new field on either record", () => {
    // The join costs nothing on disk, which is what makes the crash window detectable
    // without designing the parked rung→lot key blind.
    expect(act.event.id).toBe(fillEventId(act.order.id, act.order.observedAt));
    const line = JSON.parse(serializeOrderRecord(act.order)) as Record<string, unknown>;
    expect(Object.keys(line)).toEqual(["id", "observedAt", "kind", "currency", "filledQuantity"]);
  });
});

describe("the naming claim: kind not type, observedAt not asOf", () => {
  it("a serialized order carries `kind` and `observedAt`, and neither of the log's words", () => {
    const line = JSON.parse(serializeOrderRecord(SYNTHETIC_ORDER)) as Record<string, unknown>;
    expect(line.kind).toBe("orderPlaced");
    expect(line.observedAt).toBe("2026-01-01T10:00:00");
    expect(line).not.toHaveProperty("type");
    expect(line).not.toHaveProperty("asOf");
  });

  it("observedAt expresses a stamp the event envelope's asOf could not", () => {
    // `parseEvent` gates `asOf` to a bare YYYY-MM-DD. The venue's stamps are
    // second-granular, so matching the log's word would mean losing information.
    const secondGranular = "2026-01-01T10:00:00";
    expect(parseOrderRecord({ ...SYNTHETIC_ORDER, observedAt: secondGranular }).status).toBe("ok");
    expect(parseEvent({ id: "x", schemaVersion: EVENT_SCHEMA_VERSION, asOf: secondGranular, type: "PriceMarked" }).kind).toBe(
      "event-error",
    );
  });

  it("rejects a date-only observedAt, which could not order same-minute rungs", () => {
    expect(parseOrderRecord({ ...SYNTHETIC_ORDER, observedAt: "2026-01-01" }).status).toBe("skip");
  });
});
