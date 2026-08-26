/**
 * THE FILL PATH VIEW (spec #285 S-F/S-H, slice #289) — the pure web-side module
 * `/ladder/$planId` renders from.
 *
 * PURE, for the same reason `glance/dca-view.ts` and `glance/verdict.ts` are: no IO, no
 * clock, no database. It takes the anchor the loader returned, the requested plan id,
 * and a spot READING that the caller has already obtained, and returns everything the
 * page shows. Spot is injected rather than fetched here precisely so this module stays
 * testable and stays out of the network — the one fetch lives in `lib/binance-spot.ts`
 * and its reason for being client-side is written at that call site.
 *
 * ── THE ROUTE READS CONCLUSIONS; IT RECOMPUTES NO HISTORICAL FACT ───────────────────
 * Per-rung state, the join, its provenance, the figures, the orphan count and the torn
 * set were all decided by the engine's `reconcileFillPath` and shipped as conclusions
 * (spec §3, glance doctrine). This module re-derives NONE of them. What it does is
 * exactly three things the wire cannot do for it:
 *
 *  1. RESOLVE — pick the one row carrying `planId` out of the roster, or say honestly
 *     that there is none.
 *  2. DECORATE WITH SPOT — the `next` marker and `waiting · price passed, unconfirmed`.
 *     These are the ONLY two facts on the page that move with price (spec §3), which is
 *     why they compute on the web side: the browser bundle gains no engine import.
 *     `routes/route-move.test.ts` is the guard that holds that — it walks this module's
 *     reachable import graph. `client-bundle.integration.test.ts` does NOT: it scans the
 *     built bundle for credential literals, and would stay green with the engine
 *     imported right here.
 *  3. SHAPE — the descending price sort, the chart's coordinates, the caption, and the
 *     absence causes. Presentation decisions, made where a test can reach them rather
 *     than inside JSX.
 *
 * ── THE FIVE ABSENCE RULES THIS MODULE IS BUILT AROUND ──────────────────────────────
 * Every one of them is a place where reading a missing field as a zero would render a
 * confident lie. They are not symmetrical, and the asymmetry is deliberate:
 *
 *  1. A RUNG WITH NO ORDER JOINED carries only `{id, priceUsd, sizeUsd}` — no zeroed
 *     quantities, no axes (`push/dca-block.ts`'s `toWireRung`). That absence IS
 *     `declared — not placed`, spelled by `ladder/rung-state-copy.ts`. A missing
 *     `venueConsumedQuantity` is not a 0% fill.
 *  2. `figures` PRESENT means a reconciliation ran at all. Absent means the orders
 *     sidecar was unreadable or only partly read — NOT that nothing is placed. The two
 *     get different causes on the same em-dash, because they are different facts.
 *  3. `tornActs` IS PRESENT AT ZERO on purpose. `0` is "checked, none outstanding";
 *     ABSENT is "this row could not check" (a v4 row, an unreadable sidecar). Absent
 *     must never render the all-clear.
 *  4. THE THREE MEASURED FIGURES are absent, never zero — a recorded fill has cost > 0
 *     and quantity > 0 by construction. There is no number to render, only a cause, so
 *     a `$0` is unreachable rather than merely avoided.
 *  5. `orphanLots` IS ABSENT AT ZERO — the opposite convention to `tornActs`, because
 *     it sits beside `figures`, whose presence already says a reconciliation ran. The
 *     inconsistency is the point: each field's absence is unambiguous in its own
 *     neighbourhood.
 *
 * ── ONE SEMANTIC FINDING THE COPY MUST NOT CONTRADICT ───────────────────────────────
 * `waitingDeclaredUsd` and `waitingRestingUsd` differ ONLY on never-placed rungs. For
 * any rung that has an order, `resting` and "not filled at the venue" are the same
 * predicate by construction. So the split this module exposes is `neverPlacedUsd` —
 * capital the operator declared and never encumbered. Copy calling it "unfilled vs.
 * still-open" would be claiming a distinction that does not exist.
 */
import type {
  DcaPositionRow,
  DcaWireRung,
  SnapshotAnchor,
} from "../projection/contract.ts";
import { convexityCaption } from "./convexity-caption.ts";
import { rungStateCopy } from "./rung-state-copy.ts";

/**
 * DECLARED BY THE PACKAGE, IMPORTED BACK HERE (spec #439 §4.1, S5). Both types moved to
 * `PriceDropPathChart`, the component that renders them, and this module composes into
 * them rather than owning them. `FillPathRungView.venueAxis` and `.bookAxis` are spelled
 * out over there rather than importing `projection/contract.ts`, which never moves — and
 * `composeFillPathPage` below assigns the wire's own axis values into that shape, so a
 * fifth venue axis on the contract stops compiling HERE, in the function whose author has
 * to decide what the picture says about it.
 */
import type { FillPathRungView, MeasuredFigure } from "@numisma/components";

/**
 * AND SO IS THE VIEW ITSELF, WITH ITS WHOLE CLOSURE (spec #439 §4.1, S6). `FillPathView`
 * and the six types it names moved to `ui/fill-path.tsx`, the module that renders them.
 * `composeFillPathPage` below is untouched by that: it keeps every line of its logic and
 * composes INTO the package's shape, so the assignment of `row.state` into
 * `FillPathView.state` is a compile-time pin on the two spellings agreeing.
 *
 * The direction is what lets a cosmos fixture author a `FillPathView` literal without
 * importing this file, which `seam-isolation.test.ts` forbids and which is the whole
 * reason the workbench can see the fill path at all.
 */
import type {
  ChartCircle,
  ChartGeometry,
  ExpectedFigures,
  FillPathFigures,
  FillPathView,
  TornActReading,
  WaitingSplit,
} from "@numisma/components";

export type { FillPathRungView, MeasuredFigure };
export type {
  ChartCircle,
  ChartGeometry,
  ExpectedFigures,
  FillPathFigures,
  FillPathView,
  TornActReading,
  WaitingSplit,
};

/**
 * What the caller knows about spot right now. THREE arms, because "still loading" and
 * "tried and failed" are different things to say to an operator, and neither is a price.
 */
export type SpotReading =
  | { status: "loading" }
  | { status: "live"; priceUsd: number }
  /** The fetch failed. `lastCloseUsd` is the last price this session actually saw. */
  | { status: "unavailable"; lastCloseUsd?: number };

export type FillPathPage =
  | { status: "ok"; view: FillPathView }
  | { status: "not-found"; planId: string; why: string }
  | { status: "no-price-axis"; positionId: string; why: string };

/**
 * The route parameter is a UUID by construction (`DcaPositionRow.planId`), reached by
 * tapping the card and never typed. A value that is not even UUID-shaped therefore did
 * not come from the card, and saying that is more useful than "no such ladder".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE UNRECORDED-FILL PREDICATE, spelled ONCE — the venue consumed something and the
 * book has no lot standing for all of it.
 *
 * EXPORTED BECAUSE TWO SURFACES ASK IT. This page counts them for the warning between
 * the header and the chart; `glance/dca-view.ts` counts them for the DCA card's alert
 * line on `/`. Two copies would be two chances to drift, and the two surfaces would then
 * disagree about whether anything needs the operator — which is the one question the
 * card exists to answer.
 *
 * THE `consumed > 0` CONJUNCT IS LOAD-BEARING. Every resting rung on day zero is
 * `not-recorded`, and there is nothing to record about it: the order has not filled.
 * Without the conjunct the phone would carry a permanent warning from the moment the
 * ladder was declared, which trains the operator to ignore it.
 */
export function needsRecording(rung: DcaWireRung): boolean {
  const consumed = rung.venueConsumedQuantity ?? 0;
  return (
    consumed > 0 && rung.bookAxis !== undefined && rung.bookAxis !== "recorded"
  );
}

/**
 * THE FILLED PREDICATE, SPELLED ONCE — the venue's own positive statement that this rung
 * filled, and the only place in `apps/web` that reads the literal.
 *
 * EXPORTED BECAUSE TWO SURFACES ASK IT OFF THE WIRE, the same reason `needsRecording` is:
 * this page decides `FillPathRungView.filled` with it, and `glance/dca-view.ts` counts
 * filled rungs for the DCA card on `/`. Every other consumer reads the decided field.
 * Six copies of `venueAxis === "filled"` were six chances for the picture, the legend and
 * the list to drift apart about the one state they all colour.
 *
 * ABSENCE IS NOT A FILL. `venueAxis` is optional on the wire, and both of its absences —
 * no order ever joined (absence rule 1), or a sidecar that could not be read (rule 2) —
 * are `false` here. Only the literal says yes.
 */
export function venueFilled(rung: DcaWireRung): boolean {
  return rung.venueAxis === "filled";
}

const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;
const PAD_X = 10;
const PAD_Y = 12;

/** Absence rule 4's cause, split by absence rule 2's distinction. */
function measured(
  value: number | undefined,
  reconciled: boolean,
): MeasuredFigure {
  if (value !== undefined) return { known: true, value };
  return {
    known: false,
    why: reconciled
      ? "no fill recorded yet"
      : "the orders sidecar could not be read for this ladder",
  };
}

/**
 * HAS THIS LADDER NOT STARTED BUYING? — the day-zero predicate, spelled here so the
 * component never re-derives it from the shape of three absences.
 *
 * ── THE TWO ABSENCES THIS FUNCTION EXISTS TO KEEP APART ─────────────────────────────
 * "No figures to show" has two causes and only one of them is day zero:
 *
 *  1. `figures` ABSENT (absence rule 2) — the orders sidecar could not be read. NOTHING
 *     was measured because nothing could be CHECKED. That ladder may be fully walked for
 *     all this snapshot knows. It is `reconciled: false` and it returns FALSE here, so
 *     the surface keeps saying it could not check. Projecting an expectation onto it
 *     would print a confident number on the one row whose whole content is "unknown".
 *  2. RECONCILIATION RAN AND FOUND NOTHING FILLED — this, and only this, is day zero.
 *
 * ALL THREE MEASURED FIGURES MUST BE ABSENT, not just `deployedUsd`. By absence rule 4
 * the three move together — a recorded fill has cost > 0 AND quantity > 0 — so requiring
 * all three costs nothing on well-formed input and refuses to call a ladder "unstarted"
 * off a half-populated `figures` block, which would be a projection standing beside a
 * real measurement.
 */
function hasNotStarted(
  figures:
    | { deployedUsd?: number; unitsAcquired?: number; avgEntryUsd?: number }
    | undefined,
): boolean {
  if (figures === undefined) return false;
  return (
    figures.deployedUsd === undefined &&
    figures.unitsAcquired === undefined &&
    figures.avgEntryUsd === undefined
  );
}

/**
 * THE DECLARED LADDER'S PROJECTION, or nothing.
 *
 * ABSENT RATHER THAN DEGRADED when the ladder does not declare enough to project from:
 * a rung with no `sizeUsd` (a v4 row — absence rule 1's neighbour, the same absence
 * `chartFor` refuses to plot) contributes no units, and silently summing the rest would
 * state an expectation for a ladder half of whose capital is unaccounted. A non-positive
 * price or size is refused for the same reason, and it also keeps the division safe.
 *
 * The average is the two TOTALS divided — see `ExpectedFigures.avgEntryUsd` for why the
 * arithmetic mean of the prices is the wrong number here.
 */
function expectedFigures(
  rungs: readonly FillPathRungView[],
): ExpectedFigures | undefined {
  if (rungs.length === 0) return undefined;
  let totalUsd = 0;
  let units = 0;
  for (const rung of rungs) {
    if (rung.sizeUsd === undefined || rung.sizeUsd <= 0 || rung.priceUsd <= 0) {
      return undefined;
    }
    totalUsd += rung.sizeUsd;
    units += rung.sizeUsd / rung.priceUsd;
  }
  if (units <= 0) return undefined;
  return { units, avgEntryUsd: totalUsd / units };
}

/** Absence rule 3: `0` is the all-clear; absent is "could not check". */
function readTornActs(count: number | undefined): TornActReading {
  if (count === undefined) return { status: "unchecked" };
  return count > 0 ? { status: "outstanding", count } : { status: "clear" };
}

/**
 * THE RESTING PREDICATE, spelled once — the venue holds an order for this rung and has
 * consumed none of it. See {@link FillPathRungView.venueResting} for why it is not
 * `rung.resting`, and `ladder/rung-state-copy.ts` for what used to answer this question
 * (a comparison against the engine's `waiting` string, at two component sites).
 */
function venueResting(rung: DcaWireRung): boolean {
  return rung.venueAxis === "resting";
}

export function composeFillPathPage(
  latest: SnapshotAnchor,
  planId: string,
  spot: SpotReading,
): FillPathPage {
  if (!UUID.test(planId)) {
    return {
      status: "not-found",
      planId,
      why: "that is not a plan id — the ladder is reached by tapping the DCA card",
    };
  }

  const row = latest.report.dca.positions.find(
    (position) => position.planId === planId,
  );
  if (row === undefined) {
    return {
      status: "not-found",
      planId,
      why: "no ladder in this snapshot carries that plan id",
    };
  }
  if (row.kind !== "dcaLadder") {
    return {
      status: "no-price-axis",
      positionId: row.positionId,
      why:
        row.kind === "dcaTime"
          ? "this plan buys on a cadence — there is no price axis to walk"
          : "this row carries no plan body",
    };
  }

  const reconciled = row.figures !== undefined;
  // Copy before sorting: `latest.report` is the loader's own object, shared with every
  // other surface on the page, and `Array.prototype.sort` is in-place.
  const wireRungs = [...(row.rungs ?? [])].sort(
    (a, b) => b.priceUsd - a.priceUsd,
  );

  // ── the two spot-dependent decorations ────────────────────────────────────────────
  // A LAST CLOSE IS NOT NOW. Only a LIVE reading may drive a marker that claims to know
  // where price is; a stale number decorating rungs would be the page asserting a
  // present-tense fact it does not have.
  const livePrice = spot.status === "live" ? spot.priceUsd : undefined;
  const isWaiting = (rung: DcaWireRung) => !venueFilled(rung);
  const nextRung =
    livePrice === undefined
      ? undefined
      : // Descending order, so the FIRST rung below spot is the one a falling price
        // meets next. None qualifies once price has fallen past the whole ladder.
        wireRungs.find((rung) => isWaiting(rung) && rung.priceUsd < livePrice);

  const rungs: FillPathRungView[] = wireRungs.map((rung, index) => {
    const notPlaced = reconciled && rung.venueAxis === undefined;
    const resting = rung.resting === true;
    // Only a RESTING rung can be "passed, unconfirmed": there has to be an order for
    // the venue to be silent about. A never-placed rung is not unconfirmed, it is
    // unplaced, which its own pill already says.
    const pricePassedUnconfirmed =
      livePrice !== undefined && resting && rung.priceUsd >= livePrice;
    // MEASURED, and decided before the words so the words can be authored FROM it: the
    // percentage the state copy carries and the percentage the pill prints are the same
    // number by construction, not two roundings that agree.
    const filledPercent =
      rung.venueAxis === "partly-filled" && rung.venueFilledFraction !== undefined
        ? Math.round(rung.venueFilledFraction * 100)
        : undefined;
    return {
      key: rung.id ?? `rung-at-${rung.priceUsd}`,
      ladderIndex: index + 1,
      priceUsd: rung.priceUsd,
      ...(rung.sizeUsd === undefined ? {} : { sizeUsd: rung.sizeUsd }),
      // THE ENGINE'S `label` IS NOT READ — see `ladder/rung-state-copy.ts`. The facts go
      // in; the words come out on this side of the package boundary.
      stateCopy: rungStateCopy({
        reconciled,
        ...(rung.venueAxis === undefined ? {} : { venueAxis: rung.venueAxis }),
        ...(rung.bookAxis === undefined ? {} : { bookAxis: rung.bookAxis }),
        ...(filledPercent === undefined ? {} : { filledPercent }),
      }),
      ...(rung.venueAxis === undefined ? {} : { venueAxis: rung.venueAxis }),
      ...(rung.bookAxis === undefined ? {} : { bookAxis: rung.bookAxis }),
      filled: venueFilled(rung),
      notPlaced,
      resting,
      venueResting: venueResting(rung),
      waiting: isWaiting(rung),
      isNext: rung === nextRung,
      pricePassedUnconfirmed,
      filledAtVenueNotRecorded: needsRecording(rung),
      matchedByPrice: rung.joinProvenance === "price-matched",
      ...(rung.declaredPriceMismatch && rung.orderPriceUsd !== undefined
        ? { placedAtUsd: rung.orderPriceUsd }
        : {}),
      ...(filledPercent === undefined ? {} : { filledPercent }),
    };
  });

  const waitingDeclaredUsd = row.figures?.waitingDeclaredUsd;
  const filledRungs = rungs.filter((rung) => rung.filled).length;
  // Day zero: the three measured tiles have nothing to say, so the surface says what the
  // ladder INTENDS instead. `expected` rides on `notStarted` and never outlives it.
  const notStarted = hasNotStarted(row.figures);
  const expected = notStarted ? expectedFigures(rungs) : undefined;

  return {
    status: "ok",
    view: {
      planId,
      positionId: row.positionId,
      // The POSITION is what the operator recognizes. The plan id never appears.
      title: row.positionId,
      state: row.state,
      reconciled,
      deployed: measured(row.figures?.deployedUsd, reconciled),
      unitsAcquired: measured(row.figures?.unitsAcquired, reconciled),
      avgEntry: measured(row.figures?.avgEntryUsd, reconciled),
      notStarted,
      ...(expected === undefined ? {} : { expected }),
      ...(row.figures === undefined
        ? {}
        : { figures: waitingFigures(row.figures) }),
      rungs,
      // Absence rule 5: absent IS zero — but ONLY beside a present `figures`.
      ...(row.figures === undefined ? {} : { orphanLots: row.orphanLots ?? 0 }),
      tornActs: readTornActs(latest.report.dca.tornActs),
      warnings: {
        filledNotRecorded: rungs.filter((rung) => rung.filledAtVenueNotRecorded)
          .length,
        pricePassedNoFill: rungs.filter((rung) => rung.pricePassedUnconfirmed)
          .length,
      },
      ...(reconciled
        ? {
            progress: {
              filledRungs,
              totalRungs: rungs.length,
              percent:
                rungs.length === 0
                  ? 0
                  : Math.round((filledRungs / rungs.length) * 100),
            },
          }
        : {}),
      ...(() => {
        const chart = chartFor(rungs, livePrice);
        return chart === undefined ? {} : { chart };
      })(),
      ...(() => {
        const caption = convexityCaption({
          rungs: rungs.map((rung) => ({
            priceUsd: rung.priceUsd,
            ...(rung.sizeUsd === undefined ? {} : { sizeUsd: rung.sizeUsd }),
            waiting: rung.waiting,
          })),
          ...(waitingDeclaredUsd === undefined ? {} : { waitingDeclaredUsd }),
        });
        return caption === undefined ? {} : { caption };
      })(),
      ...spotFields(spot),
      recordedThrough: latest.asOf,
    },
  };
}

/**
 * The waiting half, with the three-way split decided once. Called ONLY where the wire's
 * own `figures` is present — the absence is handled by its caller, so nothing in here
 * has to defend against a missing block.
 */
function waitingFigures(figures: {
  waitingDeclaredUsd: number;
  waitingRestingUsd: number;
}): FillPathFigures {
  const { waitingDeclaredUsd, waitingRestingUsd } = figures;
  const neverPlacedUsd = waitingDeclaredUsd - waitingRestingUsd;
  return {
    waitingDeclaredUsd,
    waitingRestingUsd,
    neverPlacedUsd,
    split:
      waitingDeclaredUsd <= 0
        ? "nothing-waiting"
        : neverPlacedUsd > 0
          ? "partly-unplaced"
          : "all-resting",
  };
}

/** The spot half of the view, kept together so the three arms cannot drift apart. */
function spotFields(
  spot: SpotReading,
): Pick<FillPathView, "spotUsd" | "spotUnavailable" | "spotLoading"> {
  if (spot.status === "live") {
    return {
      spotUsd: spot.priceUsd,
      spotUnavailable: false,
      spotLoading: false,
    };
  }
  if (spot.status === "loading") {
    return { spotUnavailable: false, spotLoading: true };
  }
  return {
    ...(spot.lastCloseUsd === undefined ? {} : { spotUsd: spot.lastCloseUsd }),
    spotUnavailable: true,
    spotLoading: false,
  };
}

/**
 * THE HAND-ROLLED CHART (spec §6.2 — a polyline, circles and a "now" line).
 *
 * PRICE ON X, DESCENDING LEFT TO RIGHT, so the eye reads the ladder the way the card is
 * named: the price drop path. Declared SIZE on y, growing downward, so a convex ladder
 * draws the curve the caption describes in words.
 *
 * SPOT IS FOLDED INTO THE PRICE DOMAIN when it is live, so the "now" line is never drawn
 * off-canvas on a day the market sits above or below the whole ladder — which is the
 * fund's actual situation more often than not.
 *
 * ABSENT rather than degraded when the ladder carries no sizes (a v4 row): there is no
 * y-axis to plot, and a flat line at an invented height would be a picture of a fact
 * nobody shipped.
 */
function chartFor(
  rungs: readonly FillPathRungView[],
  livePrice: number | undefined,
): ChartGeometry | undefined {
  if (rungs.length < 2) return undefined;
  if (rungs.some((rung) => rung.sizeUsd === undefined)) return undefined;

  const prices = rungs.map((rung) => rung.priceUsd);
  const high = Math.max(
    ...prices,
    ...(livePrice === undefined ? [] : [livePrice]),
  );
  const low = Math.min(
    ...prices,
    ...(livePrice === undefined ? [] : [livePrice]),
  );
  const maxSize = Math.max(...rungs.map((rung) => rung.sizeUsd!));
  if (high === low || maxSize <= 0) return undefined;

  const x = (price: number) =>
    PAD_X + ((high - price) / (high - low)) * (CHART_WIDTH - 2 * PAD_X);
  const y = (size: number) =>
    CHART_HEIGHT - PAD_Y - (size / maxSize) * (CHART_HEIGHT - 2 * PAD_Y);
  const round = (value: number) => Math.round(value * 100) / 100;

  const circles = rungs.map((rung) => ({
    key: rung.key,
    cx: round(x(rung.priceUsd)),
    cy: round(y(rung.sizeUsd!)),
    filled: rung.filled,
    next: rung.isNext,
  }));

  return {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    points: circles.map((circle) => `${circle.cx},${circle.cy}`).join(" "),
    circles,
    ...(livePrice === undefined ? {} : { nowX: round(x(livePrice)) }),
  };
}
