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
 * guessing: what is NOT fine is leaving the literal unpinned, and
 * `apps/web/src/ladder/fill-path-fixture-equivalence.test.ts` is what pins it — one
 * composed value per ladder state, deep-compared against the package fixture claiming to
 * be that state. It lives over there because it is the one place both `composeFillPathPage`
 * and this file are reachable at once. A field that drifts here now reds that test by
 * name; edit a literal below and run it.
 *
 * FOUR STATES, AND ONLY THESE FOUR GO TO THE EQUIVALENCE TEST. `partly-walked` is the
 * widest — filled rungs, waiting rungs, two never-placed rungs, a live spot and a next
 * rung that is NOT index zero, which is the only arrangement that can tell a derived
 * default from a seeded one. `day-zero` arrived
 * with the header card (S7) because it is the only state that reaches the PROJECTION
 * layout, and the switch between the two layouts is `view.expected` rather than "are the
 * measured figures absent" — a distinction no single fixture can show. `out-of-order`
 * arrived with the chart and the selected-rung panel (S8), because it is the state whose
 * fills are scattered UP the ladder rather than walked down it, and the chart draws that
 * shape while no other fixture can. `overfilled` arrived with the rung list (S9), the
 * fourth and last: it is the only state with an orphan-lot line to draw, the only one
 * whose progress bar is full, and the only one with no `isNext` rung at all.
 *
 * ── LADDER STATES ARE AUTHORED; FIELD-LEVEL ARMS ARE DERIVED ─────────────────────────
 * The derivations at the foot of this file — a missing orders sidecar, the three spot
 * arms, the two torn readings, the two unrecorded warnings, the declared-price mismatch,
 * the single-rung ladder and the ladder with no rungs at all — are NOT ladder states and
 * must not be authored as if they were. No `started-ladder` fixture composes to any of
 * them, so the equivalence test has nothing to compare them against, and HANDING ONE TO
 * IT IS A RED THAT CANNOT BE FIXED BY EDITING THE FIXTURE — a fifth authored literal
 * claiming to be a state production cannot produce is exactly what that test exists to
 * catch. Each one takes a composed state and moves the ONE field that decides the arm,
 * which is what the structure test's own `without` helper does beside it.
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
    readonly pricePassedUnconfirmed?: boolean;
    readonly filledAtVenueNotRecorded?: boolean;
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
    pricePassedUnconfirmed: flags.pricePassedUnconfirmed ?? false,
    filledAtVenueNotRecorded: flags.filledAtVenueNotRecorded ?? false,
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

/**
 * A LADDER ON DAY ZERO — eight rungs declared, every one of them resting, nothing filled.
 *
 * THE ONLY STATE THAT REACHES THE PROJECTION LAYOUT, which is why it arrives with the
 * header card. `reconciled` is true and `notStarted` is true: a reconciliation RAN and
 * found nothing, which is what lets the card project. That is a different fact from
 * "the three measured figures are absent" — a ladder whose orders sidecar could not be
 * read has all three absent too and gets the measured layout, because nothing about it
 * has been established. `unreadableSidecarView()` below is that ladder, and the two
 * beside each other are the whole reason this slice authored a second state.
 *
 * THE PROGRESS BAR IS AT ZERO AND THE BAR IS STILL DRAWN. A bar at zero reads as absence,
 * which is the truth here; a zero-dollar figure would read as a measurement.
 *
 * SPOT IS ABOVE THE LADDER at $52,400, over the top rung's $50,000, so `chart.nowX` sits
 * at the left edge. That is what a declared ladder looks like before price has come to
 * it, and it is the arrangement `partly-walked` cannot show.
 */
export function dayZeroView(): FillPathView {
  return {
    planId: "facade00-0000-4000-8000-000000000001",
    positionId: "fixture:day-zero",
    title: "fixture:day-zero",
    state: "pending",
    reconciled: true,
    deployed: { known: false, why: "no fill recorded yet" },
    unitsAcquired: { known: false, why: "no fill recorded yet" },
    avgEntry: { known: false, why: "no fill recorded yet" },
    notStarted: true,
    // THE FULL FLOAT, TRANSCRIBED RATHER THAN ROUNDED. `avgEntryUsd` is total declared
    // USD ÷ expected units — a size-weighted harmonic mean, which is why it does not land
    // on a round figure — and S9's equivalence test is a deep compare against exactly
    // what `composeFillPathPage` emits. A tidied literal here reds it.
    expected: { units: 0.14616881225294204, avgEntryUsd: 29075.96999998512 },
    figures: {
      waitingDeclaredUsd: 4250,
      waitingRestingUsd: 4250,
      neverPlacedUsd: 0,
      split: "all-resting",
    },
    rungs: [
      rung(
        { index: 1, priceUsd: 50000, sizeUsd: 200, stateCopy: "waiting" },
        {
          resting: true,
          venueResting: true,
          waiting: true,
          isNext: true,
          venueAxis: "resting",
          bookAxis: "not-recorded",
        },
      ),
      ...(
        [
          [2, 46000, 250],
          [3, 42000, 300],
          [4, 38000, 400],
          [5, 34000, 500],
          [6, 30000, 650],
          [7, 26000, 850],
          [8, 22000, 1100],
        ] as const
      ).map(([index, priceUsd, sizeUsd]) =>
        rung(
          { index, priceUsd, sizeUsd, stateCopy: "waiting" },
          {
            resting: true,
            venueResting: true,
            waiting: true,
            venueAxis: "resting",
            bookAxis: "not-recorded",
          },
        ),
      ),
    ],
    orphanLots: 0,
    tornActs: { status: "clear" },
    warnings: { filledNotRecorded: 0, pricePassedNoFill: 0 },
    progress: { filledRungs: 0, totalRungs: 8, percent: 0 },
    chart: {
      width: 320,
      height: 120,
      points:
        "33.68,90.55 73.16,86.18 112.63,81.82 152.11,73.09 191.58,64.36 231.05,51.27 270.53,33.82 310,12",
      circles: [
        { key: "fixture-rung-1", cx: 33.68, cy: 90.55, filled: false, next: true },
        { key: "fixture-rung-2", cx: 73.16, cy: 86.18, filled: false, next: false },
        { key: "fixture-rung-3", cx: 112.63, cy: 81.82, filled: false, next: false },
        { key: "fixture-rung-4", cx: 152.11, cy: 73.09, filled: false, next: false },
        { key: "fixture-rung-5", cx: 191.58, cy: 64.36, filled: false, next: false },
        { key: "fixture-rung-6", cx: 231.05, cy: 51.27, filled: false, next: false },
        { key: "fixture-rung-7", cx: 270.53, cy: 33.82, filled: false, next: false },
        { key: "fixture-rung-8", cx: 310, cy: 12, filled: false, next: false },
      ],
      nowX: 10,
    },
    caption:
      "Buys grow as price falls: the deepest rung is 5.5× the first; $3,100 of the $4,250 still waiting sits below the ladder's midpoint, $36,000.",
    spotUsd: 52400,
    spotUnavailable: false,
    spotLoading: false,
    recordedThrough: "2026-08-12",
  };
}

/**
 * FILLS SCATTERED UP THE LADDER, NOT WALKED DOWN IT (spec #439 S8) — rung 2, rung 4 and
 * rung 5 are filled while rung 1 and rung 3 are still resting above them.
 *
 * THE ONLY STATE WHOSE PICTURE DISAGREES WITH ITS ORDER. `partly-walked` fills the top
 * three rungs, so its chart reads as a curve walked from the left and the rung list says
 * the same thing twice. Here the filled rings are interleaved with waiting ones, which is
 * the shape only the chart can show and the reason this state arrives with the chart card.
 *
 * IT IS ALSO THE ONLY STATE THAT CARRIES BOTH UNRECORDED WARNINGS AT ONCE FOR REAL. Rung
 * 4 is `filled at venue — not recorded`, and rungs 1 and 3 have had price pass through
 * with no fill recorded — one fact the venue reported and two inferred from spot, composed
 * rather than derived by moving a field. There is an orphan lot, too, which no other state
 * has.
 *
 * THE NEXT RUNG IS THE SIXTH. Spot is $31,000, below the three resting rungs above it, so
 * `nowX` sits well to the right and the next rung is the first resting one beneath the
 * price rather than the first one on the ladder.
 */
export function outOfOrderView(): FillPathView {
  return {
    planId: "facade00-0000-4000-8000-000000000003",
    positionId: "fixture:out-of-order",
    title: "fixture:out-of-order",
    state: "active",
    reconciled: true,
    deployed: { known: true, value: 1150 },
    unitsAcquired: { known: true, value: 0.030667 },
    avgEntry: { known: true, value: 37499.59 },
    notStarted: false,
    figures: {
      waitingDeclaredUsd: 3100,
      waitingRestingUsd: 2000,
      neverPlacedUsd: 1100,
      split: "partly-unplaced",
    },
    rungs: [
      rung(
        { index: 1, priceUsd: 50000, sizeUsd: 200, stateCopy: "waiting" },
        {
          resting: true,
          venueResting: true,
          waiting: true,
          pricePassedUnconfirmed: true,
          venueAxis: "resting",
          bookAxis: "not-recorded",
        },
      ),
      rung(
        { index: 2, priceUsd: 46000, sizeUsd: 250, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 3, priceUsd: 42000, sizeUsd: 300, stateCopy: "waiting" },
        {
          resting: true,
          venueResting: true,
          waiting: true,
          pricePassedUnconfirmed: true,
          venueAxis: "resting",
          bookAxis: "not-recorded",
        },
      ),
      rung(
        {
          index: 4,
          priceUsd: 38000,
          sizeUsd: 400,
          stateCopy: "filled at venue — not recorded",
        },
        {
          filled: true,
          filledAtVenueNotRecorded: true,
          venueAxis: "filled",
          bookAxis: "not-recorded",
        },
      ),
      rung(
        { index: 5, priceUsd: 34000, sizeUsd: 500, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 6, priceUsd: 30000, sizeUsd: 650, stateCopy: "waiting" },
        {
          resting: true,
          venueResting: true,
          waiting: true,
          isNext: true,
          venueAxis: "resting",
          bookAxis: "not-recorded",
        },
      ),
      rung(
        { index: 7, priceUsd: 26000, sizeUsd: 850, stateCopy: "waiting" },
        {
          resting: true,
          venueResting: true,
          waiting: true,
          venueAxis: "resting",
          bookAxis: "not-recorded",
        },
      ),
      rung(
        { index: 8, priceUsd: 22000, sizeUsd: 1100, stateCopy: "declared — not placed" },
        { notPlaced: true, waiting: true },
      ),
    ],
    orphanLots: 1,
    tornActs: { status: "clear" },
    warnings: { filledNotRecorded: 1, pricePassedNoFill: 2 },
    progress: { filledRungs: 3, totalRungs: 8, percent: 38 },
    chart: {
      width: 320,
      height: 120,
      points:
        "10,90.55 52.86,86.18 95.71,81.82 138.57,73.09 181.43,64.36 224.29,51.27 267.14,33.82 310,12",
      circles: [
        { key: "fixture-rung-1", cx: 10, cy: 90.55, filled: false, next: false },
        { key: "fixture-rung-2", cx: 52.86, cy: 86.18, filled: true, next: false },
        { key: "fixture-rung-3", cx: 95.71, cy: 81.82, filled: false, next: false },
        { key: "fixture-rung-4", cx: 138.57, cy: 73.09, filled: true, next: false },
        { key: "fixture-rung-5", cx: 181.43, cy: 64.36, filled: true, next: false },
        { key: "fixture-rung-6", cx: 224.29, cy: 51.27, filled: false, next: true },
        { key: "fixture-rung-7", cx: 267.14, cy: 33.82, filled: false, next: false },
        { key: "fixture-rung-8", cx: 310, cy: 12, filled: false, next: false },
      ],
      nowX: 213.57,
    },
    caption:
      "Buys grow as price falls: the deepest rung is 5.5\u00d7 the first; $2,600 of the $3,100 still waiting sits below the ladder's midpoint, $36,000.",
    spotUsd: 31000,
    spotUnavailable: false,
    spotLoading: false,
    recordedThrough: "2026-08-12",
  };
}

/**
 * AN OVERFILLED LADDER — every rung filled, and two recorded lots no rung explains.
 *
 * THE FOURTH AND LAST STATE, and the one that closes the set S9's equivalence test
 * compares. It reaches three things no other fixture does: `figures.split` is
 * `nothing-waiting`, so the header card's waiting block prints its emptiest arm;
 * `progress` is 8 of 8 at 100%, so the bar is full rather than partial; and
 * `orphanLots` is 2, which is the only authored state where the rung list's orphan
 * line renders at all. Every other state carries a zero there and draws nothing.
 *
 * NO RUNG IS `isNext`, WHICH IS NOT AN OVERSIGHT. Spot is $20,800, below the deepest
 * rung's $22,000, so price has passed the whole ladder and there is no rung it reaches
 * next — `chart.nowX` sits at the right edge. That is the arrangement the tint map's
 * `next` arm and the status map's `next` arm are BOTH absent from, and a fixture set
 * whose every state carried a next rung could not show that either map has a default.
 *
 * THE CAPTION IS THE SHORT FORM. `convexityCaption` appends its waiting-weight clause
 * only when something is still waiting; nothing is, so the sentence stops after the
 * convexity ratio. That clause's presence is decided by the data the chart is drawn
 * from, which is what the equivalence test pins.
 */
export function overfilledView(): FillPathView {
  return {
    planId: "facade00-0000-4000-8000-000000000004",
    positionId: "fixture:overfilled",
    title: "fixture:overfilled",
    state: "active",
    reconciled: true,
    deployed: { known: true, value: 5525 },
    unitsAcquired: { known: true, value: 0.146169 },
    avgEntry: { known: true, value: 37798.71 },
    notStarted: false,
    figures: {
      waitingDeclaredUsd: 0,
      waitingRestingUsd: 0,
      neverPlacedUsd: 0,
      split: "nothing-waiting",
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
        { index: 4, priceUsd: 38000, sizeUsd: 400, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 5, priceUsd: 34000, sizeUsd: 500, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 6, priceUsd: 30000, sizeUsd: 650, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 7, priceUsd: 26000, sizeUsd: 850, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
      rung(
        { index: 8, priceUsd: 22000, sizeUsd: 1100, stateCopy: "filled" },
        { filled: true, venueAxis: "filled", bookAxis: "recorded" },
      ),
    ],
    orphanLots: 2,
    tornActs: { status: "clear" },
    warnings: { filledNotRecorded: 0, pricePassedNoFill: 0 },
    progress: { filledRungs: 8, totalRungs: 8, percent: 100 },
    chart: {
      width: 320,
      height: 120,
      points:
        "10,90.55 51.1,86.18 92.19,81.82 133.29,73.09 174.38,64.36 215.48,51.27 256.58,33.82 297.67,12",
      circles: [
        { key: "fixture-rung-1", cx: 10, cy: 90.55, filled: true, next: false },
        { key: "fixture-rung-2", cx: 51.1, cy: 86.18, filled: true, next: false },
        { key: "fixture-rung-3", cx: 92.19, cy: 81.82, filled: true, next: false },
        { key: "fixture-rung-4", cx: 133.29, cy: 73.09, filled: true, next: false },
        { key: "fixture-rung-5", cx: 174.38, cy: 64.36, filled: true, next: false },
        { key: "fixture-rung-6", cx: 215.48, cy: 51.27, filled: true, next: false },
        { key: "fixture-rung-7", cx: 256.58, cy: 33.82, filled: true, next: false },
        { key: "fixture-rung-8", cx: 297.67, cy: 12, filled: true, next: false },
      ],
      nowX: 310,
    },
    caption: "Buys grow as price falls: the deepest rung is 5.5× the first.",
    spotUsd: 20800,
    spotUnavailable: false,
    spotLoading: false,
    recordedThrough: "2026-08-12",
  };
}

/**
 * ── THE FIELD-LEVEL ARMS (spec #439 S7, extended at S8) ─────────────────────────────
 *
 * Not ladder states. Each one takes a composed state and moves the ONE field that decides
 * an arm, because no `started-ladder` fixture reaches these: every one of them is a ladder
 * that reconciled with a live spot and a clear torn reading, by design. Authoring them as
 * states would put four more literals in front of S9's equivalence test claiming to be
 * something production cannot produce.
 */

/**
 * DELETES A KEY RATHER THAN SETTING IT `undefined`, and the package's
 * `exactOptionalPropertyTypes` is why: `{ ...view, figures: undefined }` is a different
 * type from a view that never carried the key, and only the latter is what the composer's
 * absent arm produces. The cast is confined to this one helper.
 */
function without(view: FillPathView, key: keyof FillPathView): FillPathView {
  const copy: Record<string, unknown> = { ...view };
  delete copy[key];
  return copy as unknown as FillPathView;
}

/**
 * THE ORDERS SIDECAR COULD NOT BE READ — `figures` absent, which is absence rule 2 held
 * all the way to the render. `Waiting` prints the em dash and the cause sentence, NOT
 * `$0`, and the card keeps the MEASURED layout: `expected` is absent here too, so nothing
 * has been established about whether this ladder started.
 */
export function unreadableSidecarView(): FillPathView {
  return without(partlyWalkedView(), "figures");
}

/** Spot is still being read. The first of `SpotReadout`'s three arms, and an em dash. */
export function spotLoadingView(): FillPathView {
  return { ...partlyWalkedView(), spotLoading: true };
}

/** The fetch failed and the session never saw a price. The second arm, also an em dash. */
export function spotMissingView(): FillPathView {
  return { ...without(partlyWalkedView(), "spotUsd"), spotUnavailable: true };
}

/**
 * A LAST CLOSE, SAID TO BE ONE. The fetch failed but the session saw a price earlier, so
 * the price renders with `last close · live price unavailable` beside it. It must never
 * pass for `· live`: the chart's now-rule is decided off a live reading only.
 */
export function spotLastCloseView(): FillPathView {
  return { ...partlyWalkedView(), spotUnavailable: true };
}

/** A torn act is open, so `record-fill` will refuse. The banner's `role="alert"` arm. */
export function tornOutstandingView(): FillPathView {
  return { ...partlyWalkedView(), tornActs: { status: "outstanding", count: 2 } };
}

/** Nobody looked. The quiet line, because silence would claim a check that never ran. */
export function tornUncheckedView(): FillPathView {
  return { ...partlyWalkedView(), tornActs: { status: "unchecked" } };
}

/**
 * BOTH UNRECORDED WARNINGS AT ONCE, which is the only way to see that they look
 * different. `filledNotRecorded` is a fact the venue reported; `pricePassedNoFill` is
 * inferred from spot. One solid left edge, one dashed, and the dash is on that edge
 * alone.
 */
export function unrecordedWarningsView(): FillPathView {
  return {
    ...partlyWalkedView(),
    warnings: { filledNotRecorded: 1, pricePassedNoFill: 2 },
  };
}

/**
 * A DECLARED JOIN WHOSE ORDER SITS AT ANOTHER PRICE — the ONE fact that opens the selected
 * rung panel's exception shelf, which is conditional rather than empty because a `dl` with
 * no rows is a labelled box promising detail it does not have.
 *
 * DERIVED, AND IT HAS TO BE. The name `out-of-order` reads as if it were this state, and
 * it is not: `placedAtUsd` rides on the wire's `declaredPriceMismatch` flag, which no
 * `started-ladder` fixture sets on any rung, so no ladder state composes to a rung
 * carrying it. Authoring one would put a fifth literal in front of S9's equivalence test
 * claiming to be a state production cannot produce — the exact thing that test exists to
 * catch. So this moves the one field on the one rung, the way every other arm at the foot
 * of this file does.
 *
 * IT MOVES RUNG 6, WHICH IS THE SELECTED ONE. `outOfOrderView`'s next rung is the sixth
 * and the provider opens on it, so the shelf is on screen without anything being pressed.
 */
export function placedAtMismatchView(): FillPathView {
  const view = outOfOrderView();
  return {
    ...view,
    rungs: view.rungs.map((entry) =>
      entry.ladderIndex === 6 ? { ...entry, placedAtUsd: 29750.5 } : entry,
    ),
  };
}

/**
 * A LADDER OF ONE RUNG — the arm where `priceSpan` returns nothing, because a single rung
 * is a price and not a range, and the arm where the chart card renders no inspect slider
 * either. The two absences share a fixture because they share a cause.
 *
 * `chart` IS KEPT AND `caption` IS DROPPED, so the picture is on screen with its
 * `sr-only` substitute in its ABSENT arm. Both halves of that block are rendered somewhere
 * in the workbench and neither is reachable from a composed state: every one of them
 * carries eight rungs and a caption.
 */
export function singleRungView(): FillPathView {
  const view = partlyWalkedView();
  return {
    ...without(view, "caption"),
    rungs: [view.rungs[3]!],
  };
}

/**
 * NO RUNGS AT ALL — `chart` absent, so the card renders the stated cause where the picture
 * goes, and the panel is an `Absent` inside a plain `Card` rather than the live region.
 * The deepest absence this surface has, and the one no ladder state reaches.
 */
export function runglessView(): FillPathView {
  return { ...without(partlyWalkedView(), "chart"), rungs: [] };
}
