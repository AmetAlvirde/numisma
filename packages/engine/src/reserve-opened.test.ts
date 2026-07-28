// PROTOTYPE. The tenth verb, `ReserveOpened` — the one that lets a cash Reserve be
// born after t0 without editing the immutable genesis seed.
//
// Deliberately NARROW. This pins only the two SILENT holes and the reject cases,
// because those are the failures that do not announce themselves:
//
//   - the fold arm and the `applyEventToReference` arm both sit in switches with no
//     `default` and no return obligation, so OMITTING either compiles clean and
//     silently no-ops. TypeScript guards the `crossReferenceEvent` arm for free
//     (every arm returns), so that one needs no test.
//   - the rejects (currency mismatch, id collision, a stated opening balance) are
//     the difference between failing loud at ingest and admitting an event that
//     quietly produces a Reserve the read model then drops.
import {
  buildEventReference,
  applyEventToReference,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";
const OPENED_AS_OF = "2026-06-15";

/** Genesis with one USD account, one MXN account, and one funded USD Reserve. */
function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [
      { id: "bitget-usd", name: "Bitget", platform: "BITGET", currency: "USD" },
      { id: "gbm-mxn", name: "Casa de Bolsa", platform: "GBM", currency: "MXN" },
    ],
    instruments: [{ id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
      {
        id: "pulse-cash",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
        currency: "USD",
        amount: 1000,
        lots: [
          { quantity: 600, tier: "c1" },
          { quantity: 400, tier: "c2" },
        ],
      },
    ],
    positions: [],
  };
}

function openReserve(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-open",
    asOf: OPENED_AS_OF,
    type: "ReserveOpened",
    reserve: {
      id: "capital-cash",
      portfolioId: "core",
      tempo: "Capital",
      executionMode: "live",
      accountId: "bitget-usd",
      currency: "USD",
      ...overrides,
    },
  };
}

/** parseEvent, asserting success, so a test can hand the typed event onward. */
function accepted(input: Record<string, unknown>): PortfolioEvent {
  const result = parseEvent(input);
  if (result.kind !== "ok") {
    throw new Error(`expected parse to accept: ${result.path}: ${result.message}`);
  }
  return result.value;
}

describe("ReserveOpened — the fold", () => {
  // Guards the silent hole in `foldEvents`: no `default`, no return obligation, so
  // a missing arm would drop the Reserve entirely and every later Transfer into it
  // would vanish without a word.
  it("inserts the Reserve at amount 0, leaving NAV untouched", () => {
    const folded = foldEvents(genesis(), [accepted(openReserve())]);
    const born = folded.reserves.find((reserve) => reserve.id === "capital-cash");

    expect(born).toBeDefined();
    expect(born?.amount).toBe(0);
    expect(born?.tempo).toBe("Capital");
    expect(born?.currency).toBe("USD");
    // Total cash is unchanged: birth moves no capital.
    expect(folded.reserves.reduce((sum, reserve) => sum + reserve.amount, 0)).toBe(1000);
  });

  // `applyReserveDelta` early-returns on a FALSY `lots` ("untiered: amount is the
  // whole truth"), so a Reserve born WITHOUT a lots array would silently swallow the
  // `tier` of every incoming Transfer — laundering the exact provenance the Transfer
  // verb exists to carry. An empty array is truthy; this pins that choice.
  it("lets an incoming Transfer's tier ride into the newly born Reserve", () => {
    const events: PortfolioEvent[] = [
      accepted(openReserve()),
      accepted({
        id: "evt-move",
        asOf: OPENED_AS_OF,
        type: "Transfer",
        fromReserveId: "pulse-cash",
        toReserveId: "capital-cash",
        amount: 400,
        tier: "c2",
      }),
    ];
    const folded = foldEvents(genesis(), events);
    const born = folded.reserves.find((reserve) => reserve.id === "capital-cash");

    expect(born?.amount).toBe(400);
    expect(born?.lots).toEqual([{ quantity: 400, tier: "c2" }]);
    // NAV still conserved across the pair, and the source is drained of c2.
    expect(folded.reserves.reduce((sum, reserve) => sum + reserve.amount, 0)).toBe(1000);
  });
});

describe("ReserveOpened — cross-reference", () => {
  // Guards the second silent hole: `applyEventToReference` also has no `default` and
  // no return obligation. Omitting its arm compiles clean, and this same-batch pair —
  // the entire point of the verb — would fail with a bogus "reserve does not exist".
  it("accepts a same-batch ReserveOpened + Transfer into it", () => {
    const reference = buildEventReference(genesis());
    const opened = accepted(openReserve());
    expect(crossReferenceEvent(opened, reference).kind).toBe("ok");
    applyEventToReference(reference, opened);

    const transfer = accepted({
      id: "evt-move",
      asOf: OPENED_AS_OF,
      type: "Transfer",
      fromReserveId: "pulse-cash",
      toReserveId: "capital-cash",
      amount: 400,
      tier: "c2",
    });
    expect(crossReferenceEvent(transfer, reference).kind).toBe("ok");
  });

  // The reason `EventReference.accountIds` was widened from a bare id Set to an
  // account→currency Map. Canonical normalization EXCLUDES a currency-mismatched
  // Reserve, so admitting one here would put a Reserve in the durable log that the
  // read model silently drops.
  it("rejects a Reserve whose currency disagrees with its account", () => {
    const reference = buildEventReference(genesis());
    const result = crossReferenceEvent(
      accepted(openReserve({ accountId: "gbm-mxn" })),
      reference,
    );

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("reserve.currency");
      expect(result.message).toContain("MXN");
    }
  });

  it("rejects an id colliding with a genesis Reserve", () => {
    const reference = buildEventReference(genesis());
    const result = crossReferenceEvent(accepted(openReserve({ id: "pulse-cash" })), reference);

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("reserve.id");
      expect(result.message).toContain("collides");
    }
  });

  // Found by mutation-testing the arm above: killing `reserveBalances.set` alone
  // reddens the same-batch Transfer test, but killing `reserveIds.add` alone was
  // caught by NOTHING — the collision gate reads `reserveIds`, and only a SECOND
  // ReserveOpened in the same batch exercises it. Two events minting the same id
  // must fail loud, not have the later one silently win at fold.
  it("rejects a second ReserveOpened reusing an id minted earlier in the batch", () => {
    const reference = buildEventReference(genesis());
    const first = accepted(openReserve());
    applyEventToReference(reference, first);

    const result = crossReferenceEvent(
      accepted({ ...openReserve(), id: "evt-open-again" }),
      reference,
    );

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("reserve.id");
    }
  });

  it("rejects an unknown account", () => {
    const reference = buildEventReference(genesis());
    const result = crossReferenceEvent(accepted(openReserve({ accountId: "ghost" })), reference);

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("reserve.accountId");
    }
  });
});

describe("ReserveOpened — parse", () => {
  // Fail loud, never silently strip. NAV-neutrality is structural, so an author who
  // wrote an opening balance believes something the log will not honor.
  it.each(["amount", "lots"] as const)("rejects a payload carrying '%s'", (banned) => {
    const result = parseEvent(openReserve({ [banned]: banned === "amount" ? 500 : [] }));

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe(`reserve.${banned}`);
      expect(result.message).toContain("EMPTY");
    }
  });
});
