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
 * TWO STATES. `partly-walked` is the widest — filled rungs, waiting rungs, two
 * never-placed rungs, a live spot and a next rung that is NOT index zero, which is the
 * only arrangement that can tell a derived default from a seeded one. `day-zero` arrived
 * with the header card (S7) because it is the only state that reaches the PROJECTION
 * layout, and the switch between the two layouts is `view.expected` rather than "are the
 * measured figures absent" — a distinction no single fixture can show. S8 and S9 add
 * `out-of-order` and `overfilled` as the components that render them arrive.
 *
 * ── LADDER STATES ARE AUTHORED; FIELD-LEVEL ARMS ARE DERIVED ─────────────────────────
 * The derivations at the foot of this file — a missing orders sidecar, the three spot
 * arms, the two torn readings, the two unrecorded warnings — are NOT ladder states and
 * must not be authored as if they were. No `started-ladder` fixture composes to any of
 * them, so S9's equivalence test has nothing to compare them against, and a fifth
 * authored literal claiming to be a state production cannot produce is exactly what that
 * test exists to catch. Each one takes a composed state and moves the one field that
 * decides the arm, which is what the app-side structure test already does.
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
 * ── THE FIELD-LEVEL ARMS (spec #439 S7) ─────────────────────────────────────────────
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
