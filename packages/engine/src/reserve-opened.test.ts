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
  buildCompositionReport,
  buildEventReference,
  applyEventToReference,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  type CapitalTier,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";
const OPENED_AS_OF = "2026-06-15";
/** Before the Reserve is born, after the genesis review: the audit's measured case. */
const BACKDATED_AS_OF = "2026-06-10";

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

  // The born-and-never-funded case, and the permanent regression the `lots: []`
  // decision has owed since it was made. The empty ARRAY is the whole point: an
  // ABSENT `lots` makes `applyReserveDelta` early-return ("untiered: amount is the
  // whole truth"), so the Reserve would silently launder the tier of every later
  // credit while NAV still looked perfect. Asserting `toEqual([])` fails on both
  // `undefined` and on a "simplification" that drops the key.
  it("births a Reserve with an EMPTY lots array, not an absent one", () => {
    const folded = foldEvents(genesis(), [accepted(openReserve())]);
    const born = folded.reserves.find((reserve) => reserve.id === "capital-cash");

    expect(born?.lots).toEqual([]);
    expect(Array.isArray(born?.lots)).toBe(true);
  });

  // A Reserve that is born and never funded must be INVISIBLE to the read model's
  // complaint channels: no warning, every exclusion counter at zero, and NAV
  // identical to the last digit — asserted against the same genesis composed
  // WITHOUT the event, so the claim is the DELTA (exactly 0) and not a resting
  // value that happens to look right.
  it("composes a born-and-never-funded Reserve with no warnings and NAV unchanged", () => {
    const before = buildCompositionReport(genesis());
    const after = buildCompositionReport(
      foldEvents(genesis(), [accepted(openReserve())]),
    );

    expect(after.warnings).toEqual([]);
    expect(after.excluded).toEqual({ nonLive: 0, invalid: 0, shortDeferred: 0 });
    // Zero tolerance: neutrality is the entire claim, so "close enough" defeats it.
    expect(after.totals.fundValueUsd).toBe(before.totals.fundValueUsd);
    expect(after.totals.fundValueUsd - before.totals.fundValueUsd).toBe(0);
  });
});

// The verb registers at THREE sites — parse, the cross-ref reference, the fold —
// and two of the three sit in switches with no return obligation. This block owns
// the claim that one event reaches all three.
//
// The cross-ref arm writes TWO id structures guarding DIFFERENT questions, so each
// needs its own killer. Mutation-tested, one line deleted at a time:
//
//   `reserveIds.add`       → kills this integration test AND
//                            "rejects a second ReserveOpened reusing an id minted
//                            earlier in the batch" (the collision gate reads
//                            `reserveIds`, and only a SECOND ReserveOpened in the
//                            batch exercises it).
//   `reserveBalances.set`  → kills this integration test AND
//                            "accepts a same-batch ReserveOpened + Transfer into
//                            it" (existence/sufficiency reads `reserveBalances`).
//
// The integration test alone would NOT distinguish them; the two cross-reference
// tests are what make each deletion identifiable.
describe("ReserveOpened — the three registration sites", () => {
  it("reaches parse, the cross-reference world, and the fold from one event", () => {
    // Site 1 — parse.ts's `case "ReserveOpened"`. A missing arm lands in the
    // `default:` and rejects with "Unsupported event type", so parse is the one
    // site that already failed loud.
    const parsed = parseEvent(openReserve());
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(parsed.value.type).toBe("ReserveOpened");

    // Site 2 — crossref.ts's `applyEventToReference` arm, both of its lines.
    const reference = buildEventReference(genesis());
    expect(reference.reserveIds.has("capital-cash")).toBe(false);
    applyEventToReference(reference, parsed.value);
    expect(reference.reserveIds.has("capital-cash")).toBe(true);
    expect(reference.reserveBalances.get("capital-cash")).toEqual({
      amount: 0,
      // An EMPTY tier map, not `null`: the shadow must mirror the fold's `lots: []`,
      // so the sufficiency gate agrees with the balances the fold will produce.
      tiers: new Map(),
      currency: "USD",
      // The third thing the arm registers: the birth date the existence gate reads,
      // taken from the event's OWN asOf, not from the batch's arrival order.
      bornAsOf: OPENED_AS_OF,
    });

    // Site 3 — fold.ts's `foldEvents` arm.
    const folded = foldEvents(genesis(), [parsed.value]);
    expect(folded.reserves.map((reserve) => reserve.id)).toContain("capital-cash");
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

  // The reason `EventReference.accountCurrencies` was widened from a bare id Set to an
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

  // The account gate's twin, and untested until now. `portfolioId` is the other id the
  // Reserve inherits from the seed rather than mints, and a dangling one produces a
  // Reserve that belongs to no portfolio — invisible in every per-portfolio rollup
  // while still counting toward fund NAV. The account check happens to be guarded by
  // the currency lookup it shares; this one has nothing else standing behind it, so
  // deleting `portfolioIds.has` was caught by nothing.
  it("rejects an unknown portfolioId", () => {
    const reference = buildEventReference(genesis());
    const result = crossReferenceEvent(accepted(openReserve({ portfolioId: "ghost" })), reference);

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("reserve.portfolioId");
      expect(result.message).toContain("ghost");
    }
  });

  // The same reject as the currency one, for a WORSE asymmetry. Canonical
  // normalization excludes a currency-mismatched Reserve WITH a warning; it drops a
  // non-live one with `excluded.nonLive += 1` and no warning at all. So the message
  // must name the read-model exclusion as the cause, not merely say "not live".
  it.each(["paper", "back-test", "forward-test"] as const)(
    "rejects a Reserve opened in %s mode, naming the silent read-model exclusion",
    (mode) => {
      const reference = buildEventReference(genesis());
      const result = crossReferenceEvent(
        accepted(openReserve({ executionMode: mode })),
        reference,
      );

      expect(result.kind).toBe("event-error");
      if (result.kind === "event-error") {
        expect(result.path).toBe("reserve.executionMode");
        expect(result.message).toContain(mode);
        expect(result.message).toContain("read model");
        expect(result.message).toContain("NO warning");
      }
    },
  );
});

// M2 + D4 — "does this Reserve exist AS OF THIS DATE".
//
// Cross-reference validates in LOG order; the fold applies in (asOf, then log)
// order, and nothing reconciled the two — `asOf` appeared nowhere in the ingest
// path. Before this verb every cross-ref-approved reserve id was a genesis reserve
// present in the fold from t0, so "does this Reserve exist" was a TOTAL question.
// `ReserveOpened` makes it PARTIAL, and the audit measured the consequence:
// `[ReserveOpened asOf 06-15, Transfer asOf 06-10 into it]` passed BOTH gates,
// the Transfer sorted FIRST at fold, `applyToReserve` silently skipped the
// not-yet-born destination, and cash went 1000 → 600 with `warnings: []`.
describe("ReserveOpened — the gate learns time", () => {
  /** The audit's measured pair, in the log order an inbox would hand them over. */
  function backdatedBatch(): Record<string, unknown>[] {
    return [
      openReserve(),
      {
        id: "evt-move",
        asOf: BACKDATED_AS_OF, // BEFORE `capital-cash` is born on 2026-06-15.
        type: "Transfer",
        fromReserveId: "pulse-cash",
        toReserveId: "capital-cash",
        amount: 400,
        tier: "c2",
      },
    ];
  }

  /**
   * The ingest contract in miniature: parse then cross-reference each event in LOG
   * order, extending the reference as each is accepted, and ABORT THE WHOLE BATCH on
   * the first rejection. All-or-nothing — a partially-applied batch is the failure
   * mode the ledger exists to remove.
   */
  function ingestBatch(
    inputs: Record<string, unknown>[],
    seed: FundReviewData = genesis(),
  ): {
    committed: PortfolioEvent[];
    rejection: { path: string; message: string } | null;
  } {
    const reference = buildEventReference(seed);
    const committed: PortfolioEvent[] = [];
    for (const input of inputs) {
      const parsed = parseEvent(input);
      if (parsed.kind !== "ok") {
        return { committed: [], rejection: { path: parsed.path, message: parsed.message } };
      }
      const checked = crossReferenceEvent(parsed.value, reference);
      if (checked.kind !== "ok") {
        return { committed: [], rejection: { path: checked.path, message: checked.message } };
      }
      applyEventToReference(reference, parsed.value);
      committed.push(parsed.value);
    }
    return { committed, rejection: null };
  }

  const totalCash = (fund: FundReviewData): number =>
    fund.reserves.reduce((sum, reserve) => sum + reserve.amount, 0);

  const tierQuantity = (fund: FundReviewData, reserveId: string, tier: CapitalTier): number =>
    fund.reserves
      .find((reserve) => reserve.id === reserveId)
      ?.lots?.find((lot) => lot.tier === tier)?.quantity ?? 0;

  it("rejects a Transfer dated before the Reserve it moves into was born", () => {
    const { rejection } = ingestBatch(backdatedBatch());

    expect(rejection).not.toBeNull();
    expect(rejection?.path).toBe("toReserveId");
    // Names the offending field's own dates, so the operator can see the ordering.
    expect(rejection?.message).toContain(BACKDATED_AS_OF);
    expect(rejection?.message).toContain(OPENED_AS_OF);
  });

  // Z2 — THE ASSERTION IS THE DELTA, NOT THE RESTING STATE. The prototype run passed
  // seven of nine assertions purely because the world already looked post-transfer, so
  // a test that asserts absolute balances passes this bug and does not count. Every
  // claim below is of the form "nothing moved": after MINUS before, exactly zero.
  it("moves no cash at all when the batch is rejected — every delta exactly 0", () => {
    const before = foldEvents(genesis(), []);
    const { committed } = ingestBatch(backdatedBatch());
    const after = foldEvents(genesis(), committed);

    // Fund-wide: pre-fix the Transfer sorted first, debited `pulse-cash`, and credited
    // a Reserve that did not exist yet — a −400 delta with `warnings: []`.
    expect(totalCash(after) - totalCash(before)).toBe(0);
    // The source's c2 lot specifically: pre-fix it drained to zero.
    expect(
      tierQuantity(after, "pulse-cash", "c2") - tierQuantity(before, "pulse-cash", "c2"),
    ).toBe(0);
    // And the batch is all-or-nothing: the legal `ReserveOpened` does not land either.
    expect(after.reserves.length - before.reserves.length).toBe(0);
  });

  it("accepts a Transfer dated on the Reserve's own birth date", () => {
    const [opened, transfer] = backdatedBatch();
    const { rejection } = ingestBatch([opened!, { ...transfer!, asOf: OPENED_AS_OF }]);

    expect(rejection).toBeNull();
  });

  // D4 — the same question asked of the CONTAINER instead of the movement. A Reserve
  // born before the genesis review it is born into is the mint-side twin of a movement
  // dated before its Reserve: the fold would apply it ahead of the world it belongs to.
  it("rejects a ReserveOpened dated before the genesis review", () => {
    const reference = buildEventReference(genesis());
    const result = crossReferenceEvent(
      accepted({ ...openReserve(), asOf: "2026-05-01" }),
      reference,
    );

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("asOf");
      expect(result.message).toContain(GENESIS_AS_OF);
    }
  });

  it("accepts a ReserveOpened dated on the genesis review date itself", () => {
    const reference = buildEventReference(genesis());

    expect(
      crossReferenceEvent(accepted({ ...openReserve(), asOf: GENESIS_AS_OF }), reference).kind,
    ).toBe("ok");
  });

  // THE REMEDY MUST BE ONE THE OPERATOR CAN ACTUALLY PERFORM. `bornAsOf` covers two
  // populations that read identically at the error site: a log-born Reserve, whose
  // birth IS an event and can be redated, and a genesis-SEEDED one, born at
  // `genesis.review.asOf` with no event behind it at all. Nine of the fund's ten
  // reserves are seeded, so "or open the Reserve earlier" was the advice the COMMON
  // case got — and it sends the operator hunting for a `ReserveOpened` that does not
  // exist. The clause must appear for exactly one of the two.
  it("offers 'open the Reserve earlier' only for a log-born Reserve, never a seeded one", () => {
    // Seeded: `pulse-cash` is born with the world, so its only fix is the date.
    const seeded = ingestBatch([
      {
        id: "evt-early-deposit",
        asOf: "2026-05-15", // before the genesis review, so before `pulse-cash` exists.
        type: "Deposit",
        reserveId: "pulse-cash",
        amount: 100,
        tier: "c1",
      },
    ]);
    expect(seeded.rejection?.message).toContain("not born until");
    expect(seeded.rejection?.message).not.toContain("open the Reserve earlier");
    expect(seeded.rejection?.message).toContain(GENESIS_AS_OF);
    // The fold-order explanation is the valuable half and survives in both branches.
    expect(seeded.rejection?.message).toContain("date order");

    // Log-born: `capital-cash` has a `ReserveOpened` behind it, so both fixes are real.
    const logBorn = ingestBatch(backdatedBatch());
    expect(logBorn.rejection?.message).toContain("open the Reserve earlier");
    expect(logBorn.rejection?.message).toContain("date order");
  });

  // BORN-BY REGRESSION SUITE. `requireReserveBornBy` collapsed eight scattered
  // existence checks into one, and every call site passes `event.asOf` today. The
  // failure this suite exists to catch is a LATER edit passing `reference.genesisAsOf`
  // at one of them instead — which restores the pre-fix behaviour (every Reserve looks
  // as old as the world) at exactly one verb, while the whole rest of the suite stays
  // green because no other test dates an event before a Reserve's birth. Mutating any
  // single site must redden exactly one case below.
  describe("every collapsed call site rejects a movement dated before the Reserve's birth", () => {
    /** Genesis plus one open position, for the three verbs that need one to reference. */
    function genesisWithPosition(): FundReviewData {
      return {
        ...genesis(),
        positions: [
          {
            id: "btc-core",
            portfolioId: "core",
            tempo: "Capital",
            executionMode: "live",
            accountId: "bitget-usd",
            instrumentId: "btc-usd",
            direction: "long",
            markPrice: 100,
            currency: "USD",
            lots: [{ quantity: 2, cost: 100, tier: "c1" }],
          },
        ],
      };
    }

    /** `[ReserveOpened, <movement backdated before it>]` — the audit's shape, per verb. */
    function afterOpening(
      movement: Record<string, unknown>,
      seed?: FundReviewData,
    ): { path: string; message: string } | null {
      return ingestBatch([openReserve(), { asOf: BACKDATED_AS_OF, ...movement }], seed).rejection;
    }

    /** Every rejection must name BOTH dates, or the operator cannot see the ordering. */
    function expectBornByRejection(
      rejection: { path: string; message: string } | null,
      path: string,
    ): void {
      expect(rejection).not.toBeNull();
      expect(rejection?.path).toBe(path);
      expect(rejection?.message).toContain("not born until");
      expect(rejection?.message).toContain(BACKDATED_AS_OF);
      expect(rejection?.message).toContain(OPENED_AS_OF);
    }

    it("Deposit — reserveId", () => {
      expectBornByRejection(
        afterOpening({
          id: "evt-deposit",
          type: "Deposit",
          reserveId: "capital-cash",
          amount: 250,
          tier: "c1",
        }),
        "reserveId",
      );
    });

    // The one verb with no OTHER existence check: before this PR's refactor its birth
    // gate lived inside `checkDebit`, so it is the site where removing the id-based
    // lookup would delete the gate rather than de-duplicate it.
    it("Withdraw — amount", () => {
      expectBornByRejection(
        afterOpening({
          id: "evt-withdraw",
          type: "Withdraw",
          reserveId: "capital-cash",
          amount: 100,
          tier: "c1",
        }),
        "amount",
      );
    });

    // The destination leg is covered above; this is the SOURCE, which had no test.
    // The destination here is the seeded `pulse-cash`, so only the source can trip.
    it("Transfer — fromReserveId (the source leg)", () => {
      expectBornByRejection(
        afterOpening({
          id: "evt-move-out",
          type: "Transfer",
          fromReserveId: "capital-cash",
          toReserveId: "pulse-cash",
          amount: 100,
          tier: "c1",
        }),
        "fromReserveId",
      );
    });

    it("PositionOpened — funding.reserveId", () => {
      expectBornByRejection(
        afterOpening({
          id: "evt-open-position",
          type: "PositionOpened",
          position: {
            id: "btc-new",
            portfolioId: "core",
            tempo: "Capital",
            executionMode: "live",
            accountId: "bitget-usd",
            instrumentId: "btc-usd",
            direction: "long",
            currency: "USD",
            lots: [{ quantity: 1, cost: 100, tier: "c1" }],
          },
          decision: {
            entryThesis: "thesis",
            invalidationCondition: "invalidation",
            riskBudget: "1R",
            plannedHoldingHorizon: "weeks",
            strategy: "trend",
          },
          funding: { reserveId: "capital-cash", amount: 100 },
        }),
        "funding.reserveId",
      );
    });

    it("PositionAddedTo — funding.reserveId", () => {
      expectBornByRejection(
        afterOpening(
          {
            id: "evt-add",
            type: "PositionAddedTo",
            positionId: "btc-core",
            lot: { quantity: 1, cost: 100, tier: "c1" },
            funding: { reserveId: "capital-cash", amount: 100 },
          },
          genesisWithPosition(),
        ),
        "funding.reserveId",
      );
    });

    it("PositionClosed — settlement.reserveId", () => {
      expectBornByRejection(
        afterOpening(
          {
            id: "evt-close",
            type: "PositionClosed",
            positionId: "btc-core",
            settlement: { reserveId: "capital-cash", proceeds: 200 },
          },
          genesisWithPosition(),
        ),
        "settlement.reserveId",
      );
    });

    it("PositionTrimmed — settlement.reserveId", () => {
      expectBornByRejection(
        afterOpening(
          {
            id: "evt-trim",
            type: "PositionTrimmed",
            positionId: "btc-core",
            removals: [{ quantity: 1, tier: "c1" }],
            settlement: { reserveId: "capital-cash", proceeds: 100 },
          },
          genesisWithPosition(),
        ),
        "settlement.reserveId",
      );
    });
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

  // THE ENVELOPE, SEALED. The guarantee above was true one level down and FALSE here:
  // `parseEvent({ ...openReserve(), amount: 5000 })` returned `kind: "ok"` with the
  // 5000 silently dropped. Nothing corrupted — the Reserve still opens at $0, the
  // verb's NAV-neutrality is structural — but what the author believed and what the
  // log honored had parted, and this repo's named hazard IS that parting. A doc
  // comment overstating its guarantee is itself the defect.
  it.each(["amount", "lots"] as const)(
    "rejects a TOP-LEVEL '%s' on the envelope, not just inside the reserve payload",
    (banned) => {
      const result = parseEvent({
        ...openReserve(),
        [banned]: banned === "amount" ? 5000 : [{ quantity: 5000, tier: "c1" }],
      });

      expect(result.kind).toBe("event-error");
      if (result.kind === "event-error") {
        expect(result.path).toBe(banned);
        expect(result.message).toContain("EMPTY");
      }
    },
  );

  // Presence, not truthiness — at the envelope too, for the same reason it is presence
  // inside the payload.
  it.each(["amount", "lots"] as const)(
    "rejects a top-level '%s' present but undefined",
    (banned) => {
      const result = parseEvent({ ...openReserve(), [banned]: undefined });

      expect(result.kind).toBe("event-error");
      if (result.kind === "event-error") {
        expect(result.path).toBe(banned);
      }
    },
  );

  // The banned-key check is `banned in reserve`, which is STRICTER than it reads: a
  // key PRESENT but `undefined` is rejected too. Do not "simplify" it to a truthiness
  // check — `lots: undefined` would then slip through and birth a lots-LESS Reserve,
  // the exact provenance-laundering shape `lots: []` exists to prevent.
  it.each(["amount", "lots"] as const)(
    "rejects '%s' present but undefined — the key check is presence, not truthiness",
    (banned) => {
      const result = parseEvent(openReserve({ [banned]: undefined }));

      expect(result.kind).toBe("event-error");
      if (result.kind === "event-error") {
        expect(result.path).toBe(`reserve.${banned}`);
      }
    },
  );

  // `executionMode` became LOAD-BEARING when the cross-ref gate started rejecting a
  // non-live Reserve, so the shape gate below it has to hold: an unsupported mode
  // must never reach cross-reference to be compared against "live".
  it("rejects an unsupported executionMode", () => {
    const result = parseEvent(openReserve({ executionMode: "simulated" }));

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("reserve.executionMode");
      expect(result.message).toContain("Unsupported");
    }
  });

  it("rejects an unsupported currency", () => {
    const result = parseEvent(openReserve({ currency: "EUR" }));

    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("reserve.currency");
    }
  });

  // Every required field, one at a time. An empty string is the shape a hand-authored
  // inbox entry actually arrives in (a template with the value not filled in), and it
  // is NOT caught by a bare `typeof === "string"` — so each field is pinned.
  it.each(["id", "portfolioId", "tempo", "accountId"] as const)(
    "rejects an empty string in reserve.%s",
    (field) => {
      const result = parseEvent(openReserve({ [field]: "" }));

      expect(result.kind).toBe("event-error");
      if (result.kind === "event-error") {
        expect(result.path).toBe(`reserve.${field}`);
      }
    },
  );

  // Whitespace-only is the same defect wearing a disguise; `requireNonEmptyString`
  // trims, and this pins that it does.
  it.each(["id", "portfolioId", "tempo", "accountId"] as const)(
    "rejects a whitespace-only reserve.%s",
    (field) => {
      const result = parseEvent(openReserve({ [field]: "   " }));

      expect(result.kind).toBe("event-error");
      if (result.kind === "event-error") {
        expect(result.path).toBe(`reserve.${field}`);
      }
    },
  );
});
