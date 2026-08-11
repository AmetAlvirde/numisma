/**
 * Fixture synthesis (PRD #146 slice #149) — the sanitizer that stands between the
 * real fund's folded anchors and the file this PUBLIC repository checks in.
 *
 * TWO CLAIMS ARE UNDER TEST AND THEY PULL IN OPPOSITE DIRECTIONS.
 *
 *  1. IT PRESERVES EVERYTHING SLICE 4 REPLAYS — every anchor date, the `glance`
 *     block verbatim, the Reserve row's `percentOfFund`, the day-over-day NAV
 *     percentage, and the structural shape down to which rows genuinely lack a cost
 *     basis. A sanitizer that quietly moved one of those would hand slice 4 a
 *     verdict history that never happened.
 *  2. IT PRESERVES NO MAGNITUDE — not NAV, not a row's `usdValue`, `costBasisUsd`,
 *     `unrealizedPnlUsd`, nor any `percentOfFund` other than Reserve's. The input
 *     here carries deliberately recognisable values (1000, 500, 400 …) so a
 *     magnitude that survived would be visible rather than inferred.
 *
 * The input is CONSTRUCTED, not the real fold, so this file runs on every machine —
 * and it mirrors the real report's awkward parts on purpose: a pinned Reserve row
 * mid-section, rows with no cost basis at all, a row with a cost basis and no P&L,
 * rows where `usd - cost == pnl` holds and rows where it does not, and a section
 * that covers only part of the fund.
 */
import { describe, expect, it } from "vitest";
import type { CompositionRow } from "@numisma/engine";
import type { SnapshotAnchor } from "../projection/contract.ts";
import {
  SYNTHETIC_PLAN_ID_PREFIX,
  NAV_JITTER_PP,
  NAV_MOVE_THRESHOLD_PCT,
  synthesizeAnchors,
  SYNTHETIC_FUND_ID,
  SYNTHETIC_FUND_NAME,
  SYNTHETIC_POSITION_PREFIX,
  SYNTHETIC_START_NAV,
} from "./fixture-synthesis.ts";

/**
 * The DCA branch of the constructed input. Deliberately recognisable rung prices —
 * 1000 / 900 / 800, the same trick the row magnitudes use — so a price that survived
 * synthesis is VISIBLE in the assertion rather than inferred from a distribution. One
 * row of every arm, so the sweep covers a ladder, a rungless `dcaTime` plan and the
 * two conclusion-only arms.
 */
const DCA = {
  source: "loaded" as const,
  positions: [
    {
      positionId: "capital-x-btc",
      state: "pending" as const,
      kind: "dcaLadder" as const,
      rungs: [{ priceUsd: 1000 }, { priceUsd: 900 }, { priceUsd: 800 }],
    },
    { positionId: "capital-x-eth", state: "active" as const, kind: "dcaTime" as const },
    { positionId: "capital-x-old", state: "ended" as const },
    { positionId: "capital-x-bad", state: "unreadable" as const },
  ],
  unattributable: 2,
};

const GLANCE = {
  reserveTargetPct: 10,
  feedGap: {
    expected: 13,
    arrived: 9,
    missing: [{ rowId: "instrument:btc", label: "BTC (Bitcoin)" }],
  },
  suppressed: ["summary.fundValueUsd"],
};

/** One anchor at `nav`, with every awkward row shape the real report carries. */
function constructedAnchor(asOf: string, nav: number): SnapshotAnchor {
  const at = (pct: number): number => (pct / 100) * nav;
  const row = (
    id: string,
    kind: CompositionRow["kind"],
    pct: number,
    cost?: number,
    pnl?: number,
  ): CompositionRow => ({
    id,
    kind,
    label: id.toUpperCase(),
    usdValue: at(pct),
    percentOfFund: pct,
    ...(cost === undefined ? {} : { costBasisUsd: cost }),
    ...(pnl === undefined ? {} : { unrealizedPnlUsd: pnl }),
  });

  return {
    fundId: "test-fund",
    asOf,
    report: {
      totals: { baseCurrency: "USD", fundValueUsd: nav, usdMxn: 17.5 },
      dashboard: {
        summary: {
          fundName: "Real Fund Name",
          asOf,
          fundValueUsd: nav,
          usdMxn: 17.5,
          totalUnrealizedPnlUsd: at(10),
          largestTempo: {
            rowId: "tempo:Capital",
            kind: "tempo",
            label: "TEMPO:CAPITAL",
            usdValue: at(50),
            percentOfFund: 50,
          },
          reserve: {
            rowId: "tempo:Reserve",
            kind: "tempo",
            label: "TEMPO:RESERVE",
            usdValue: at(20),
            percentOfFund: 20,
          },
          dataSafety: {
            nonLiveExcluded: 0,
            invalidExcluded: 0,
            shortDeferredExcluded: 0,
            hasWarnings: false,
          },
        },
        sections: [
          {
            id: "portfolios",
            title: "Portfolio Composition",
            // Identity BROKEN: a whole-fund row mixes cash with positions.
            rows: [row("portfolio:p", "portfolio", 100, at(40), at(10))],
          },
          {
            id: "tempos",
            title: "Tempo Composition",
            rows: [
              // Identity HOLDS: 50 - 40 == 10.
              row("tempo:Capital", "tempo", 50, at(40), at(10)),
              row("tempo:Pulse", "tempo", 25, at(20), at(3)),
              // The PINNED row, mid-section, carrying no cost basis at all.
              row("tempo:Reserve", "tempo", 20),
              row("tempo:Foresight", "tempo", 5),
            ],
          },
          {
            id: "instruments",
            title: "Instrument Composition",
            // Four P&L rows, because the real instrument section has eleven: the
            // spread across them is what puts a row in the red.
            rows: [
              row("instrument:reserve", "instrument", 40),
              row("instrument:btc", "instrument", 25, at(20), at(5)),
              row("instrument:eth", "instrument", 20, at(16), at(4)),
              row("instrument:sol", "instrument", 10, at(8), at(2)),
              row("instrument:ada", "instrument", 5, at(4), at(1)),
            ],
          },
          {
            id: "tiers",
            title: "Capital Tier Composition",
            // Covers only part of the fund (70%), and c3 carries a cost basis with
            // NO P&L — the real report's shape, and spec open question 3.
            rows: [
              row("tier:c1", "tier", 50, at(40), at(10)),
              row("tier:c3", "tier", 20, at(20)),
            ],
          },
        ],
      },
      glance: structuredClone(GLANCE),
      dca: structuredClone(DCA),
    },
  } as SnapshotAnchor;
}

/**
 * The NAV every constructed input anchor starts at. ROUND AND OBVIOUSLY FICTIONAL, on
 * purpose: this literal used to be the fund's actual NAV on its first anchor, paired
 * in the same call with that anchor's actual date, in a file this PUBLIC repository
 * checks in. A magnitude is the one thing `fixture-synthesis.ts` exists to withhold,
 * and it does not stop being one because a TEST is what holds it — the module header
 * makes exactly this point about naming the firing moves in a comment.
 *
 * Nothing here reads the absolute value: the synthesizer re-anchors at
 * {@link SYNTHETIC_START_NAV} and carries the series forward on RATIOS, so the tests
 * assert over the moves between anchors and never over this number.
 *
 * It is 12345.67 rather than a rounder stand-in because the sweep below asserts that
 * NO input magnitude appears anywhere in the output, and a round input collides with
 * the synthetic side by construction: 20000 is also the pinned Reserve row's value at
 * 20% of {@link SYNTHETIC_START_NAV}, which fails the sweep on a coincidence rather
 * than on a leak. Fictional AND collision-free is the requirement, not just fictional.
 */
const CONSTRUCTED_NAV = 12_345.67;

/** Two anchors, the second 5% below the first — a day-over-day move to preserve. */
const REAL: SnapshotAnchor[] = [
  constructedAnchor("2026-06-26", CONSTRUCTED_NAV),
  constructedAnchor("2026-06-28", CONSTRUCTED_NAV * 0.95),
];

/** Every number reachable in a payload, for the "no magnitude survived" sweep. */
function numbersIn(value: unknown, found: number[] = []): number[] {
  if (typeof value === "number") found.push(value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, found);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) numbersIn(v, found);
  }
  return found;
}

/** The structural skeleton: everything except the numbers. */
function shapeOf(anchor: SnapshotAnchor): string {
  return anchor.report.dashboard.sections
    .map(
      (section) =>
        `${section.id}|${section.title}|` +
        section.rows
          .map(
            (row) =>
              `${row.id}:${row.kind}:${row.label}:` +
              `${"costBasisUsd" in row}:${"unrealizedPnlUsd" in row}`,
          )
          .join(","),
    )
    .join("//");
}

describe("what survives — the projections slice 4 replays", () => {
  const out = synthesizeAnchors(REAL);

  it("keeps every anchor date, in order", () => {
    expect(out.map((a) => a.asOf)).toEqual(REAL.map((a) => a.asOf));
  });

  it("copies the glance block VERBATIM — feedGap, missing[], suppressed, the floor", () => {
    // `feedGap` counts and `suppressed` keys ARE the outage triggers. They carry no
    // magnitude (D14 already forbids mark dates), so there is nothing to sanitize and
    // everything to lose by recomputing them.
    for (const anchor of out) {
      expect(anchor.report.glance).toEqual(GLANCE);
    }
    // …and it is a copy, not the same object: mutating the fixture must not reach
    // back into the derived payload the DB write also holds.
    out[0]!.report.glance.suppressed.push("mutated");
    expect(REAL[0]!.report.glance.suppressed).toEqual(["summary.fundValueUsd"]);
  });

  it("preserves the Reserve row's percentOfFund exactly — reserveFloor is a LEVEL test", () => {
    for (const [index, anchor] of out.entries()) {
      const real = REAL[index]!.report.dashboard.summary.reserve!;
      expect(anchor.report.dashboard.summary.reserve!.percentOfFund).toBe(
        real.percentOfFund,
      );
      const row = anchor.report.dashboard.sections
        .flatMap((s) => s.rows)
        .find((r) => r.id === real.rowId)!;
      // The section row and the summary reference must agree, or the floor test and
      // the rendered row would disagree about the same number.
      expect(row.percentOfFund).toBe(real.percentOfFund);
    }
  });

  it("preserves the day-over-day NAV percentage TO WITHIN THE JITTER — navMove is a PERCENT test", () => {
    // NO LONGER EXACT, AND THE INEXACTNESS IS THE SANITIZATION. An exactly-preserved
    // series is the real series up to one unknown factor, and three real NAVs are
    // already published, so division recovered it. `NAV_JITTER_PP` breaks that;
    // `navMove` survives because it is a threshold test with far more headroom than
    // ±0.05pp. Do not "tighten" this back to an exact comparison.
    const realPct =
      (REAL[1]!.report.totals.fundValueUsd / REAL[0]!.report.totals.fundValueUsd -
        1) *
      100;
    const synthPct =
      (out[1]!.report.totals.fundValueUsd / out[0]!.report.totals.fundValueUsd - 1) *
      100;
    expect(realPct).toBeCloseTo(-5, 10);
    expect(Math.abs(synthPct - realPct)).toBeLessThanOrEqual(NAV_JITTER_PP);
    // …and it is genuinely displaced, not accidentally exact — otherwise the leak is
    // still open on this pair and nothing here would say so.
    expect(synthPct).not.toBe(realPct);
  });

  it("preserves the structural shape, INCLUDING which rows genuinely lack a cost basis", () => {
    // Spec open question 3: slice 5 renders per-row cost basis, so an absence has to
    // be a real absence. A synthesizer that helpfully filled them in would make slice
    // 5 green against a shape the real fold never produces.
    for (const [index, anchor] of out.entries()) {
      expect(shapeOf(anchor)).toBe(shapeOf(REAL[index]!));
    }
    const tempos = out[0]!.report.dashboard.sections.find((s) => s.id === "tempos")!;
    expect(Object.keys(tempos.rows[2]!)).toEqual(["id", "kind", "label", "usdValue", "percentOfFund"]);
    const tiers = out[0]!.report.dashboard.sections.find((s) => s.id === "tiers")!;
    expect(tiers.rows[1]).not.toHaveProperty("unrealizedPnlUsd");
    expect(tiers.rows[1]).toHaveProperty("costBasisUsd");
  });

  it("keeps the dca branch's STATES and COUNTS verbatim — the card renders them", () => {
    // Same reasoning that copies the glance block: a `state`, a `kind` and a count of
    // unreadable lines carry no magnitude, and they are exactly what the card shows.
    // The `positionId` is NOT in this set — it is asserted replaced, just below.
    for (const anchor of out) {
      const dca = anchor.report.dca;
      expect(dca.source).toBe(DCA.source);
      expect(dca.unattributable).toBe(DCA.unattributable);
      expect(dca.positions.map((p) => `${p.state}:${p.kind}`)).toEqual(
        DCA.positions.map((p) => `${p.state}:${"kind" in p ? p.kind : undefined}`),
      );
      // The position COUNT is shape: four plans in, four plans out.
      expect(dca.positions).toHaveLength(DCA.positions.length);
      // The rung COUNT is shape, not magnitude: an eight-rung ladder must stay one.
      expect(dca.positions.map((p) => p.rungs?.length)).toEqual([3, undefined, undefined, undefined]);
      // …and a rungless plan keeps NO rungs key, rather than gaining an empty array.
      expect("rungs" in dca.positions[1]!).toBe(false);
    }
    // A copy, not the same object — the derived payload the DB write holds must not
    // be reachable through the fixture. Mutated on its OWN synthesis, not on the
    // shared `out`: this used to push onto the array every later test reads, so the
    // pollution was invisible only because nothing downstream counted positions.
    const isolated = synthesizeAnchors(REAL);
    isolated[0]!.report.dca.positions.push({ positionId: "mutated", state: "ended" });
    expect(REAL[0]!.report.dca.positions).toHaveLength(DCA.positions.length);
  });

  it("REPLACES every positionId — an operator-authored id is not a code identifier", () => {
    // THE ASSERTION WHOSE ABSENCE LET A REAL ID SHIP. `positionId` was kept verbatim
    // under the repo's "code identifiers keep their literal names" policy, but that
    // policy is about names this REPOSITORY authors; a plan id is read out of the
    // private sidecar and its convention spells out venue, instrument and strategy.
    // One real id reached the public fixture that way (PR #282).
    const real = new Set(DCA.positions.map((position) => position.positionId));
    for (const anchor of out) {
      for (const position of anchor.report.dca.positions) {
        expect(real.has(position.positionId), `${position.positionId} survived`).toBe(false);
        expect(position.positionId).toMatch(
          new RegExp(`^${SYNTHETIC_POSITION_PREFIX}-\\d+$`),
        );
      }
      // Distinct plans stay distinct: the count is shape, and collapsing two ids
      // would silently change what the card renders.
      const ids = anchor.report.dca.positions.map((position) => position.positionId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("assigns positionIds over the SERIES, so one plan keeps one id across anchors", () => {
    // Per-anchor numbering would be deterministic too, and wrong: a plan that appears
    // on every anchor is ONE plan, and the card groups by id. This is the property
    // that makes the fixture still describe a history rather than N unrelated days.
    const perAnchor = out.map((anchor) =>
      anchor.report.dca.positions.map((position) => position.positionId).join(","),
    );
    expect(new Set(perAnchor).size).toBe(1);
    // …and the mapping follows first appearance, so it is readable rather than hashed.
    expect(out[0]!.report.dca.positions.map((position) => position.positionId)).toEqual([
      `${SYNTHETIC_POSITION_PREFIX}-1`,
      `${SYNTHETIC_POSITION_PREFIX}-2`,
      `${SYNTHETIC_POSITION_PREFIX}-3`,
      `${SYNTHETIC_POSITION_PREFIX}-4`,
    ]);
  });

  it("seeds the rung wobble from the SYNTHETIC id, not the real one", () => {
    // Otherwise the disclosure survives the rename: every committed rung price would
    // be a hash commitment to the private string, testable by anyone who guesses it,
    // and in a form no grep for the id would ever surface. Two series identical except
    // for their real ids must therefore produce identical rung prices.
    const rungsFor = (positionId: string): number[] => {
      const anchor = constructedAnchor("2026-06-26", CONSTRUCTED_NAV);
      anchor.report.dca = {
        source: "loaded",
        unattributable: 0,
        positions: [
          { positionId, state: "pending", kind: "dcaLadder", rungs: [{ priceUsd: 1000 }, { priceUsd: 900 }] },
        ],
      };
      return synthesizeAnchors([anchor])[0]!.report.dca.positions[0]!.rungs!.map(
        (rung) => rung.priceUsd,
      );
    };
    expect(rungsFor("dca-one-real-name")).toEqual(rungsFor("a-totally-different-id"));
  });

  it("INVENTS every rung price — a declared entry level is a magnitude", () => {
    // ADR-006 already observes that a rung price is the same shape as a stop level.
    // The public repo's bar is magnitudes-never, so the levels are generated and only
    // the ladder's count and descending ordering survive.
    const real = new Set(DCA.positions[0]!.rungs!.map((rung) => rung.priceUsd));
    for (const anchor of out) {
      const rungs = anchor.report.dca.positions[0]!.rungs!;
      for (const rung of rungs) {
        expect(real.has(rung.priceUsd), `rung ${rung.priceUsd} survived`).toBe(false);
      }
      expect(rungs.map((rung) => rung.priceUsd)).toEqual(
        [...rungs.map((rung) => rung.priceUsd)].sort((a, b) => b - a),
      );
    }
  });

  it("keeps every synthetic rung POSITIVE, however deep the ladder", () => {
    // THE ASSERTION WHOSE ABSENCE LET A REAL BUG SHIP. The step used to be LINEAR
    // (`1 - RUNG_STEP * index`), which reaches zero at rung 17 and goes negative after
    // it — so an 18-rung ladder would have published negative limit prices into a
    // PUBLIC fixture and the card would have rendered `-$200.14`. Neither of the two
    // assertions beside this one could see it: a negative tail is still strictly
    // descending, and it still carries over no real value. A price is a POSITIVE
    // magnitude and nothing said so.
    //
    // Twenty-four rungs is well past the depth the real sidecar declares today (8),
    // deliberately: the whole failure was that the generator was only ever exercised
    // at a depth where the bug is invisible.
    const deep = constructedAnchor("2026-06-26", CONSTRUCTED_NAV);
    deep.report.dca = {
      source: "loaded",
      unattributable: 0,
      positions: [
        {
          positionId: "capital-x-deep",
          state: "pending",
          kind: "dcaLadder",
          rungs: Array.from({ length: 24 }, (_unused, index) => ({ priceUsd: 500 - index })),
        },
      ],
    };
    const rungs = synthesizeAnchors([deep])[0]!.report.dca.positions[0]!.rungs!;
    expect(rungs).toHaveLength(24);
    for (const [index, rung] of rungs.entries()) {
      expect(rung.priceUsd, `rung ${index}`).toBeGreaterThan(0);
    }
    // …and still strictly descending all the way down, which is the property the
    // shallow case already had and the fix must not have bought positivity with.
    expect(rungs.map((rung) => rung.priceUsd)).toEqual(
      [...rungs.map((rung) => rung.priceUsd)].sort((a, b) => b - a),
    );
  });

  // ── The v5 fill state (spec #285, slice 3). The same two-bucket rule, applied to
  // the fields the Fill Path added: CONCLUSIONS survive, MAGNITUDES and IDENTIFIERS do
  // not, and absence survives as absence.
  //
  // MUTATION-CHECKED: `synthesizeRung`'s early return for a rung with no `venueAxis`
  // removed — the absence case goes red on the fill keys that appeared on a rung the
  // input said nothing about. And `synthesizeFigures`' `waitingDeclaredUsd` carried
  // over from the input instead of rebuilt — the magnitude case goes red naming the
  // real total. Both restored.
  describe("the v5 fill state", () => {
    /** An anchor whose one ladder is mid-walk: filled, partly filled, and untouched. */
    function walkedLadder(): SnapshotAnchor {
      const anchor = constructedAnchor("2026-06-26", CONSTRUCTED_NAV);
      anchor.report.dca = {
        source: "loaded",
        unattributable: 0,
        positions: [
          {
            positionId: "capital-x-btc",
            state: "active",
            kind: "dcaLadder",
            planId: "8ba4c1de-0f27-4a63-9c15-7e0d3b6a91cc",
            rungs: [
              {
                id: "operator-rung-a",
                priceUsd: 1000,
                venueAxis: "partly-filled",
                bookAxis: "recorded",
                label: "partly filled · 25%",
                joinProvenance: "declared",
                orderPriceUsd: 998,
                declaredPriceMismatch: true,
                placedQuantity: 40,
                venueConsumedQuantity: 10,
                bookedQuantity: 10,
                venueFilledFraction: 0.25,
                resting: true,
              },
              { id: "operator-rung-b", priceUsd: 900 },
            ],
            figures: {
              deployedUsd: 9_980,
              unitsAcquired: 10,
              avgEntryUsd: 998,
              waitingDeclaredUsd: 3_700,
              waitingRestingUsd: 1_850,
            },
            orphanLots: 3,
          },
        ],
      };
      return anchor;
    }

    const walked = synthesizeAnchors([walkedLadder()])[0]!.report.dca.positions[0]!;
    const real = walkedLadder().report.dca.positions[0]!;

    it("keeps every STATE and the measured FRACTION — the card renders them", () => {
      const rung = walked.rungs![0]!;
      expect(rung.venueAxis).toBe("partly-filled");
      expect(rung.bookAxis).toBe("recorded");
      expect(rung.label).toBe("partly filled · 25%");
      expect(rung.joinProvenance).toBe("declared");
      expect(rung.declaredPriceMismatch).toBe(true);
      expect(rung.resting).toBe(true);
      // A ratio discloses no size, and the preserved label already states it — an
      // invented fraction would make the file's own two fields disagree.
      expect(rung.venueFilledFraction).toBe(0.25);
      // A count, like `unattributable` beside it.
      expect(walked.orphanLots).toBe(3);
    });

    it("INVENTS every quantity, and keeps `consumed / placed` equal to the fraction", () => {
      const rung = walked.rungs![0]!;
      expect(rung.placedQuantity).not.toBe(real.rungs![0]!.placedQuantity);
      expect(rung.venueConsumedQuantity).not.toBe(real.rungs![0]!.venueConsumedQuantity);
      expect(rung.bookedQuantity).not.toBe(real.rungs![0]!.bookedQuantity);
      expect(rung.venueConsumedQuantity! / rung.placedQuantity!).toBeCloseTo(0.25, 9);
      // The mismatched order price is invented too, and derived from the ALREADY
      // synthetic rung price — while still landing off the declared level, which is
      // the only fact the mismatch flag makes.
      expect(rung.orderPriceUsd).not.toBe(998);
      expect(rung.orderPriceUsd).toBeLessThan(rung.priceUsd);
    });

    it("INVENTS every figure while preserving which ones are PRESENT", () => {
      expect(Object.keys(walked.figures!).sort()).toEqual(
        Object.keys(real.figures!).sort(),
      );
      for (const key of ["deployedUsd", "unitsAcquired", "avgEntryUsd", "waitingDeclaredUsd", "waitingRestingUsd"] as const) {
        expect(walked.figures![key], key).not.toBe(real.figures![key]);
      }
      // The waiting totals are sums of the declared `sizeUsd` the wire deliberately
      // never ships; carrying them over would publish it in aggregate.
      expect(walked.figures!.waitingDeclaredUsd).toBeGreaterThan(0);
    });

    it("keeps an ABSENT fill state absent — the day-zero rung stays day-zero", () => {
      // The load-bearing half. A synthesizer that manufactured a state here would make
      // the fixture claim a history the fund never had, and slice 4 would go green
      // against a shape the push does not emit on the day that actually matters.
      expect(Object.keys(walked.rungs![1]!).sort()).toEqual(["id", "priceUsd"]);
    });

    it("INVENTS the plan id and every rung id — both are minted in a private file", () => {
      expect(walked.planId).toMatch(new RegExp(`^${SYNTHETIC_PLAN_ID_PREFIX}\\d{12}$`));
      expect(walked.rungs!.map((rung) => rung.id)).toEqual(["rung-1", "rung-2"]);
    });

    it("gives one ladder ONE id across the series, and two ladders two", () => {
      // The route resolves on this key: a per-anchor renaming would turn one ladder
      // into twelve, and two superseding ladders sharing one id would resolve two
      // different declarations to the same page.
      const first = walkedLadder();
      const second = walkedLadder();
      second.asOf = "2026-06-28";
      second.report.dashboard.summary.asOf = "2026-06-28";
      const superseded = walkedLadder();
      superseded.asOf = "2026-06-30";
      superseded.report.dashboard.summary.asOf = "2026-06-30";
      superseded.report.dca.positions[0]!.planId = "0d4e77a2-51bc-4e88-b0f9-2a6c5d41e733";

      const series = synthesizeAnchors([first, second, superseded]);
      const ids = series.map((a) => a.report.dca.positions[0]!.planId);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[2]).not.toBe(ids[0]);
    });
  });

  it("keeps dataSafety and the FX rate — neither is a fund magnitude", () => {
    expect(out[0]!.report.dashboard.summary.dataSafety).toEqual(
      REAL[0]!.report.dashboard.summary.dataSafety,
    );
    expect(out[0]!.report.totals.usdMxn).toBe(17.5);
  });
});

describe("the NAV jitter — closing the last recoverable series", () => {
  /** A synthetic history whose day-over-day percent changes are exactly `pcts`. */
  function seriesWithMoves(pcts: readonly number[]): SnapshotAnchor[] {
    const anchors = [constructedAnchor("2026-06-26", CONSTRUCTED_NAV)];
    let nav = CONSTRUCTED_NAV;
    for (const [i, pct] of pcts.entries()) {
      nav *= 1 + pct / 100;
      const date = new Date("2026-06-26T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + i + 1);
      anchors.push(constructedAnchor(date.toISOString().slice(0, 10), nav));
    }
    return anchors;
  }

  const movesOf = (anchors: readonly SnapshotAnchor[]): number[] =>
    anchors
      .slice(1)
      .map(
        (a, i) =>
          (a.report.totals.fundValueUsd /
            anchors[i]!.report.totals.fundValueUsd -
            1) *
          100,
      );

  it("displaces every day-over-day change, by no more than the declared band", () => {
    // THE EXPOSURE THIS CLOSES. Exact percent preservation publishes the real NAV
    // series up to one factor, and issues #146/#149 publish three real NAVs, so the
    // factor divides out and the whole series unscales. Every change has to
    // MOVE, and by a bounded amount so no trigger changes its mind.
    const real = [0.4, -1.1, 2.3, -0.2, 0.9, -3.4];
    const out = movesOf(synthesizeAnchors(seriesWithMoves(real)));
    for (const [i, pct] of real.entries()) {
      expect(Math.abs(out[i]! - pct), `move ${i}`).toBeLessThanOrEqual(
        NAV_JITTER_PP,
      );
      expect(out[i], `move ${i}`).not.toBe(pct);
    }
  });

  it("is DETERMINISTIC — the same dates always draw the same offsets", () => {
    // `cmp` across two regenerations has to be clean, which means no clock and no
    // unseeded randomness anywhere in the offset. Two independent runs, byte-equal.
    const input = seriesWithMoves([0.4, -1.1, 2.3, -0.2]);
    expect(JSON.stringify(synthesizeAnchors(input))).toBe(
      JSON.stringify(synthesizeAnchors(input)),
    );
    // …and the offset is a function of the DATE, not of position in the array: the
    // same date reached through a different-length history draws the same move.
    const short = movesOf(synthesizeAnchors(seriesWithMoves([0.4, -1.1])));
    const long = movesOf(synthesizeAnchors(seriesWithMoves([0.4, -1.1, 2.3])));
    expect(short).toEqual(long.slice(0, short.length));
  });

  it("NEVER SILENTLY FLIPS a navMove verdict — it preserves the side or it throws", () => {
    // THE SAFETY PROPERTY, ASSERTED RATHER THAN ARGUED, and stated as the invariant
    // that is actually true. `navMove` is a threshold test and slice 4 replays a
    // measured verdict history; a move that crossed 1.5% under jitter would hand it a
    // history the fund never had. The generator holds the real change in hand, so
    // there are exactly two acceptable outcomes per anchor — same side, or a loud
    // throw. Swept in fine steps through the whole neighbourhood of the threshold, in
    // both signs, one anchor at a time so a throw isolates to its own move.
    for (let pct = -3; pct <= 3.0001; pct += 0.01) {
      const input = seriesWithMoves([Math.round(pct * 100) / 100]);
      // The reference side is read from the INPUT SERIES' own reconstructed move,
      // not from the nominal percentage that built it. At exactly 1.5% the round trip
      // through a NAV lands on 1.4999999999999998, which is genuinely below the
      // threshold — comparing against the nominal would fail the generator for a
      // float artifact of the test harness rather than a flip it caused.
      const real = movesOf(input)[0]!;
      let out: number[] | "threw";
      try {
        out = movesOf(synthesizeAnchors(input));
      } catch {
        out = "threw";
      }
      if (out === "threw") continue;
      expect(
        Math.abs(out[0]!) >= NAV_MOVE_THRESHOLD_PCT,
        `${real.toFixed(4)}% -> ${out[0]!.toFixed(4)}%`,
      ).toBe(Math.abs(real) >= NAV_MOVE_THRESHOLD_PCT);
    }
  });

  it("THROWS on the moves parked close enough to the threshold to be flipped", () => {
    // The guard has to be LIVE, not merely present: somewhere inside the jitter band
    // of the threshold there must be moves it refuses. Without this, the sweep above
    // would pass just as well against a generator that threw on everything or on
    // nothing.
    const inBand: boolean[] = [];
    for (let delta = -NAV_JITTER_PP; delta <= NAV_JITTER_PP; delta += 0.005) {
      try {
        synthesizeAnchors(seriesWithMoves([NAV_MOVE_THRESHOLD_PCT + delta]));
        inBand.push(false);
      } catch (error) {
        expect(String(error)).toMatch(/moved the navMove verdict/);
        inBand.push(true);
      }
    }
    expect(inBand.some(Boolean), "the guard never fired anywhere in the band").toBe(
      true,
    );
    // …and it does NOT fire away from the boundary, or every regeneration would fail.
    for (const move of [0, 0.5, -0.9, NAV_MOVE_THRESHOLD_PCT + 1, -3]) {
      expect(() => synthesizeAnchors(seriesWithMoves([move])), String(move)).not.toThrow();
    }
  });

  it("leaves the guard silent on an ordinary series — regeneration is not blocked", () => {
    // The statement of sufficiency, and it is a CONSTRUCTED series, not the fund's:
    // nothing in this file can read the real anchors (that is the whole point of
    // the sanitizer). The real series' sufficiency is asserted where the generator
    // actually holds it — `assertThresholdSideHolds` at regeneration time, which stops
    // with the date named if a future day's move lands inside the band.
    expect(() => synthesizeAnchors(REAL)).not.toThrow();
  });
});

describe("what does NOT survive — every magnitude, and the fund's identity", () => {
  const out = synthesizeAnchors(REAL);

  it("replaces the fund id — the real one never reaches the committed file", () => {
    // `fundName` has been fictional since slice #149, but every anchor still carried
    // the production `fund_id`, which named the fund in a PUBLIC repository just as
    // plainly as the name would have — and it did so once per anchor, every time.
    // Row ids and labels are a separate matter: those stay verbatim on purpose, so
    // this is the fund's IDENTITY being replaced, not the file being de-identified.
    for (const anchor of out) {
      expect(anchor.fundId).toBe(SYNTHETIC_FUND_ID);
    }
  });

  it("re-anchors the series at a round, obviously fictional NAV", () => {
    expect(out[0]!.report.totals.fundValueUsd).toBe(SYNTHETIC_START_NAV);
    expect(out[0]!.report.dashboard.summary.fundValueUsd).toBe(SYNTHETIC_START_NAV);
    expect(out[0]!.report.totals.fundValueUsd).not.toBe(
      REAL[0]!.report.totals.fundValueUsd,
    );
  });

  it("names an obviously fictional fund, the way the sibling fixture already does", () => {
    for (const anchor of out) {
      expect(anchor.report.dashboard.summary.fundName).toBe(SYNTHETIC_FUND_NAME);
    }
    expect(SYNTHETIC_FUND_NAME).not.toBe("Real Fund Name");
  });

  it("carries over NO input magnitude anywhere in the payload", () => {
    // The sweep, not a spot check: every number in the input that is a magnitude
    // (rather than a preserved ratio) must be absent from every output payload.
    // Preserved by design, and each one is a ratio, a count or the FX rate — never a
    // fund magnitude. `2` joins them as the dca branch's `unattributable` COUNT, which
    // is the same class of value as `feedGap`'s 13 and 9 beside it.
    const preserved = new Set([20, 100, 17.5, 13, 9, 10, 2, 0]);
    const inputs = new Set(
      numbersIn(REAL).filter((n) => n !== 0 && !preserved.has(n)),
    );
    const emitted = new Set(numbersIn(out));
    expect([...inputs].filter((n) => emitted.has(n))).toEqual([]);
    expect(inputs.size).toBeGreaterThan(10);
  });

  it("invents every percentOfFund EXCEPT the Reserve row's", () => {
    const tempos = out[0]!.report.dashboard.sections.find((s) => s.id === "tempos")!;
    expect(tempos.rows.map((r) => r.percentOfFund)).not.toEqual([50, 25, 20, 5]);
    expect(tempos.rows[2]!.percentOfFund).toBe(20);
    expect(tempos.rows[0]!.percentOfFund).not.toBe(50);
  });
});

describe("the synthetic rows are still internally consistent", () => {
  const out = synthesizeAnchors(REAL);

  it("keeps usdValue = percentOfFund x NAV on every row", () => {
    for (const anchor of out) {
      const nav = anchor.report.totals.fundValueUsd;
      for (const section of anchor.report.dashboard.sections) {
        for (const row of section.rows) {
          expect(row.usdValue).toBeCloseTo((row.percentOfFund / 100) * nav, 6);
        }
      }
    }
  });

  it("keeps each whole-fund section's percentages summing to 100, descending", () => {
    for (const section of out[0]!.report.dashboard.sections) {
      const pcts = section.rows.map((r) => r.percentOfFund);
      if (section.id !== "tiers") {
        expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
      }
      // Descending, so `summary.largest*` still names each section's top row.
      expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
    }
  });

  it("holds `pnl == usd - cost` exactly where the real fold holds it, and breaks it where the fold breaks it", () => {
    const held = (row: CompositionRow): boolean | undefined =>
      row.costBasisUsd === undefined || row.unrealizedPnlUsd === undefined
        ? undefined
        : Math.abs(row.usdValue - row.costBasisUsd - row.unrealizedPnlUsd) <
          1e-6 * Math.max(1, row.usdValue);

    for (const [index, anchor] of out.entries()) {
      for (const [s, section] of anchor.report.dashboard.sections.entries()) {
        for (const [r, row] of section.rows.entries()) {
          const real = REAL[index]!.report.dashboard.sections[s]!.rows[r]!;
          expect(held(row), `${section.id}/${row.id}`).toBe(held(real));
        }
      }
    }
    // False-pass guard: the input must actually contain both cases, or the
    // assertion above is vacuous.
    const rows = REAL[0]!.report.dashboard.sections.flatMap((s) => s.rows);
    expect(rows.some((r) => held(r) === true)).toBe(true);
    expect(rows.some((r) => held(r) === false)).toBe(true);
  });

  it("gives every section the same total cost basis and the same total P&L", () => {
    // Five partitions of one book. The real report's sections agree on both totals;
    // a fixture whose tempo cost basis disagreed with its instrument cost basis would
    // be visibly incoherent the moment slice 5 rendered two of them side by side.
    for (const anchor of out) {
      const pnl = anchor.report.dashboard.summary.totalUnrealizedPnlUsd;
      const sums = anchor.report.dashboard.sections.map((section) => ({
        cost: section.rows.reduce((t, r) => t + (r.costBasisUsd ?? 0), 0),
        pnl: section.rows.reduce((t, r) => t + (r.unrealizedPnlUsd ?? 0), 0),
      }));
      for (const sum of sums) {
        expect(sum.cost).toBeCloseTo(sums[0]!.cost, 6);
        expect(sum.pnl).toBeCloseTo(pnl, 6);
      }
      expect(sums[0]!.cost).toBeGreaterThan(0);
    }
  });

  it("re-points every summary highlight at the synthetic row it names", () => {
    for (const anchor of out) {
      const summary = anchor.report.dashboard.summary;
      const rows = anchor.report.dashboard.sections.flatMap((s) => s.rows);
      for (const focus of [summary.largestTempo, summary.reserve]) {
        const row = rows.find((r) => r.id === focus!.rowId)!;
        expect(focus!.usdValue).toBe(row.usdValue);
        expect(focus!.percentOfFund).toBe(row.percentOfFund);
      }
      // …and `largestTempo` is still the largest tempo, not a stale reference.
      const tempos = anchor.report.dashboard.sections.find((s) => s.id === "tempos")!;
      expect(summary.largestTempo!.rowId).toBe(tempos.rows[0]!.id);
    }
  });

  it("gives slice 5 a row in the red to render", () => {
    const negatives = out
      .flatMap((a) => a.report.dashboard.sections.flatMap((s) => s.rows))
      .filter((r) => (r.unrealizedPnlUsd ?? 0) < 0);
    expect(negatives.length).toBeGreaterThan(0);
  });
});

describe("determinism — the property the committed file depends on", () => {
  it("produces byte-identical output for identical input", () => {
    // No clock, no randomness, no run id: every invented number is a pure function
    // of `(asOf, rowId)`. Without this, regenerating would churn the committed file
    // on every run and a real diff would be invisible in the noise.
    expect(JSON.stringify(synthesizeAnchors(REAL))).toBe(
      JSON.stringify(synthesizeAnchors(REAL)),
    );
  });

  it("varies a row's share BETWEEN anchors, so per-row deltas are not all the NAV's", () => {
    const share = (index: number): number =>
      synthesizeAnchors(REAL)[index]!.report.dashboard.sections
        .find((s) => s.id === "instruments")!
        .rows[1]!.percentOfFund;
    expect(share(0)).not.toBe(share(1));
  });

  it("survives an empty history and a single anchor", () => {
    expect(synthesizeAnchors([])).toEqual([]);
    expect(synthesizeAnchors([REAL[0]!])).toHaveLength(1);
  });
});

describe("it REFUSES rather than emitting an incoherent section", () => {
  it("throws when a pinned Reserve percentage cannot sit at its own rank", () => {
    // The rank ladder honours the pin and fills around it. A Reserve row pinned at a
    // share its rank cannot hold would produce a section that contradicts its own
    // ordering — and `summary.largest*` names the top row of each section. Refusing
    // loudly is the only safe answer: the alternative is a silently wrong fixture
    // that slice 4 would replay as if it were history.
    const broken = structuredClone(REAL[0]!);
    const tempos = broken.report.dashboard.sections.find((s) => s.id === "tempos")!;
    tempos.rows[2]!.percentOfFund = 1;
    broken.report.dashboard.summary.reserve!.percentOfFund = 1;
    expect(() => synthesizeAnchors([broken])).toThrow(/came out unsorted/);
  });
});
