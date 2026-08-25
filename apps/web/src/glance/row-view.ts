/**
 * BELOW THE TAP (PRD #146 D9/D4, slice #151) — the pure module `/big-picture` renders
 * from: which composition rows may show a number, and what each row's number is
 * compared against.
 *
 * PURE, for the same reason `verdict.ts` is: no IO, no clock, no database. It reads
 * the wire and nothing else, which is what lets the cases real history does not
 * contain be exercised at all. It sits beside the verdict module because it obeys the
 * same boundary rule — *does this computation need data D8 keeps off the wire?* The
 * per-row dependency map does, so the PUSH computes it and ships a list of row ids
 * (`glance.suppressed`); everything here is that list plus arithmetic over numbers
 * already on the wire.
 *
 * ── ONE FEATURE, TWO REFERENCE KINDS (D4) ───────────────────────────────────────
 * A delta is a number against a NAMED reference, and there are exactly two kinds of
 * reference:
 *
 *  - AN ANCHOR DATE — resolved by {@link resolveReferenceAnchor}, i.e. the same
 *    reference the Change slot names, so the header and the table can never claim
 *    different days;
 *  - COST BASIS — the row's own `costBasisUsd`, already on the wire.
 *
 * That is what unifies unrealized P&L with a period change instead of building two
 * features, and it is why YoY / MoM / vs-weekly-close is a different reference rather
 * than a rewrite. The reference is ALWAYS rendered and NEVER implied: there is no
 * bare "today" anywhere in this module.
 *
 * ── WHAT IS DELIBERATELY *NOT* PER-ROW ──────────────────────────────────────────
 * `percentOfFund` has NAV in its denominator, so an unexpected mark absence anywhere
 * makes EVERY row's percentage wrong — including rows whose own value is untouched.
 * That is D7's corrected illustration (the one the spec had to fix, because Reserve %
 * is a ratio whose denominator is NAV) applied one altitude down. So the value column
 * survives per-row and the percentage column does not survive at all:
 * {@link BigPictureView.percentOfFundRendered} is a page-level fact.
 *
 * The NAV ITSELF is the second page-level fact ({@link BigPictureView.fundValueRendered}),
 * and it is what the summary card above the tables renders. Suppression is a KEY
 * LIST — `toProjectionReport` copies `dashboard` wholesale, so the suppressed number
 * is still sitting on the wire — which means a renderer that does not consult the
 * list prints it. The unrealized P&L goes with it: it has no suppression key of its
 * own and divides BY that NAV, so an unguarded card shows a wrong numerator over a
 * wrong denominator. Both are derivable here from the key list, so the reader derives
 * them rather than the push shipping a key it would have to version.
 */
import type { CompositionRow } from "@numisma/engine";
// The header keys are read from their one declared home, never re-spelled here — see
// the {@link SUPPRESSION_KEYS} docstring in `../projection/contract.ts` for why.
import {
  SUPPRESSION_KEYS,
  type SnapshotAnchor,
} from "../projection/contract.ts";
import { referenceLabel, resolveReferenceAnchor } from "./verdict.ts";

/**
 * THE VIEW TYPES ARE THE PACKAGE'S, AND THIS MODULE IMPORTS ITS OWN RETURN TYPE BACK
 * (spec #439 §4.1, S2). `BigPictureView` and its three-name closure used to be declared
 * here; they are declared in `@numisma/components`'s `ui/section-table.tsx` now, beside
 * the component that renders them.
 *
 * THE CONSUMER DEFINES THE INTERFACE, which is the standard direction and also the only
 * one that lets a cosmos fixture build a `BigPictureView` literal without importing
 * `apps/web` — `seam-isolation.test.ts` forbids that outright. Every line of
 * `composeBigPicture` stays here, and nothing about what it emits changed.
 *
 * IT IS NOT A COPY WAITING TO DRIFT, because the arrow points both ways: this function
 * RETURNS the package's type, so a field added on either side stops compiling at the
 * assignments below rather than diverging silently. These four names are imported and
 * NOT re-exported — the table and its structure test were their only readers, and both
 * are on the package side now.
 */
import type {
  BigPictureView,
  RowAbsenceReason,
  RowDelta,
  RowView,
} from "@numisma/components";

/** The label the cost-basis reference renders under. */
export const COST_BASIS_LABEL = "cost basis";

/** An absence, with its cause — the only way this module says "no number". */
function absent(suppressedBy: RowAbsenceReason): RowDelta {
  return { rendered: false, suppressedBy };
}

/**
 * A delta against `from`. Guards a zero reference rather than emitting `Infinity`:
 * a percentage against nothing is not a number a surface may show.
 */
function delta(usdValue: number, from: number): RowDelta {
  const difference = usdValue - from;
  return from === 0
    ? { rendered: true, usdValue: difference }
    : { rendered: true, usdValue: difference, percent: (usdValue / from - 1) * 100 };
}

/**
 * Compose everything `/big-picture` needs for `latest`, against the anchor history.
 *
 * `anchors` is the whole history as `getSnapshotHistory` returns it; the reference is
 * resolved through the verdict module's own resolver, so the Change slot above the
 * table and the deltas inside it always name the same day.
 */
export function composeBigPicture(
  latest: SnapshotAnchor,
  anchors: readonly SnapshotAnchor[],
): BigPictureView {
  const suppressed = new Set(latest.report.glance.suppressed);
  const reference = resolveReferenceAnchor(anchors, latest);
  const referenceRows = new Map<string, CompositionRow>(
    (reference?.report.dashboard.sections ?? []).flatMap((section) =>
      section.rows.map((row) => [row.id, row] as const),
    ),
  );
  const referenceSuppressed = new Set(reference?.report.glance.suppressed ?? []);

  const rows = new Map<string, RowView>();
  for (const section of latest.report.dashboard.sections) {
    for (const row of section.rows) {
      rows.set(
        row.id,
        suppressed.has(row.id)
          ? {
              // A suppressed row leaks NOTHING — not its value, and not a delta
              // computed from its value. Rendering the delta of a number the surface
              // refuses to show would hand back the number by subtraction.
              rendered: false,
              suppressedBy: "unexpected-absence",
              vsAnchor: absent("unexpected-absence"),
              vsCostBasis: absent("unexpected-absence"),
            }
          : {
              rendered: true,
              vsAnchor: anchorDelta(row, reference, referenceRows, referenceSuppressed),
              vsCostBasis: costBasisDelta(row),
            },
      );
    }
  }

  return {
    ...(reference === undefined
      ? {}
      : { reference: { asOf: reference.asOf, label: referenceLabel(reference.asOf) } }),
    costBasisLabel: COST_BASIS_LABEL,
    // See the header: the percentage descends from NAV for EVERY row, so it is a
    // page-level absence rather than a per-row one.
    percentOfFundRendered: !suppressed.has(SUPPRESSION_KEYS.fundValue),
    fundValueRendered: !suppressed.has(SUPPRESSION_KEYS.fundValue),
    rows,
  };
}

/**
 * The date-reference delta, with its three causes of absence checked in the order
 * they invalidate — mirroring the Change slot's own ordering in `verdict.ts`.
 *
 * The middle one is COMPOSITION RULE 1 AT ROW ALTITUDE, and it falls out of the same
 * two decisions the header's did: the row is fine today, but the surface will not
 * show the number it would be compared against, so it declines to compare. Note it is
 * checked PER ROW, not against the reference anchor's header: a reference whose NAV
 * was suppressed still holds perfectly good values for the rows that did not depend
 * on the absent mark, and refusing those would be the whole-page blackout per-row
 * suppression exists to avoid.
 */
function anchorDelta(
  row: CompositionRow,
  reference: SnapshotAnchor | undefined,
  referenceRows: ReadonlyMap<string, CompositionRow>,
  referenceSuppressed: ReadonlySet<string>,
): RowDelta {
  if (reference === undefined) return absent("no-earlier-anchor");
  if (referenceSuppressed.has(row.id)) return absent("reference-withheld");
  const before = referenceRows.get(row.id);
  // A row the reference anchor never had — a position opened since, or a grouping
  // that did not exist. There is no honest comparison, and "vs zero" would render a
  // spurious +100%.
  if (before === undefined) return absent("no-reference-row");
  return delta(row.usdValue, before.usdValue);
}

/**
 * The cost-basis delta. A row without a cost basis suppresses THIS DELTA ALONE —
 * handled the way every other missing input is handled, per the spec's carried open
 * question.
 *
 * It is not a hypothetical: measured across every anchor, six rows carry neither a
 * cost basis nor a P&L (`instrument:reserve`, `tempo:Reserve`, `tempo:Foresight` and
 * three cash accounts), because they hold nothing but cash and the engine omits a key
 * whose sum is exactly zero. One more (`tier:c3`) carries a cost basis with no P&L
 * beside it — which is why this is computed from `usdValue - costBasisUsd` rather
 * than read off `unrealizedPnlUsd`: the delta is defined by its REFERENCE, and the
 * reference here is the cost basis.
 */
function costBasisDelta(row: CompositionRow): RowDelta {
  if (row.costBasisUsd === undefined) return absent("no-cost-basis");
  return delta(row.usdValue, row.costBasisUsd);
}
