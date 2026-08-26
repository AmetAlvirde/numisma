/**
 * THE PACKAGE'S AUTHORED VIEWS, PROVED AGAINST WHAT THE PIPELINE EMITS (spec #439 §4.3,
 * S9). The test the whole wave's fixture story rests on.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────
 * Three of the fill path's test files used to reach their `FillPathView` by calling
 * `composeFillPathPage(ladderFixture(name))`. All three now live in
 * `packages/components/src/ui/` and neither function is reachable from there: the
 * composer stays in `apps/web`, and `seam-isolation.test.ts` forbids the workbench from
 * importing across the boundary at all. So this wave AUTHORED a `FillPathView` literal
 * per ladder state and asked every reader to believe it was a value the pipeline can
 * still produce.
 *
 * This file stops asking. One composed value per state, deep-compared against the
 * literal claiming to be that state. Without it, the pipeline could change shape — a
 * renamed field, a rounded figure, a dropped absence cause — and every package test
 * would stay green against a view production no longer emits.
 *
 * ── WHY IT LIVES IN `apps/web` AND COMPARES VALUES RATHER THAN TREES ────────────────
 * It can only live where BOTH sides are reachable, and this is the only side that can
 * see the composer (grill D5). It renders nothing: the claim is about a VALUE, and a
 * rendered comparison would fail for a hundred reasons that are not this one and would
 * re-import the component tree the wave just moved.
 *
 * IT ALSO CARRIES THE PROPERTY `fill-path-chart-a11y.test.tsx` GAVE UP. That file used
 * to recompute `convexityCaption` from the view's rungs and compare, which proved the
 * caption is GENERATED from the data the chart is drawn from — ADR-019's whole reason
 * for refusing a hand-maintained chart description. Against an authored fixture
 * `view.caption` is a literal, so that file now proves only that the component renders
 * the field. The generation property moved here, where a composed caption is on one side
 * of every comparison below.
 *
 * ── LADDER STATES ONLY, AND THIS IS NOT A LIST TO EXTEND CASUALLY ───────────────────
 * `fill-path.fixtures.ts` exports two kinds of thing. The four below are LADDER STATES:
 * each is what `composeFillPathPage` emits for the `started-ladder` fixture of the same
 * name, and each is comparable here. The ten derivations at the foot of that file — the
 * unreadable sidecar, the three spot arms, the two torn readings, the two unrecorded
 * warnings, the declared-price mismatch, the single-rung ladder and the rungless one —
 * are NOT states. No `started-ladder` fixture composes to any of them, so adding one
 * here is a red that cannot be fixed by editing the fixture. That file's header says the
 * same thing from the other side; keep both saying it.
 *
 * SYNTHESIZED ON BOTH SIDES. `started-ladder.fixtures.ts` is hand-written and its own
 * tests say so, and the package literals were transcribed from it. No ledger output, no
 * plans sidecar and no real transaction has been near either.
 */
import { describe, expect, it } from "vitest";

import {
  dayZeroView,
  outOfOrderView,
  overfilledView,
  partlyWalkedView,
} from "@numisma/components/ui/fill-path.fixtures.ts";
import type { FillPathView } from "@numisma/components";

import { composeFillPathPage } from "./fill-path-view.ts";
import { LADDER_FIXTURE_NAMES, ladderFixture } from "./started-ladder.fixtures.ts";

/**
 * The four pairs, named on both sides. The state name is what `ladderFixture` looks up
 * AND what the package literal claims to be, and the pairing is the whole assertion —
 * a fixture quietly re-pointed at another state's numbers would satisfy a comparison
 * made against `partlyWalkedView()` four times over.
 */
const STATES: readonly (readonly [string, () => FillPathView])[] = [
  ["day-zero", dayZeroView],
  ["partly-walked", partlyWalkedView],
  ["out-of-order", outOfOrderView],
  ["overfilled", overfilledView],
];

/** The view the route would render for a state, or a loud failure. */
function composed(name: string): FillPathView {
  const fixture = ladderFixture(name);
  if (fixture === undefined) throw new Error(`fixture \`${name}\` is gone`);
  const page = composeFillPathPage(fixture.anchor, fixture.planId, fixture.spot);
  if (page.status !== "ok") {
    throw new Error(`fixture composed to \`${page.status}\`, not a page`);
  }
  return page.view;
}

describe("the package's fill-path fixtures are what the composer emits", () => {
  it("covers every authored ladder state", () => {
    // THE FLOOR THE PER-STATE CASES CANNOT HOLD. A pairing list that lost an entry
    // leaves this file green while a package literal goes unpinned, which is the exact
    // failure the file exists to prevent. `started-ladder.fixtures.ts` is the source of
    // truth for how many states there are.
    //
    // AGAINST `LADDER_FIXTURE_NAMES`, NOT A SECOND LITERAL (spec #439 review finding 8).
    // Spelling the four names again here compared one hardcoded list against another,
    // which catches a DROPPED `STATES` entry and nothing else — author a fifth
    // `started-ladder` fixture and a fifth package literal for it and this file stayed
    // green while that literal went unpinned, the one direction the paragraph above
    // claims to hold. `LADDER_FIXTURE_NAMES` is derived from `STARTED_LADDER_FIXTURES`,
    // so both directions red now. Order is asserted too: these are `.map`ped off the
    // same authored array the route reads, so a reordering that broke the pairing is a
    // fact worth seeing rather than a detail to sort away.
    expect(STATES.map(([name]) => name)).toEqual([...LADDER_FIXTURE_NAMES]);
  });

  it.each(STATES)("composes `%s` to the literal beside the component", (name, authored) => {
    // `toStrictEqual`, NOT `toEqual`. `exactOptionalPropertyTypes` is on in the package
    // and the composer's absence arms DELETE keys rather than setting them `undefined`;
    // `toEqual` treats an absent key and an `undefined` one as the same value, so it
    // would pass against a literal that spells absence the one way production never
    // produces. Every fixture arm in that file is written around that distinction.
    //
    // AND UNROUNDED. `day-zero`'s `expected.avgEntryUsd` is `29075.96999998512` — a
    // full float, transcribed rather than tidied. A comparison that tolerated rounding
    // would let the projection layer start rounding without anything going red.
    expect(composed(name)).toStrictEqual(authored());
  });
});
