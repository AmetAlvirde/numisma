// THE ENGINE'S ROOT IS TYPE-IMPORTED AND IT IS WRITTEN FIRST, the shape
// `summary-card.tsx` established. `route-move.test.ts` holds this package to the
// engine's pure subpaths at RUNTIME and exempts the root for a type-only import, which
// erases before any bundle; its scan is a lazy multi-line match, so a runtime subpath
// read written above the type-only root read is what it reports. Order, not depth — but
// the file keeps the order anyway rather than making a guard argue about it.
import type { CompositionRow, DashboardSection } from "@numisma/engine";
import { formatUsd, formatPercent } from "@numisma/engine/format";
import { Absent } from "./absent";
import { Card } from "./card";
// The two sign colours, from the card that owns their deleted rule (spec #420 Seam B —
// a shared rule is converted by the first surface in the migration's order that carries
// it, wherever its other carriers render). A sibling now rather than a package
// specifier: both files are inside `@numisma/components` since spec #439 S1.
import { NEGATIVE, POSITIVE } from "./summary-card";

/**
 * WHY A ROW, OR ONE OF ITS DELTAS, IS ABSENT — and why this enum is DECLARED HERE
 * rather than imported from the module that computes it (spec #439 §4.1).
 *
 * THE CONSUMER DEFINES THE INTERFACE. `apps/web/src/glance/row-view.ts` keeps every
 * line of `composeBigPicture` and imports these four names back from this package.
 * That is the standard direction, and here it is also the only one that lets a cosmos
 * fixture build a `BigPictureView` literal without importing `apps/web`, which
 * `seam-isolation.test.ts` forbids outright.
 *
 * IT DOES NOT DRIFT, AND THAT IS A PROPERTY OF THE ARRANGEMENT rather than a promise.
 * `composeBigPicture` RETURNS this type, so every field is written back into it by an
 * assignment on the app side: add a cause here and the exhaustive `REASON_COPY` below
 * stops compiling; add one there and the assignment does. A structural duplicate — two
 * copies of the same shape, each declared where it is used — is the arrangement that
 * would drift silently, and it is exactly what this is not.
 *
 * Every absence NAMES its cause, exactly as the header's does: "the number is missing"
 * and "the number is missing BECAUSE the feed did not run" are different amounts of
 * information.
 *
 * `unexpected-absence` and `reference-withheld` are deliberately the same words the
 * header uses (`SuppressionReason` in `verdict.ts`) — the same cause at a different
 * altitude, not a parallel vocabulary. The two that are new are genuinely new:
 * `no-cost-basis` is a reference this row never had, and `no-reference-row` is a row
 * the reference anchor never had.
 *
 * `no-fund-value` is the PAGE-LEVEL cause, and it is the only one here that is not
 * about the row. A `% of fund` cell in a row whose own mark arrived perfectly well is
 * blank because the DENOMINATOR is missing, not because the row is.
 */
export type RowAbsenceReason =
  | "unexpected-absence"
  | "reference-withheld"
  | "no-earlier-anchor"
  | "no-reference-row"
  | "no-cost-basis"
  | "no-fund-value";

/** A delta that renders, or an absence that names its cause. */
export interface RowDelta {
  rendered: boolean;
  /** The difference in USD against the reference. */
  usdValue?: number;
  /** The same difference as a percentage OF THE REFERENCE. */
  percent?: number;
  suppressedBy?: RowAbsenceReason;
}

/**
 * One composition row's renderability and its two deltas.
 *
 * IT REACHES THIS COMPONENT ONLY THROUGH {@link BigPictureView.rows}; nothing in this
 * file names it in an import. It is declared here anyway because the closure of what
 * the prop type drags along is four names, not the three the component mentions, and a
 * package that declared only the mentioned three would leave the app declaring one
 * interface and this file declaring the rest.
 */
export interface RowView {
  /** False when the push named this row in `glance.suppressed` (slice #151). */
  rendered: boolean;
  suppressedBy?: RowAbsenceReason;
  /** Against the resolved anchor date. */
  vsAnchor: RowDelta;
  /** Against the row's own cost basis. */
  vsCostBasis: RowDelta;
}

/** Everything `/big-picture` renders its composition tables from. */
export interface BigPictureView {
  /**
   * The date reference, named. Absent only on the genesis anchor — and then the
   * surface says nothing rather than inventing one: never claim a date you don't
   * have (V3).
   *
   * OPTIONAL, AND `exactOptionalPropertyTypes` IS ON IN THIS PACKAGE. The genesis arm
   * is built by destructuring `reference` OUT, never by setting it to `undefined`, on
   * both sides of the boundary.
   */
  reference?: { asOf: string; label: string };
  /** The other reference kind's name. A constant, but it is RENDERED, not implied. */
  costBasisLabel: string;
  /** False when NAV is suppressed — see `row-view.ts`'s header. */
  percentOfFundRendered: boolean;
  /**
   * False when NAV is suppressed — the SLOT this time, not the column.
   *
   * A SIBLING of {@link BigPictureView.percentOfFundRendered}, never a synonym: they
   * read the same key today by coincidence of cause, not of meaning. One governs the
   * fund value itself, the other a column of ratios that merely share its denominator.
   */
  fundValueRendered: boolean;
  /**
   * Keyed by `CompositionRow.id`, one entry per row the anchor carries.
   *
   * A `ReadonlyMap` AND NOT A RECORD, which is the one shape a fixture author has to
   * get right: an object literal typechecks against nothing here, so the failure is a
   * fixture that will not compile rather than a table that renders wrong.
   */
  rows: ReadonlyMap<string, RowView>;
}

/**
 * THE ESCAPE HATCH, AND THE ONE PLACE A SURFACE IS ALLOWED TO SCROLL SIDEWAYS
 * (spec #420 slice 4). Two components render a table — this one and the DCA card's rung
 * ladder — so the six strings below are exported and imported rather than spelled
 * twice, the same way `summary-card.tsx` holds the metrics grid for its two carriers
 * (Seam B: a rule written once for two surfaces stays one thing). SIX, not the seven
 * this sentence used to claim: `CELL_BOX` and `HEAD_BOX` are private and composed into
 * four of the six.
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
const CELL_BOX = "px-[10px] py-2 border-b border-[var(--nms-border)]";

/** A label cell. */
export const TABLE_CELL = `${CELL_BOX} text-left`;

/**
 * A figure cell. It does NOT also carry the left alignment: two unvariant `text-align`
 * utilities on one element are resolved by emitted order, so the right arm is the only
 * one written rather than an override hoping to win.
 */
export const TABLE_CELL_NUM = `${CELL_BOX} text-right`;

/** The header's own recessed, upper-cased, tracked-out treatment, over the same box. */
const HEAD_BOX = `${CELL_BOX} text-[var(--nms-muted-foreground)] text-[0.78rem] uppercase tracking-[0.04em]`;

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
                vs {view.reference?.label ?? <span className="m-0 mt-1 text-[var(--nms-muted-foreground)]">no earlier anchor</span>}
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
        <span className="m-0 mt-1 text-[var(--nms-muted-foreground)]"> {Math.abs(delta.percent).toFixed(2)}%</span>
      )}
    </span>
  );
}
