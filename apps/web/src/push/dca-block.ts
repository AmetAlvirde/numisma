/**
 * The push-side DCA builder (spec #277, slice 1) — PURE.
 *
 * Given the plans sidecar's loaded VALUE, an anchor date and the fold's born
 * positions, it produces the {@link DcaBlock} the projection payload will carry.
 *
 * IT TAKES THE LOADER'S VALUE, NEVER A PATH. The IO half (`loadPlans`,
 * `resolvePlansPath`) belongs to the push wiring one level up; handing this module a
 * `LoadedPlans` keeps it pure and unit-testable with in-memory values, and keeps the
 * disk read on the one path already privileged to do it.
 *
 * ROW ENUMERATION DELEGATES TO `listPlansAsOf`, and that delegation is the point: the
 * engine deliberately keeps ONE path through the supersession comparison, priced as
 * such in `packages/engine/src/plans.ts`, because a second path would be a silently
 * wrong ladder rather than a slow one. This builder is a NARROWING of that roster; it
 * must never become a second selector.
 *
 * WHAT IT REFUSES, each refusal a decision:
 *  - `none` rows are OMITTED. Absence is the encoding (`D5`); the wire has no arm for
 *    "the sidecar mentions this id and says nothing about it".
 *  - `endedBy`, `skipped` and the per-row `unattributable` arrays never ship. They are
 *    a conclusion's INPUTS, and the glance doctrine ships the conclusion.
 *  - Rungs carry `id`, `priceUsd` and the declared `sizeUsd` (the last admitted by the
 *    slice 3 amendment — see {@link DcaWireRung}'s header for what it discloses).
 *  - `unattributable` ships as a count, never a line.
 *  - Nothing date-shaped is emitted at all. `asOf` is an input to the selection, never
 *    an output of it.
 *
 * RUNG ORDER IS AS DECLARED. The descending price sort is a PRESENTATION decision and
 * lives in the view composer; a builder that sorted would make the wire's order a
 * second, invisible contract.
 *
 * ── THE FILL PATH (spec #285, slice 3) ──────────────────────────────────────────────
 * This module now also narrows the ENGINE'S RECONCILIATION (`reconcileFillPath`) onto
 * the same rows. The reconciliation reads the ORDER STREAM and the position's LOTS;
 * neither crosses the wire, and this file is where they stop.
 *
 * WHAT CROSSES: per-rung two-axis state and the join that produced it, the measured
 * figures, a COUNT of the lots no rung explains, and a COUNT of the outstanding torn
 * fill acts. What does not: the orders themselves, the order ids, the lots, the torn
 * acts, and every stamp on any of them.
 *
 * `fills` IS OPTIONAL, AND ITS ABSENCE IS A STATEMENT. Absent means NO RECONCILIATION
 * WAS POSSIBLE — the orders sidecar could not be read — and the row then carries no
 * fill key at all, which is also exactly what a v4 anchor looks like to the reader. A
 * defaulted empty reconciliation would instead assert "nothing is placed", which is a
 * different fact and the wrong one; the same reasoning that keeps `source: "unreadable"`
 * distinct from an empty roster.
 *
 * ABSENT, NEVER ZERO, ONE LEVEL DOWN TOO: a rung with no order joined to it carries NO
 * fill key — not a zeroed `venueConsumedQuantity`, not a `label`. The surface renders
 * the absence; a zero on the wire is a number that can be rendered by mistake, and
 * `$0 deployed` is the specific lie this increment exists to make unrepresentable.
 */
import type {
  Currency,
  DcaLadderPlanRecord,
  DcaRung,
  FillPathRung,
  FillPathView,
  IsoDate,
  LoadedPlans,
  OrderRecord,
  PortfolioEvent,
  PositionLot,
  TornFillAct,
} from "@numisma/engine";
import {
  listPlansAsOf,
  reconcileFillActs,
  reconcileFillPath,
  selectOrdersThrough,
} from "@numisma/engine";
import type {
  DcaBlock,
  DcaPositionRow,
  DcaWireFillFigures,
  DcaWireRung,
} from "../projection/contract.ts";

/** One position's recorded book, as the fold holds it — the reconciliation's lot side. */
export interface DcaFillPosition {
  lots: readonly PositionLot[];
  /** The position's denomination; `entryFx`/`reviewFx` value a non-USD lot. */
  currency: Currency;
}

/**
 * Everything the reconciliation needs that the plans sidecar cannot supply. Passed as
 * VALUES, never as paths: the disk reads (`loadOrders`, the fold) belong to the push
 * wiring one level up, exactly as `LoadedPlans` already does.
 */
export interface DcaFillInputs {
  /**
   * The WHOLE order stream as loaded. Bounded to the anchor HERE rather than by the
   * caller, so the as-of discipline is applied in one place for every caller.
   */
  orders: readonly OrderRecord[];
  /**
   * THE WHOLE DURABLE LOG as loaded — the OTHER half of every fill act, and the only
   * input the torn-act detector cannot be run without. Bounded to the anchor HERE, with
   * the order stream beside it, so one place decides what a historical anchor knew.
   *
   * The push holds the FOLD, which does not carry these; `push-core.ts` reads the log
   * for them. That is why they are passed as a VALUE — the read belongs to the wiring
   * one level up, exactly as `orders` and `LoadedPlans` do.
   */
  events: readonly PortfolioEvent[];
  /** The fold's positions by id — only the ones a plan could name are ever read. */
  positions: ReadonlyMap<string, DcaFillPosition>;
  /** The review's rate, as the per-lot `entryFx` fallback. Passed, never fetched. */
  reviewFx?: number;
}

export function buildDcaBlock(
  loaded: LoadedPlans,
  asOf: IsoDate,
  existingPositionIds: ReadonlySet<string>,
  fills?: DcaFillInputs,
): DcaBlock {
  const roster = listPlansAsOf(loaded, asOf, existingPositionIds);
  // ONE boundary, applied once, for every ladder on this anchor. The reconciliation
  // reads the stream more than once and takes no date of its own, so a bounded stream
  // is the only way a historical anchor answers historically.
  const orders =
    fills === undefined ? undefined : selectOrdersThrough(fills.orders, asOf);
  // THE FUND-LEVEL FACT, computed ONCE for the whole branch: both files entire, both
  // bounded to the anchor. The event bound is a bare `asOf <=` rather than a selector
  // because the envelope's `asOf` IS the event's calendar date (`events/parse.ts` gates
  // it to `YYYY-MM-DD`), where an order line carries a second-granular venue stamp that
  // `selectOrdersThrough` has to reduce first.
  const torn =
    orders === undefined || fills === undefined
      ? undefined
      : reconcileFillActs(
          fills.events.filter((event) => event.asOf <= asOf),
          orders,
        );

  const positions: DcaPositionRow[] = [];
  for (const row of roster.positions) {
    const lookup = row.lookup;
    switch (lookup.status) {
      case "none":
        // The one arm with no wire representation. See the header.
        continue;
      case "pending":
      case "active": {
        const plan = lookup.plan;
        if (plan.kind !== "dcaLadder") {
          positions.push({
            positionId: row.positionId,
            state: lookup.status,
            kind: plan.kind,
          });
          break;
        }
        const view =
          orders === undefined
            ? undefined
            : reconcile(plan, orders, torn ?? [], fills!, row.positionId);
        const byRungId = new Map(
          (view?.rungs ?? []).map((filled) => [filled.rung.id, filled]),
        );
        positions.push({
          positionId: row.positionId,
          state: lookup.status,
          kind: plan.kind,
          // THE LADDER'S OWN IDENTITY, always — a plan fact, not a fill fact, so it
          // ships whether or not a reconciliation was possible. The route resolves on it.
          planId: plan.id,
          rungs: plan.rungs.map((rung) => toWireRung(rung, byRungId.get(rung.id))),
          ...(view === undefined
            ? {}
            : {
                figures: toWireFigures(view),
                // ABSENT AT ZERO. `figures`'s presence already says the reconciliation
                // ran, so an omitted count reads unambiguously as "none unexplained".
                ...(view.orphans.length > 0 ? { orphanLots: view.orphans.length } : {}),
              }),
        });
        break;
      }
      case "ended":
      case "unreadable":
        positions.push({ positionId: row.positionId, state: lookup.status });
        break;
    }
  }

  return {
    // The engine's own doctrine, not this module's invention: `listPlansAsOf` already
    // returns an empty roster on a failed load, so the builder adds no special-casing
    // — it only refuses to erase the distinction between "no plans" and "the file
    // could not be read".
    source: loaded.load.status === "load-failed" ? "unreadable" : "loaded",
    positions,
    unattributable: roster.unattributable.length,
    // THE COUNT, AND A VISIBLE ZERO WHEN THE BOOKS AGREE. Spread rather than assigned so
    // "could not check" is a genuinely absent key — the same distinction `figures` makes
    // one level down, and the reason the two absences must not be spelled alike.
    ...(torn === undefined ? {} : { tornActs: torn.length }),
  };
}

/**
 * Run the engine's reconciliation for one ladder.
 *
 * `tornActs` IS THE REAL LIST, DETECTED ONCE AND PASSED IN. This docstring used to say it
 * was "passed empty, and that is not a claim that none exist", because detecting a torn
 * act needs the raw `PortfolioEvent` list and the push held only the fold. The push now
 * reads the log for exactly this (`DcaFillInputs.events`), so the caveat is retired
 * rather than left standing beside code that contradicts it — the failure mode this repo
 * has actually been bitten by.
 *
 * DETECTED ABOVE, NOT HERE, because the fact is FUND-LEVEL: one detection for the whole
 * branch, handed to every ladder, so N ladders cannot disagree about the state of two
 * files neither of them owns. The engine's `FillPathView` reports the list straight
 * through and decides nothing about it; only the COUNT leaves this module.
 */
function reconcile(
  plan: DcaLadderPlanRecord,
  orders: readonly OrderRecord[],
  tornActs: readonly TornFillAct[],
  fills: DcaFillInputs,
  positionId: string,
): FillPathView {
  const position = fills.positions.get(positionId);
  return reconcileFillPath({
    plan,
    orders,
    lots: position?.lots ?? [],
    tornActs,
    // Spread rather than assigned, so an unknown position leaves `currency` genuinely
    // ABSENT (the engine reads that as USD) instead of present-and-undefined.
    ...(position === undefined ? {} : { currency: position.currency }),
    ...(fills.reviewFx === undefined ? {} : { reviewFx: fills.reviewFx }),
  });
}

/**
 * One rung, narrowed. Identity, price and declared size always; the fill state ONLY when
 * an order actually joined to this rung.
 *
 * `sizeUsd` IS IN THE BASE, WITH THE DECLARED FACTS, not among the fill keys below. It is
 * what the operator wrote in the plans sidecar — knowable with nothing placed and unmoved
 * by anything the venue does — so a rung that has never been placed still carries it.
 *
 * THE `joinProvenance` TEST IS THE GATE, and it is the same question as "is there an
 * order": the engine assigns provenance exactly when one joined. A never-placed rung
 * therefore serializes to what v4 shipped plus its id, which is what makes the version
 * range honest — the same bytes mean the same thing on a v4 row and a v5 one.
 *
 * `orderPriceUsd` RIDES WITH THE MISMATCH FLAG and nowhere else. On a matching join it
 * would be a second copy of `priceUsd`, and two copies of one number is one of them
 * eventually being wrong.
 */
function toWireRung(rung: DcaRung, filled: FillPathRung | undefined): DcaWireRung {
  const base: DcaWireRung = {
    id: rung.id,
    priceUsd: rung.priceUsd,
    sizeUsd: rung.sizeUsd,
  };
  if (filled === undefined || filled.joinProvenance === undefined) {
    return base;
  }
  return {
    ...base,
    venueAxis: filled.venueAxis,
    bookAxis: filled.bookAxis,
    label: filled.label,
    joinProvenance: filled.joinProvenance,
    ...(filled.declaredPriceMismatch && filled.orderPriceUsd !== undefined
      ? { orderPriceUsd: filled.orderPriceUsd }
      : {}),
    declaredPriceMismatch: filled.declaredPriceMismatch,
    ...(filled.placedQuantity === undefined
      ? {}
      : { placedQuantity: filled.placedQuantity }),
    venueConsumedQuantity: filled.venueConsumedQuantity,
    bookedQuantity: filled.bookedQuantity,
    ...(filled.venueFilledFraction === undefined
      ? {}
      : { venueFilledFraction: filled.venueFilledFraction }),
    resting: filled.resting,
  };
}

/**
 * The figures, copied key-by-key rather than spread. A spread would carry whatever the
 * engine's `FillPathFigures` grows next straight into the JSONB — the exact drift class
 * `toProjectionReport` is built key-by-key to prevent, one level down.
 *
 * The three measured figures keep their ABSENCE. `undefined` is never written as a key:
 * a `{ deployedUsd: undefined }` serializes away in JSON but is visible to every
 * in-process reader, and the two would then disagree about what the row says.
 */
function toWireFigures(view: FillPathView): DcaWireFillFigures {
  const { deployedUsd, unitsAcquired, avgEntryUsd } = view.figures;
  return {
    ...(deployedUsd === undefined ? {} : { deployedUsd }),
    ...(unitsAcquired === undefined ? {} : { unitsAcquired }),
    ...(avgEntryUsd === undefined ? {} : { avgEntryUsd }),
    waitingDeclaredUsd: view.figures.waitingDeclaredUsd,
    waitingRestingUsd: view.figures.waitingRestingUsd,
  };
}
