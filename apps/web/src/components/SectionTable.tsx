import type { CompositionRow, DashboardSection } from "@numisma/engine";
import { formatUsd, formatPercent } from "@numisma/engine/format";
import type {
  BigPictureView,
  RowAbsenceReason,
  RowDelta,
} from "../glance/row-view.ts";

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
    <section className="card">
      <h2>{section.title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th className="num">USD value</th>
              <th className="num">% of fund</th>
              {/* D4: the reference is RENDERED. When there is no earlier anchor the
                  column says so rather than falling back to an unnamed "change". */}
              <th className="num">
                vs {view.reference?.label ?? <span className="muted">no earlier anchor</span>}
              </th>
              <th className="num">vs {view.costBasisLabel}</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <Row key={row.id} row={row} view={view} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
};

/** An em dash is not a zero — and the cause says which absence this is. */
function Absent({ reason }: { reason: RowAbsenceReason | undefined }) {
  return (
    <span className="absent">
      <span aria-hidden="true">—</span>
      <span className="muted absent-why">
        {reason ? REASON_COPY[reason] : "suppressed"}
      </span>
    </span>
  );
}

function Row({ row, view }: { row: CompositionRow; view: BigPictureView }) {
  const rowView = view.rows.get(row.id);

  // A row the view does not know about cannot be vouched for, so it is rendered as
  // absent rather than rendered as a number. It cannot happen — the view is built
  // from these very sections — and this is what it looks like if it ever does.
  if (!rowView || !rowView.rendered) {
    return (
      <tr className="row-suppressed">
        <td>{row.label}</td>
        <td className="num">
          <Absent reason={rowView?.suppressedBy} />
        </td>
        <td className="num">
          <Absent reason={rowView?.suppressedBy} />
        </td>
        <td className="num">
          <Absent reason={rowView?.vsAnchor.suppressedBy} />
        </td>
        <td className="num">
          <Absent reason={rowView?.vsCostBasis.suppressedBy} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{row.label}</td>
      <td className="num">{formatUsd(row.usdValue)}</td>
      <td className="num">
        {/* NAV is the denominator of every percentage on the page, so this column
            stands or falls as one — see `row-view.ts`'s header. */}
        {view.percentOfFundRendered ? (
          formatPercent(row.percentOfFund)
        ) : (
          <Absent reason="unexpected-absence" />
        )}
      </td>
      <td className="num">
        <Delta delta={rowView.vsAnchor} />
      </td>
      <td className="num">
        <Delta delta={rowView.vsCostBasis} />
      </td>
    </tr>
  );
}

/** A delta, signed and directional — or its named absence. */
function Delta({ delta }: { delta: RowDelta }) {
  if (!delta.rendered) return <Absent reason={delta.suppressedBy} />;
  const usd = delta.usdValue!;
  return (
    <span className={usd >= 0 ? "pos" : "neg"}>
      {usd >= 0 ? "▲" : "▼"}
      {formatUsd(Math.abs(usd))}
      {delta.percent === undefined ? null : (
        <span className="muted"> {Math.abs(delta.percent).toFixed(2)}%</span>
      )}
    </span>
  );
}
