import { Absent } from "@numisma/components";
import { Card } from "@numisma/components";
// The two sign colours, from the card that owns their deleted rule (spec #420 Seam B —
// a shared rule is converted by the first surface in the migration's order that carries
// it, wherever its other carriers render).
import { NEGATIVE, POSITIVE } from "./SummaryCard.tsx";
import type { CompositionRow, DashboardSection } from "@numisma/engine";
import { formatUsd, formatPercent } from "@numisma/engine/format";
import type {
  BigPictureView,
  RowAbsenceReason,
  RowDelta,
} from "../glance/row-view.ts";

/**
 * THE ESCAPE HATCH, AND THE ONE PLACE A SURFACE IS ALLOWED TO SCROLL SIDEWAYS
 * (spec #420 slice 4). Two components render a table — this one and the DCA card's rung
 * ladder — so the seven strings below are exported and imported rather than spelled
 * twice, the same way `SummaryCard.tsx` holds the metrics grid for its two carriers
 * (Seam B: a rule written once for two surfaces stays one thing).
 *
 * THE SCROLLER IS THE QUERY CONTAINER, not the card and not the viewport. The judgement
 * the breakpoint makes is about whether THIS TABLE has room, and the scroller is the box
 * that knows; it is also why the container needs no name of its own on either card.
 */
export const TABLE_SCROLL =
  "@container/table-scroll overflow-x-auto [-webkit-overflow-scrolling:touch]";

/**
 * AT 320px THE TABLE IS SIZED TO ITS CONTENT AND PANNED; above a 380px scroller it fits.
 *
 * Under a bare full width the table fits itself to the card first and overflows only
 * once even min-content will not go in, so the narrow reader got the worst of both: a
 * header broken across two lines, every cell wrapped to its tightest, AND a scrollbar
 * anyway. Sized to content, the cells are whole and the panning is the only cost. The
 * floor keeps a two-column table (the DCA card's) spanning its card rather than huddling
 * at the left. Above the phone there is enough width for the browser's own squeeze to
 * land on wrapped LABELS instead, and a table the eye takes in whole beats one it has to
 * pan.
 *
 * THE WIDE ARM IS A VARIANT, NOT A SECOND PLAIN UTILITY. Two unvariant utilities setting
 * the same property are resolved by Tailwind's emitted order rather than by the order
 * they are written in; the container variant raises specificity, so the wide arm wins
 * because it is a container query and not because of where it sits in the string.
 */
export const TABLE_SURFACE =
  "w-max min-w-full @[380px]/table-scroll:w-full border-collapse tabular-nums";

/**
 * The cell box both element rules carried: 8px/10px padding, a hairline under every row
 * including the header's, and the alignment. PREFLIGHT IS OFF, so the alignment is
 * written on every cell — a `th` the UA is left to itself centres, and the deleted rule
 * set `left` on both element types.
 *
 * The colour rides on the shorthand: only the bottom edge has a width, so declaring the
 * colour on four edges paints exactly one of them.
 */
const CELL_BOX = "px-[10px] py-2 border-b border-[var(--line)]";

/** A label cell. */
export const TABLE_CELL = `${CELL_BOX} text-left`;

/**
 * A figure cell. It does NOT also carry the left alignment: two unvariant `text-align`
 * utilities on one element are resolved by emitted order, so the right arm is the only
 * one written rather than an override hoping to win.
 */
export const TABLE_CELL_NUM = `${CELL_BOX} text-right`;

/** The header's own recessed, upper-cased, tracked-out treatment, over the same box. */
const HEAD_BOX = `${CELL_BOX} text-[var(--muted)] text-[0.78rem] uppercase tracking-[0.04em]`;

/** A header cell, and its figure-column twin. */
export const TABLE_HEAD_CELL = `${HEAD_BOX} text-left`;
export const TABLE_HEAD_CELL_NUM = `${HEAD_BOX} text-right`;

/**
 * One composition section, below the tap (PRD #146 D9/D4, slice #151).
 *
 * It renders five columns where it used to render three of the seven fields on the
 * wire: the label, the value, the percentage — and the two DELTAS, each against a
 * NAMED reference (D4). The reference names live in the column HEADERS, so each one
 * is stated once per table and never implied per cell; a bare "change" column with no
 * reference is precisely what D4 forbids.
 *
 * ABSENCE IS RENDERED, NOT HIDDEN, and that is the whole invariant one altitude down
 * from the glance header: *if I see a number, it is a correct one.* A suppressed row
 * keeps its label and its place in the ranking and shows an em dash with its cause —
 * it does NOT vanish (which would be indistinguishable from a position that was
 * closed) and it does NOT show a zero. Same mechanism, same em dash and same cause
 * copy as `GlanceCard`'s.
 */
export function SectionTable({
  section,
  view,
}: {
  section: DashboardSection;
  view: BigPictureView;
}) {
  return (
    <Card>
      <Card.Title>{section.title}</Card.Title>
      <div className={TABLE_SCROLL}>
        <table className={TABLE_SURFACE}>
          <thead>
            <tr>
              <th className={TABLE_HEAD_CELL}>Label</th>
              <th className={TABLE_HEAD_CELL_NUM}>USD value</th>
              <th className={TABLE_HEAD_CELL_NUM}>% of fund</th>
              {/* D4: the reference is RENDERED. When there is no earlier anchor the
                  column says so rather than falling back to an unnamed "change". */}
              <th className={TABLE_HEAD_CELL_NUM}>
                vs {view.reference?.label ?? <span className="m-0 mt-1 text-[var(--muted)]">no earlier anchor</span>}
              </th>
              <th className={TABLE_HEAD_CELL_NUM}>vs {view.costBasisLabel}</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <Row key={row.id} row={row} view={view} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Why a number is absent, in the operator's words — the row-altitude half of
 * `GlanceCard`'s `REASON_COPY`, sharing its two overlapping causes verbatim because
 * they ARE the same causes seen from a different altitude.
 */
const REASON_COPY: Record<RowAbsenceReason, string> = {
  "unexpected-absence": "no current mark",
  "reference-withheld": "reference withheld",
  "no-earlier-anchor": "no earlier anchor",
  "no-reference-row": "not held then",
  "no-cost-basis": "no cost basis",
  "no-fund-value": "fund value unavailable",
};

/**
 * The translation `Absent` deliberately does not do. The shared primitive takes words,
 * not this module's enum, so the row vocabulary stays here beside the table that owns it.
 * `undefined` falls through to the primitive's own default, which reads `suppressed`.
 */
function whyAbsent(reason: RowAbsenceReason | undefined): string | undefined {
  return reason ? REASON_COPY[reason] : undefined;
}

function Row({ row, view }: { row: CompositionRow; view: BigPictureView }) {
  const rowView = view.rows.get(row.id);

  // A row the view does not know about cannot be vouched for, so it is rendered as
  // absent rather than rendered as a number. It cannot happen — the view is built
  // from these very sections — and this is what it looks like if it ever does.
  if (!rowView || !rowView.rendered) {
    return (
      <tr className="row-suppressed">
        <td className={TABLE_CELL}>{row.label}</td>
        <td className={TABLE_CELL_NUM}>
          <Absent why={whyAbsent(rowView?.suppressedBy)} />
        </td>
        <td className={TABLE_CELL_NUM}>
          <Absent why={whyAbsent(rowView?.suppressedBy)} />
        </td>
        <td className={TABLE_CELL_NUM}>
          <Absent why={whyAbsent(rowView?.vsAnchor.suppressedBy)} />
        </td>
        <td className={TABLE_CELL_NUM}>
          <Absent why={whyAbsent(rowView?.vsCostBasis.suppressedBy)} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className={TABLE_CELL}>{row.label}</td>
      <td className={TABLE_CELL_NUM}>{formatUsd(row.usdValue)}</td>
      <td className={TABLE_CELL_NUM}>
        {/* NAV is the denominator of every percentage on the page, so this column
            stands or falls as one — see `row-view.ts`'s header. The cause is the
            PAGE's, not this row's: reaching here means the row itself rendered its
            value fine, and what is missing is the denominator. Naming the row's cause
            would be false of the majority of the rows that print it — on 2026-07-04,
            17 of 31 rows were suppressed and the other 14 rendered perfectly. */}
        {view.percentOfFundRendered ? (
          formatPercent(row.percentOfFund)
        ) : (
          <Absent why={whyAbsent("no-fund-value")} />
        )}
      </td>
      <td className={TABLE_CELL_NUM}>
        <Delta delta={rowView.vsAnchor} />
      </td>
      <td className={TABLE_CELL_NUM}>
        <Delta delta={rowView.vsCostBasis} />
      </td>
    </tr>
  );
}

/** A delta, signed and directional — or its named absence. */
function Delta({ delta }: { delta: RowDelta }) {
  if (!delta.rendered) return <Absent why={whyAbsent(delta.suppressedBy)} />;
  const usd = delta.usdValue!;
  return (
    <span className={usd >= 0 ? POSITIVE : NEGATIVE}>
      {usd >= 0 ? "▲" : "▼"}
      {formatUsd(Math.abs(usd))}
      {delta.percent === undefined ? null : (
        <span className="m-0 mt-1 text-[var(--muted)]"> {Math.abs(delta.percent).toFixed(2)}%</span>
      )}
    </span>
  );
}
