import type { FillPathRungView } from "./price-drop-path-chart";
import type { FillPathView } from "./fill-path";

/**
 * `FillPathView` LITERALS, BESIDE THE COMPONENT (spec #439 §4.3, S6).
 *
 * AUTHORED, BECAUSE THERE WAS NOTHING TO LIFT. Five of this wave's components arrived
 * with their prop literals already written inside a test file that moved with them. The
 * fill path's three test files do not have one: each reaches its view by calling
 * `composeFillPathPage(ladderFixture(name))` in `apps/web`, which a package test and a
 * cosmos fixture both cannot do — the first because the composer stays in the app, the
 * second because `seam-isolation.test.ts` forbids the import outright.
 *
 * DERIVED ONCE, MECHANICALLY, FROM `apps/web/src/ladder/started-ladder.fixtures.ts` as
 * `composeFillPathPage` emits it. That is what §4.3 sanctions and it is not the same as
 * guessing: what is NOT fine is leaving the literal unpinned, and spec #439 S9's
 * equivalence test is what pins it — one composed value per ladder state, deep-compared
 * against the package fixture claiming to be that state. Until S9 lands, a field that
 * drifts here is caught only by the type, so keep the shape honest by hand.
 *
 * ONE STATE FOR NOW. `partly-walked` is the widest — filled rungs, waiting rungs, two
 * never-placed rungs, a live spot and a next rung that is NOT index zero, which is the
 * only arrangement that can tell a derived default from a seeded one. S7 to S9 add
 * `day-zero`, `out-of-order` and `overfilled` as the components that render them arrive.
 *
 * SYNTHESIZED. Every price, size, key and total below comes from a hand-written app
 * fixture whose own tests say so. No ledger output, no plans sidecar and no real
 * transaction has been near this file.
 */

/**
 * One rung, spelled with the fields the composer actually emits for it.
 *
 * `venueAxis` AND `bookAxis` ARE ABSENT ON A NEVER-PLACED RUNG, not `undefined` — the
 * package sets `exactOptionalPropertyTypes`, so the two are different types, and only
 * absence is what `composeFillPathPage` produces. The helper therefore builds the base
 * object and spreads the axes in rather than writing the keys unconditionally.
 */
function rung(
  base: {
    readonly index: number;
    readonly priceUsd: number;
    readonly sizeUsd: number;
    readonly stateCopy: string;
  },
  flags: {
    readonly filled?: boolean;
    readonly notPlaced?: boolean;
    readonly resting?: boolean;
    readonly venueResting?: boolean;
    readonly waiting?: boolean;
    readonly isNext?: boolean;
    readonly filledPercent?: number;
    readonly venueAxis?: FillPathRungView["venueAxis"];
    readonly bookAxis?: FillPathRungView["bookAxis"];
  } = {},
): FillPathRungView {
  return {
    key: `fixture-rung-${base.index}`,
    ladderIndex: base.index,
    priceUsd: base.priceUsd,
    sizeUsd: base.sizeUsd,
    stateCopy: base.stateCopy,
    ...(flags.venueAxis === undefined ? {} : { venueAxis: flags.venueAxis }),
    ...(flags.bookAxis === undefined ? {} : { bookAxis: flags.bookAxis }),
    filled: flags.filled ?? false,
    notPlaced: flags.notPlaced ?? false,
    resting: flags.resting ?? false,
    venueResting: flags.venueResting ?? false,
    waiting: flags.waiting ?? false,
    isNext: flags.isNext ?? false,
    pricePassedUnconfirmed: false,
    filledAtVenueNotRecorded: false,
    matchedByPrice: false,
    ...(flags.filledPercent === undefined
      ? {}
      : { filledPercent: flags.filledPercent }),
  };
}

/**
 * A PARTLY WALKED LADDER — eight rungs, three of them filled, one partly.
 *
 * THE NEXT RUNG IS THE FOURTH, WHICH IS THE POINT. `FillPathProvider` derives its opening
 * selection from `isNext` on every render rather than seeding state from the prop, and a
 * fixture whose next rung was the first would render identically under either scheme. It
 * is also the only rung carrying `filledPercent`, so the panel's partial arm is on screen
 * without a second fixture.
 *
 * THE TWO DEEPEST RUNGS ARE DECLARED AND NEVER PLACED, which is what makes `figures.split`
 * `partly-unplaced`: $3,500 waiting, $1,550 of it resting at the venue, $1,950 encumbered
 * nowhere. That is the split the header card exists to make visible.
 */
export function partlyWalkedView(): FillPathView {
  return {
    planId: "facade00-0000-4000-8000-000000000002",
    positionId: "fixture:partly-walked",
    title: "fixture:partly-walked",
    state: "active",
    reconciled: true,
    deployed: { known: true, value: 910 },
    unitsAcquired: { known: true, value: 0.020789 },
    avgEntry: { known: true, value: 43773.15 },
    notStarted: false,
    figures: {
      waitingDeclaredUsd: 3500,
      waitingRestingUsd: 1550,
      neverPlacedUsd: 1950,
      split: "partly-unplaced",
    },
    rungs: [
      rung(
        { index: 1, priceUsd: 50000, sizeUsd: 200, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 2, priceUsd: 46000, sizeUsd: 250, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 3, priceUsd: 42000, sizeUsd: 300, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 4, priceUsd: 38000, sizeUsd: 400, stateCopy: "partly filled · 40%" },
        {
          resting: true,
          waiting: true,
          isNext: true,
          filledPercent: 40,
          venueAxis: "partly-filled",
          bookAxis: "recorded",
        },
      ),
      rung(
        { index: 5, priceUsd: 34000, sizeUsd: 500, stateCopy: "waiting" },
        {
          resting: true,
          venueResting: true,
          waiting: true,
          venueAxis: "resting",
          bookAxis: "not-recorded",
        },
      ),
      rung(
        { index: 6, priceUsd: 30000, sizeUsd: 650, stateCopy: "waiting" },
        {
          resting: true,
          venueResting: true,
          waiting: true,
          venueAxis: "resting",
          bookAxis: "not-recorded",
        },
      ),
      rung(
        { index: 7, priceUsd: 26000, sizeUsd: 850, stateCopy: "declared — not placed" },
        { notPlaced: true, waiting: true },
      ),
      rung(
        { index: 8, priceUsd: 22000, sizeUsd: 1100, stateCopy: "declared — not placed" },
        { notPlaced: true, waiting: true },
      ),
    ],
    orphanLots: 0,
    tornActs: { status: "clear" },
    warnings: { filledNotRecorded: 0, pricePassedNoFill: 0 },
    progress: { filledRungs: 3, totalRungs: 8, percent: 38 },
    chart: {
      width: 320,
      height: 120,
      points:
        "10,90.55 52.86,86.18 95.71,81.82 138.57,73.09 181.43,64.36 224.29,51.27 267.14,33.82 310,12",
      circles: [
        { key: "fixture-rung-1", cx: 10, cy: 90.55, filled: true, next: false },
        { key: "fixture-rung-2", cx: 52.86, cy: 86.18, filled: true, next: false },
        { key: "fixture-rung-3", cx: 95.71, cy: 81.82, filled: true, next: false },
        { key: "fixture-rung-4", cx: 138.57, cy: 73.09, filled: false, next: true },
        { key: "fixture-rung-5", cx: 181.43, cy: 64.36, filled: false, next: false },
        { key: "fixture-rung-6", cx: 224.29, cy: 51.27, filled: false, next: false },
        { key: "fixture-rung-7", cx: 267.14, cy: 33.82, filled: false, next: false },
        { key: "fixture-rung-8", cx: 310, cy: 12, filled: false, next: false },
      ],
      nowX: 127.86,
    },
    caption:
      "Buys grow as price falls: the deepest rung is 5.5× the first; $3,100 of the $3,500 still waiting sits below the ladder's midpoint, $36,000.",
    spotUsd: 39000,
    spotUnavailable: false,
    spotLoading: false,
    recordedThrough: "2026-08-12",
  };
}
