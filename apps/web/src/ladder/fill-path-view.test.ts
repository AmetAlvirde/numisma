/**
 * `composeFillPathPage` — the pure web-side mediation between the wire's `dca` branch
 * and what `/ladder/$planId` renders (spec #285 S-F/S-H, slice #289).
 *
 * WHAT IS ASSERTABLE HERE, AND WHAT IS NOT. This repo has no React Testing Library
 * toolchain and this increment deliberately does not add one (see
 * `routes/route-move.test.ts`'s header and docs/coverage-rationale.md §6). So the whole
 * of what can regress silently lives in THIS module — the five absence rules, the two
 * spot-dependent decorations, the chart geometry, the banner arms — and the component
 * that consumes it is a rendering of already-decided facts. The operator judges the
 * layout by opening the phone; nothing below pretends to cover that.
 *
 * EVERY FIXTURE IS SYNTHESIZED. Prices, sizes and quantities are this file's own
 * invention; the fund's real ladder is never a seed, in a committed fixture or in a
 * test. What is copied from reality is SHAPE (eight rungs, zero fills), which is a
 * cardinality, not an amount.
 *
 * ── MUTATION CHECK (repo discipline; performed 2026-08-11) ──────────────────────────
 * Each guard was reverted once, confirmed red FOR THE RIGHT REASON, and restored:
 *
 *  - pinned `notPlaced` to `false`, so an unjoined rung stops being read as never
 *    placed → "reads a rung with no order joined as declared-but-not-placed" red.
 *    Right reason: absence rule 1 — the missing fields ARE the state.
 *  - collapsed `measured`'s two causes into one string → "tells an unreadable sidecar
 *    apart from a ladder that simply has no fills" red on the cause. Right reason:
 *    absence rule 2 — two different absences rendered as the same claim.
 *  - made an absent `tornActs` read as `clear` → "an absent torn count never renders
 *    the all-clear" red with `clear` where `unchecked` was expected. Right reason:
 *    absence rule 3 — absent means this row could not check.
 *  - stopped passing `orphanLots` through → "an absent orphan count is zero, not
 *    unknown" red on the present-and-nonzero half. Right reason: absence rule 5, the
 *    deliberate opposite convention to `tornActs`.
 *  - restored the `?? 0` on the two waiting figures, so an unread sidecar reports `$0`
 *    waiting again → "carries rule 2 all the way to the WAITING figures" red, and with
 *    it the `orphanLots ?? 0` half. Right reason: absence rule 2 — `figures` absent is
 *    "could not check", never "nothing is placed".
 *  - collapsed the waiting split back to two arms → "says NOTHING IS WAITING when the
 *    ladder is fully walked" red with `all-resting`. Right reason: a fully walked ladder
 *    has nothing resting to say the all-clear about.
 *  - dropped `priceUsd < livePrice` from the `next` search → 2 red, the first marking a
 *    rung ABOVE spot and the second marking one after price had fallen past the whole
 *    ladder. Right reason: `next` is the first rung a FALLING price meets.
 *  - relaxed `price passed` from `resting` to any unfilled rung → "does not claim a
 *    never-placed rung was passed unconfirmed" red. Right reason: there is no order for
 *    the venue to be silent about.
 *  - relaxed EITHER boundary comparison one notch — `priceUsd < livePrice` to `<=`, and
 *    `priceUsd >= livePrice` to `>` — → "decides the rung sitting EXACTLY at spot" red,
 *    each in its own half. Right reason: a rung at spot must be exactly one of the two
 *    states, and until that fixture existed both operators were unobservable.
 */
import { describe, expect, it } from "vitest";
import type { DcaBlock, SnapshotAnchor } from "../projection/contract.ts";
import { composeFillPathPage, type SpotReading } from "./fill-path-view.ts";

const PLAN_ID = "11111111-2222-4333-8444-555555555555";
const LIVE = (priceUsd: number): SpotReading => ({ status: "live", priceUsd });
const DARK: SpotReading = { status: "unavailable" };

function anchorWith(dca: DcaBlock, asOf = "2026-08-11"): SnapshotAnchor {
  return { fundId: "test-fund", asOf, report: { dca } } as SnapshotAnchor;
}

/**
 * DAY ZERO, SYNTHESIZED — the shape the live fund is actually in (eight rungs, orders
 * resting, nothing recorded) with amounts and levels invented here. The three measured
 * figures are ABSENT, which is the whole point: a `$0` is not reachable from this input.
 */
const DAY_ZERO: DcaBlock = {
  source: "loaded",
  unattributable: 0,
  tornActs: 0,
  positions: [
    {
      positionId: "synthetic-position-1",
      state: "pending",
      kind: "dcaLadder",
      planId: PLAN_ID,
      rungs: [
        60_000, 58_000, 56_000, 54_000, 50_000, 48_000, 46_000, 44_000,
      ].map((priceUsd, index) => ({
        id: `rung-${index + 1}`,
        priceUsd,
        sizeUsd: 250,
        venueAxis: "resting" as const,
        bookAxis: "not-recorded" as const,
        label: "waiting",
        joinProvenance: "declared" as const,
        placedQuantity: 1,
        venueConsumedQuantity: 0,
        bookedQuantity: 0,
        venueFilledFraction: 0,
        resting: true,
      })),
      figures: { waitingDeclaredUsd: 2_000, waitingRestingUsd: 2_000 },
    },
  ],
};

/** The `ok` arm or an explicit failure — keeps every test below one line shorter. */
function ok(dca: DcaBlock, spot: SpotReading = DARK, asOf = "2026-08-11") {
  const page = composeFillPathPage(anchorWith(dca, asOf), PLAN_ID, spot);
  if (page.status !== "ok") throw new Error(`expected ok, got ${page.status}`);
  return page.view;
}

describe("composeFillPathPage — resolving one ladder out of the roster", () => {
  it("resolves the row carrying the requested planId", () => {
    const view = ok(DAY_ZERO);
    expect(view.planId).toBe(PLAN_ID);
    expect(view.positionId).toBe("synthetic-position-1");
    expect(view.rungs).toHaveLength(8);
  });

  it("renders an honest NOT-FOUND for a well-formed id no row carries", () => {
    const page = composeFillPathPage(
      anchorWith(DAY_ZERO),
      "99999999-8888-4777-8666-555555555555",
      DARK,
    );
    expect(page.status).toBe("not-found");
    if (page.status !== "not-found") throw new Error("unreachable");
    expect(page.why).toMatch(/no ladder/i);
  });

  it("names a MALFORMED id as its own cause — not the same absence as unknown", () => {
    // The parameter is a UUID reached by tapping the card, never typed. A value that is
    // not even UUID-shaped did not come from the card, and saying so is more useful
    // than "no such ladder".
    const page = composeFillPathPage(anchorWith(DAY_ZERO), "dca-plan-a1", DARK);
    expect(page.status).toBe("not-found");
    if (page.status !== "not-found") throw new Error("unreachable");
    expect(page.why).toMatch(/not a plan id/i);
  });

  it("gives a dcaTime plan a plain statement instead of an empty ladder", () => {
    const page = composeFillPathPage(
      anchorWith({
        source: "loaded",
        unattributable: 0,
        positions: [
          { positionId: "p", state: "active", kind: "dcaTime", planId: PLAN_ID },
        ],
      }),
      PLAN_ID,
      DARK,
    );
    expect(page.status).toBe("no-price-axis");
  });

  it("never renders the plan id as a name anywhere in the view", () => {
    // A UUID is a join key. Nothing on the page labels the ladder with it, so no
    // meaning — venue, tier, date — can accrete in the id.
    const view = ok(DAY_ZERO);
    expect(view.title).not.toContain(PLAN_ID);
  });
});

describe("the five absence rules", () => {
  it("reads a rung with no order joined as declared-but-not-placed", () => {
    // RULE 1. The rung carries `{id, priceUsd, sizeUsd}` and nothing else; that absence
    // IS the state. A missing `venueConsumedQuantity` is NOT a zero fill.
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.rungs![7] = { id: "rung-8", priceUsd: 44_000, sizeUsd: 250 };
    const rung = ok(dca).rungs.find((r) => r.priceUsd === 44_000)!;
    expect(rung.notPlaced).toBe(true);
    expect(rung.label).toBe("declared — not placed");
    expect(rung.filledPercent).toBeUndefined();
    expect(rung.resting).toBe(false);
    // AND NOT FILLED. `venueAxis` is optional on this contract, so `filled` has an
    // undefined arm, and this is it: the absence rule 1 rung. Reading a missing axis as
    // anything but `false` would tint the row, solidify the path's segment and light the
    // `Filled` legend entry for a rung no order ever joined.
    expect(rung.filled).toBe(false);
  });

  it("decides `filled` off the venue's own statement, once, for every consumer", () => {
    // THE PREDICATE HAS ONE AUTHORING SITE (spec #302 slice A). The chart's path split,
    // its dots, the legend, the `is-filled` row tint and the progress count all read this
    // field; `venueAxis === "filled"` used to be spelled at each of them.
    const dca = structuredClone(DAY_ZERO);
    Object.assign(dca.positions[0]!.rungs![0]!, {
      venueAxis: "filled",
      label: "filled",
      venueConsumedQuantity: 1,
      venueFilledFraction: 1,
      resting: false,
    });
    // A PARTLY-FILLED RUNG IS NOT FILLED. Only the literal says yes: the path's solid
    // segment stops at a rung the venue has finished, and "some of it" is still waiting.
    Object.assign(dca.positions[0]!.rungs![1]!, {
      venueAxis: "partly-filled",
      label: "partly filled · 40%",
      venueConsumedQuantity: 0.4,
      venueFilledFraction: 0.4,
    });
    const view = ok(dca);
    expect(view.rungs.map((rung) => rung.filled)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    // The same field is what the progress count and the chart's circles are derived
    // from, so none of the three can disagree about which rung filled.
    expect(view.progress).toEqual({
      filledRungs: 1,
      totalRungs: 8,
      percent: 13,
    });
    expect(view.chart!.circles.map((circle) => circle.filled)).toEqual(
      view.rungs.map((rung) => rung.filled),
    );
  });

  it("tells an unreadable sidecar apart from a ladder that simply has no fills", () => {
    // RULE 2. `figures` present means a reconciliation RAN; absent means it could not.
    // "Nothing is placed" and "we could not look" are different renders.
    const withFigures = ok(DAY_ZERO);
    expect(withFigures.reconciled).toBe(true);
    expect(withFigures.deployed.known).toBe(false);
    if (withFigures.deployed.known) throw new Error("unreachable");
    expect(withFigures.deployed.why).toMatch(/no fill recorded/i);

    const dca = structuredClone(DAY_ZERO);
    delete dca.positions[0]!.figures;
    const unreconciled = ok(dca);
    expect(unreconciled.reconciled).toBe(false);
    if (unreconciled.deployed.known) throw new Error("unreachable");
    expect(unreconciled.deployed.why).toMatch(/could not be read/i);
    expect(unreconciled.deployed.why).not.toMatch(/no fill recorded/i);
  });

  it("an absent torn count never renders the all-clear", () => {
    // RULE 3. `0` is "checked, none outstanding"; ABSENT is "this row could not check".
    expect(ok(DAY_ZERO).tornActs).toEqual({ status: "clear" });

    const dca = structuredClone(DAY_ZERO);
    delete dca.tornActs;
    expect(ok(dca).tornActs).toEqual({ status: "unchecked" });

    const torn = structuredClone(DAY_ZERO);
    torn.tornActs = 2;
    expect(ok(torn).tornActs).toEqual({ status: "outstanding", count: 2 });
  });

  it("renders the three measured figures as ABSENT — a $0 is not reachable", () => {
    // RULE 4. The fields cannot be zero by construction, so the surface has no path to
    // a zero: there is no number to render, only a cause.
    const view = ok(DAY_ZERO);
    for (const figure of [view.deployed, view.unitsAcquired, view.avgEntry]) {
      expect(figure.known).toBe(false);
    }
    // And when they ARE present they pass through untouched.
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.figures = {
      deployedUsd: 500,
      unitsAcquired: 0.0092,
      avgEntryUsd: 54_347.83,
      waitingDeclaredUsd: 1_500,
      waitingRestingUsd: 1_500,
    };
    const filled = ok(dca);
    expect(filled.deployed).toEqual({ known: true, value: 500 });
    expect(filled.avgEntry).toEqual({ known: true, value: 54_347.83 });
  });

  it("an absent orphan count is zero, not unknown — the opposite convention", () => {
    // RULE 5. `orphanLots` sits beside `figures`, whose presence already says a
    // reconciliation ran, so absence there reads unambiguously as "none".
    expect(ok(DAY_ZERO).orphanLots).toBe(0);
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.orphanLots = 3;
    expect(ok(dca).orphanLots).toBe(3);
  });

  it("carries rule 2 all the way to the WAITING figures, which are not zero either", () => {
    // RULE 2 AGAIN, one field over, and the place it used to be inverted. `figures`
    // absent means the sidecar could not be read. The two waiting totals used to read
    // that as `0`, so the card printed `Waiting $0.00` beside an affirmative all-clear
    // on the ONE row that says it could not check.
    const dca = structuredClone(DAY_ZERO);
    delete dca.positions[0]!.figures;
    const view = ok(dca);

    expect(view.reconciled).toBe(false);
    expect(view.figures).toBeUndefined();
    // And rule 5's coercion cannot outlive rule 2 either: absence there is unambiguous
    // only BECAUSE `figures` is present to say a reconciliation ran.
    expect(view.orphanLots).toBeUndefined();
  });

  it("keeps the waiting figures present at zero when a reconciliation DID run", () => {
    // The mirror image, and the reason this is not a fourth "absent, never zero" field:
    // zero waiting capital is a real, measured answer.
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.figures = { waitingDeclaredUsd: 0, waitingRestingUsd: 0 };
    const view = ok(dca);

    expect(view.figures).toEqual({
      waitingDeclaredUsd: 0,
      waitingRestingUsd: 0,
      neverPlacedUsd: 0,
      split: "nothing-waiting",
    });
    expect(view.orphanLots).toBe(0);
  });
});

/**
 * THREE STATES NEED THREE SENTENCES. The component used to have two: `neverPlacedUsd > 0`
 * and an `else` reading "All of it is resting at the venue" — which a fully-walked ladder,
 * with nothing waiting and nothing resting, printed beside `$0.00`.
 */
describe("the waiting split says which of three things is true", () => {
  function withWaiting(waitingDeclaredUsd: number, waitingRestingUsd: number) {
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.figures = { waitingDeclaredUsd, waitingRestingUsd };
    return ok(dca).figures;
  }

  it("says NOTHING IS WAITING when the ladder is fully walked", () => {
    expect(withWaiting(0, 0)?.split).toBe("nothing-waiting");
  });

  it("says ALL RESTING only when there is something resting to say it about", () => {
    expect(withWaiting(2_000, 2_000)?.split).toBe("all-resting");
  });

  it("says PARTLY UNPLACED when the two totals disagree — the hidden encumbrance", () => {
    const figures = withWaiting(2_000, 750);
    expect(figures?.split).toBe("partly-unplaced");
    expect(figures?.neverPlacedUsd).toBe(1_250);
  });
});

describe("the two spot-dependent decorations — and nothing else moves with price", () => {
  it("marks the next rung price would reach on the way DOWN", () => {
    const view = ok(DAY_ZERO, LIVE(55_000));
    const next = view.rungs.filter((rung) => rung.isNext);
    expect(next).toHaveLength(1);
    // Spot at 55,000: the rungs at 60/58/56k are already above it; 54,000 is the first
    // one a falling price meets.
    expect(next[0]!.priceUsd).toBe(54_000);
  });

  it("decides the rung sitting EXACTLY at spot: passed, and not next", () => {
    // BOTH COMPARISONS ARE STRICT AT THE BOUNDARY, and nothing else in this suite puts
    // a rung there — every other reading sits between rungs, so `<` relaxed to `<=` and
    // `>=` relaxed to `>` were both unobservable. A rung at spot must be exactly one of
    // the two states, and this is the fixture that says which.
    const view = ok(DAY_ZERO, LIVE(54_000));
    const atSpot = view.rungs.find((rung) => rung.priceUsd === 54_000)!;

    expect(atSpot.pricePassedUnconfirmed).toBe(true);
    expect(atSpot.isNext).toBe(false);
    // The next rung a FALLING price meets is the first one strictly below it.
    expect(view.rungs.filter((rung) => rung.isNext).map((rung) => rung.priceUsd)).toEqual([
      50_000,
    ]);
  });

  it("marks NO next rung when price has fallen past the whole ladder", () => {
    expect(ok(DAY_ZERO, LIVE(40_000)).rungs.some((rung) => rung.isNext)).toBe(false);
  });

  it("flags a resting rung price has already passed as unconfirmed", () => {
    const view = ok(DAY_ZERO, LIVE(55_000));
    const passed = view.rungs.filter((rung) => rung.pricePassedUnconfirmed);
    expect(passed.map((rung) => rung.priceUsd)).toEqual([60_000, 58_000, 56_000]);
    expect(view.warnings.pricePassedNoFill).toBe(3);
  });

  it("does not claim a never-placed rung was passed unconfirmed", () => {
    // There is no resting order to be unconfirmed ABOUT. The rung is simply not placed,
    // which the pill already says, and a second warning would invent a call to action.
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.rungs![0] = { id: "rung-1", priceUsd: 60_000, sizeUsd: 250 };
    const view = ok(dca, LIVE(55_000));
    expect(view.rungs.find((r) => r.priceUsd === 60_000)!.pricePassedUnconfirmed).toBe(
      false,
    );
    expect(view.warnings.pricePassedNoFill).toBe(2);
  });

  it("drops BOTH decorations when spot is unavailable, and says so", () => {
    // Every spot-independent fact still renders — this is a labeled state, not a broken
    // page.
    const view = ok(DAY_ZERO, DARK);
    expect(view.rungs.some((rung) => rung.isNext)).toBe(false);
    expect(view.rungs.some((rung) => rung.pricePassedUnconfirmed)).toBe(false);
    expect(view.spotUnavailable).toBe(true);
    expect(view.rungs).toHaveLength(8);
    expect(view.figures?.waitingDeclaredUsd).toBe(2_000);
  });

  it("degrades to the last close it was given, still labeled unavailable", () => {
    const view = ok(DAY_ZERO, { status: "unavailable", lastCloseUsd: 55_000 });
    expect(view.spotUnavailable).toBe(true);
    expect(view.spotUsd).toBe(55_000);
    // A last close is a stale number, not a live one: it must not drive a marker that
    // claims to know where price is NOW.
    expect(view.rungs.some((rung) => rung.isNext)).toBe(false);
  });
});

describe("the pills, the warnings and the banners", () => {
  it("carries the wire's own label through — the phone and the desk say one thing", () => {
    expect(ok(DAY_ZERO).rungs[0]!.label).toBe("waiting");
  });

  it("counts a venue fill with no recorded lot as the certain warning", () => {
    const dca = structuredClone(DAY_ZERO);
    Object.assign(dca.positions[0]!.rungs![0]!, {
      venueAxis: "filled",
      bookAxis: "not-recorded",
      label: "filled at venue — not recorded",
      venueConsumedQuantity: 1,
      venueFilledFraction: 1,
      resting: false,
    });
    const view = ok(dca, LIVE(55_000));
    expect(view.warnings.filledNotRecorded).toBe(1);
    expect(view.rungs[0]!.filledAtVenueNotRecorded).toBe(true);
    // The two warnings are DIFFERENT CERTAINTIES and are counted apart: this one is a
    // fact from the venue, the other is inferred from spot.
    expect(view.warnings.pricePassedNoFill).toBe(2);
  });

  it("carries the measured partly-filled percentage, never a guess", () => {
    const dca = structuredClone(DAY_ZERO);
    Object.assign(dca.positions[0]!.rungs![0]!, {
      venueAxis: "partly-filled",
      label: "partly filled · 40%",
      venueConsumedQuantity: 0.4,
      venueFilledFraction: 0.4,
    });
    expect(ok(dca).rungs[0]!.filledPercent).toBe(40);
  });

  it("flags an inferred join so the surface shows its own confidence", () => {
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.rungs![0]!.joinProvenance = "price-matched";
    const view = ok(dca);
    expect(view.rungs[0]!.matchedByPrice).toBe(true);
    expect(view.rungs[1]!.matchedByPrice).toBe(false);
  });

  it("carries a declared join whose order price differs, with the price placed", () => {
    const dca = structuredClone(DAY_ZERO);
    Object.assign(dca.positions[0]!.rungs![0]!, {
      declaredPriceMismatch: true,
      orderPriceUsd: 59_500,
    });
    expect(ok(dca).rungs[0]!.placedAtUsd).toBe(59_500);
  });

  it("splits waiting capital on never-placed rungs — the only thing that splits it", () => {
    // `waitingRestingUsd` and `waitingDeclaredUsd` differ ONLY on rungs with no order:
    // for any rung that HAS one, resting and unfilled are the same predicate by
    // construction. The sub-line is therefore "declared but never placed".
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.figures = { waitingDeclaredUsd: 2_000, waitingRestingUsd: 1_750 };
    const view = ok(dca);
    expect(view.figures?.neverPlacedUsd).toBe(250);
    expect(view.figures?.waitingRestingUsd).toBe(1_750);
  });
});

describe("the chart, its caption, and the provenance footer", () => {
  it("plots one circle per rung and a polyline over the same points", () => {
    const chart = ok(DAY_ZERO, LIVE(55_000)).chart!;
    expect(chart.circles).toHaveLength(8);
    expect(chart.points.split(" ")).toHaveLength(8);
    // The "now" line lands between the 56,000 and 54,000 circles, because that is where
    // spot sits in the price domain.
    const at56 = chart.circles.find((c) => c.key === "rung-3")!;
    const at54 = chart.circles.find((c) => c.key === "rung-4")!;
    expect(chart.nowX).toBeGreaterThan(at56.cx);
    expect(chart.nowX).toBeLessThan(at54.cx);
  });

  it("draws no now-line at all when spot is not live", () => {
    expect(ok(DAY_ZERO, DARK).chart!.nowX).toBeUndefined();
  });

  it("keeps spot inside the drawn price range so the now-line is never off-canvas", () => {
    const chart = ok(DAY_ZERO, LIVE(70_000)).chart!;
    expect(chart.nowX).toBeGreaterThanOrEqual(0);
    expect(chart.nowX).toBeLessThanOrEqual(chart.width);
  });

  it("has NO chart for a v4 ladder, whose rungs carry no sizes to plot", () => {
    const dca = structuredClone(DAY_ZERO);
    dca.positions[0]!.rungs = dca.positions[0]!.rungs!.map((rung) => ({
      priceUsd: rung.priceUsd,
    }));
    delete dca.positions[0]!.figures;
    const view = ok(dca);
    expect(view.chart).toBeUndefined();
    expect(view.caption).toBeUndefined();
    // But every price still renders — a v4 row is READABLE, not broken.
    expect(view.rungs).toHaveLength(8);
  });

  it("generates the convexity caption from the same view model", () => {
    const dca = structuredClone(DAY_ZERO);
    const sizes = [300, 350, 400, 450, 550, 650, 800, 1_100];
    dca.positions[0]!.rungs!.forEach((rung, index) => {
      rung.sizeUsd = sizes[index]!;
    });
    dca.positions[0]!.figures = { waitingDeclaredUsd: 4_600, waitingRestingUsd: 4_600 };
    expect(ok(dca).caption).toContain("the deepest rung is 3.7× the first");
  });

  it("derives fills-recorded-through from the ANCHOR's own as-of — no clock", () => {
    // The boundary of what this row could have known. Not a clock, not a wire date (the
    // `dca` branch carries none, deliberately), not a fill timestamp.
    expect(ok(DAY_ZERO, DARK, "2026-08-11").recordedThrough).toBe("2026-08-11");
    expect(ok(DAY_ZERO, DARK, "2026-06-26").recordedThrough).toBe("2026-06-26");
  });

  it("reports progress as rungs walked — zero on day zero, and that is the truth", () => {
    const view = ok(DAY_ZERO);
    expect(view.progress).toEqual({ filledRungs: 0, totalRungs: 8, percent: 0 });
  });
});

/**
 * THE DAY-ZERO PROJECTION — what the declared ladder would acquire, offered ONLY while
 * there is nothing measured to offer instead.
 *
 * EVERY NUMBER BELOW IS HAND-AUTHORED and every expectation is computed by hand in the
 * comment beside it. Nothing here is seeded from the dev fixture or from any real run.
 *
 * THE SECOND HALF OF THIS BLOCK IS THE ONLY COVERAGE THE "SOMETHING FILLED" LAYOUT HAS.
 * The dev fixture has zero filled rungs, so a browser can only ever exercise the day-zero
 * path; that the card REVERTS the moment a fill exists is asserted here or nowhere.
 */
describe("the expected figures", () => {
  /**
   * A DELIBERATELY CONVEX TWO-RUNG LADDER, chosen so the right answer is distinguishable
   * from both wrong ones:
   *   $200 at $40,000 → 0.005 units      $600 at $20,000 → 0.030 units
   *   total $800, total 0.035 units      →  800 / 0.035 = $22,857.14…
   * The arithmetic mean of the PRICES is $30,000 and the size-weighted arithmetic mean is
   * $25,000. Neither is the entry this ladder is aiming at.
   */
  const CONVEX: DcaBlock = {
    source: "loaded",
    unattributable: 0,
    tornActs: 0,
    positions: [
      {
        positionId: "synthetic-position-2",
        state: "pending",
        kind: "dcaLadder",
        planId: PLAN_ID,
        rungs: [
          { id: "rung-1", priceUsd: 40_000, sizeUsd: 200 },
          { id: "rung-2", priceUsd: 20_000, sizeUsd: 600 },
        ],
        figures: { waitingDeclaredUsd: 800, waitingRestingUsd: 800 },
      },
    ],
  };

  it("projects units and a SIZE-WEIGHTED HARMONIC average entry, not a mean of prices", () => {
    const view = ok(CONVEX);
    expect(view.notStarted).toBe(true);
    expect(view.expected).toBeDefined();
    expect(view.expected!.units).toBeCloseTo(0.035, 12);
    expect(view.expected!.avgEntryUsd).toBeCloseTo(22_857.142857142855, 6);
    // The two numbers the convexity makes wrong, named so the guard cannot pass by
    // accident: the mean of the prices, and the size-weighted mean of the prices.
    expect(view.expected!.avgEntryUsd).not.toBeCloseTo(30_000, 0);
    expect(view.expected!.avgEntryUsd).not.toBeCloseTo(25_000, 0);
  });

  it("keeps the TWO no-figures absences apart — an unread sidecar gets no projection", () => {
    // Absence rule 2. `figures` absent means nothing could be CHECKED, which is NOT
    // "this ladder has not started": it may be fully walked for all this row knows.
    // Projecting here would print a confident number on the one row that says it could
    // not look, so `notStarted` is false and there is no expectation at all.
    const dca = structuredClone(CONVEX);
    delete dca.positions[0]!.figures;
    const view = ok(dca);
    expect(view.reconciled).toBe(false);
    expect(view.notStarted).toBe(false);
    expect(view.expected).toBeUndefined();
  });

  it("withdraws the projection the moment anything is measured", () => {
    // THE REVERTED-TO-TODAY PATH. Once a fill exists the measured figures are the
    // answer, and an expectation beside them would compete with a measurement.
    const dca = structuredClone(CONVEX);
    dca.positions[0]!.figures = {
      deployedUsd: 200,
      unitsAcquired: 0.005,
      avgEntryUsd: 40_000,
      waitingDeclaredUsd: 600,
      waitingRestingUsd: 600,
    };
    const view = ok(dca);
    expect(view.notStarted).toBe(false);
    expect(view.expected).toBeUndefined();
    expect(view.deployed).toEqual({ known: true, value: 200 });
  });

  it("does not call a ladder unstarted off a HALF-populated figures block", () => {
    // All three measured figures move together by construction. One of them present is
    // not day zero — it is a row this module has no coherent reading of, and the last
    // thing it should do is stand a projection beside the one real measurement.
    const dca = structuredClone(CONVEX);
    dca.positions[0]!.figures = {
      deployedUsd: 200,
      waitingDeclaredUsd: 600,
      waitingRestingUsd: 600,
    };
    const view = ok(dca);
    expect(view.notStarted).toBe(false);
    expect(view.expected).toBeUndefined();
  });

  it("refuses to project when a rung declares no size — absent, never partial", () => {
    // A v4 rung carries no `sizeUsd`. Summing the rest would state an expectation for a
    // ladder half of whose capital is unaccounted for, which is worse than saying
    // nothing — the same refusal `chartFor` makes about the same absence.
    const dca = structuredClone(CONVEX);
    delete dca.positions[0]!.rungs![1]!.sizeUsd;
    const view = ok(dca);
    expect(view.notStarted).toBe(true);
    expect(view.expected).toBeUndefined();
  });

  it("projects the live-shaped eight-rung day-zero ladder too", () => {
    // DAY_ZERO is eight rungs of $250. Every rung's units are 250/price, so the check
    // that matters is that the average lands strictly INSIDE the price range and below
    // the mean of the prices — the ladder is flat-sized here, and even that is convex.
    const view = ok(DAY_ZERO);
    expect(view.notStarted).toBe(true);
    expect(view.expected).toBeDefined();
    const prices = [60_000, 58_000, 56_000, 54_000, 50_000, 48_000, 46_000, 44_000];
    const units = prices.reduce((sum, price) => sum + 250 / price, 0);
    expect(view.expected!.units).toBeCloseTo(units, 12);
    expect(view.expected!.avgEntryUsd).toBeCloseTo(2_000 / units, 6);
    const arithmetic = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    expect(view.expected!.avgEntryUsd).toBeLessThan(arithmetic);
    expect(view.expected!.avgEntryUsd).toBeGreaterThan(44_000);
  });
});

describe("purity", () => {
  it("mutates nothing the loader owns, and repeats itself exactly", () => {
    const block = structuredClone(DAY_ZERO);
    const once = composeFillPathPage(anchorWith(block), PLAN_ID, LIVE(55_000));
    const twice = composeFillPathPage(anchorWith(block), PLAN_ID, LIVE(55_000));
    expect(once).toEqual(twice);
    expect(block).toEqual(DAY_ZERO);
  });

  it("sorts rungs DESCENDING by price without reordering the wire's array", () => {
    const block = structuredClone(DAY_ZERO);
    block.positions[0]!.rungs!.reverse();
    const view = ok(block, DARK);
    expect(view.rungs.map((rung) => rung.priceUsd)).toEqual([
      60_000, 58_000, 56_000, 54_000, 50_000, 48_000, 46_000, 44_000,
    ]);
    expect(block.positions[0]!.rungs![0]!.priceUsd).toBe(44_000);
  });
});
