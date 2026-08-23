import type { DashboardSummary } from "@numisma/engine";
import { formatUsd, formatSignedPercent } from "@numisma/engine/format";
import { Absent } from "./ui/Absent.tsx";
import { Card } from "./ui/Card.tsx";

/**
 * The one cause that can reach this card, stated rather than passed. `Absent` takes the
 * words and never a reason enum, and there is exactly one absence here to name: the fund
 * value is withheld exactly when the marks it is summed from did not arrive. The badge
 * below spells the same cause from the same constant, because one cause named two ways
 * would read as two.
 */
const NO_MARK = "no current mark";

/**
 * THE STANDING NUMBERS, PHONE FIRST — `.metrics` and its `@container` arm, as utilities
 * (spec #420 slice 3). Exported because the glance card renders the same list and the
 * rule was written once on purpose; two copies of this string would be two things to
 * keep in step, which is exactly what the shared selector was avoiding.
 *
 * ONE COLUMN OF DATA ROWS AT 320px — label left, figure hard right, one line each — and a
 * real grid of tiles once the CARD is wide enough. The card is the query container, not
 * the viewport, so a glance dropped into a narrow column later lays itself out the same
 * way a phone gets. `metrics-card` is the name both cards' containers carry, and it
 * survives the conversion for that reason.
 *
 * `m-0 mt-4` IS NOT `mt-4`. Preflight is off, so the UA's `<dl>` margin is live on all
 * four edges and the deleted rule set three of them to zero.
 */
export const METRICS_LIST =
  "grid grid-cols-1 gap-2 m-0 mt-4 @[380px]/metrics-card:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] @[380px]/metrics-card:gap-3";

/**
 * A GRID, NOT A FLEX ROW, AND THE VALUE IS THE HALF THAT GIVES. Every figure carries a
 * trailing reference in the same `<dd>` — `vs Sun 9 Aug`, `floor 10%`, or an absence
 * cause — so a value is a phrase, not a number, and sizing it to content crushed
 * `Change` to 30px and printed its own label through it. Terms sized to content, values
 * take the remainder and wrap inside it, still against the right rail. Above the
 * breakpoint the row stops being a grid at all and the tile stacks.
 */
export const METRICS_ROW =
  "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-[10px] @[380px]/metrics-card:block";

/** The label. */
export const METRICS_TERM = "text-[var(--muted)] text-[0.8rem]";

/**
 * The figure: right against the rail at 320px, left under its label above the
 * breakpoint, and `tabular-nums` at both so all three run down one axis.
 */
export const METRICS_FIGURE =
  "m-0 text-[1.15rem] font-semibold tabular-nums text-right @[380px]/metrics-card:mt-[2px] @[380px]/metrics-card:text-left";

/** The positive and negative sign colours, the file's two shared one-declaration rules. */
export const POSITIVE = "text-[var(--pos)]";
export const NEGATIVE = "text-[var(--neg)]";

/**
 * A BADGE IS A WORD, AND A WORD THAT BREAKS STOPS READING AS A CHIP — which is why the
 * `nowrap` is in the base string and the ONE placement that overrides it does so through
 * an element-scoped variant rather than a second plain utility.
 *
 * Two unvariant `white-space` utilities on one element are resolved by Tailwind's emitted
 * order, which is a property of the framework's sort and not of the order they are
 * written in; `[header_&]:` compiles to a descendant selector that outranks the base on
 * specificity, so the override is decided by the cascade rule it means. It keys off the
 * ELEMENT because the class it used to key off (`.summary-head`) is what this slice
 * deletes, and the summary head is a `<header>` — the same substitution `ui/Absent.tsx`
 * makes with `[dd_&]`. Measured: this string renders in no other `<header>` in the app.
 */
const BADGE =
  "inline-block rounded-[999px] px-[10px] py-1 text-[0.78rem] font-semibold whitespace-nowrap [header_&]:flex-initial [header_&]:whitespace-normal";

/**
 * Read-only summary card. `usdMxn` comes from `totals` (the authoritative
 * fund-level FX rate) per the field mapping.
 *
 * IT CONSULTS THE SUPPRESSION LIST, via `fundValueRendered`, and it must: suppression
 * is a KEY LIST and the suppressed number stays on the wire, so a renderer that does
 * not ask prints it. This card sits directly ABOVE tables that do ask — on a day when
 * every mark is missing, an unguarded card shows a fund value beside a page of em
 * dashes, which reads as the tables being broken rather than the NAV being unknown.
 *
 * The unrealized P&L is withheld by the SAME fact, and deliberately so. It carries no
 * suppression key of its own — nothing upstream could ever withhold it — and it
 * divides by the very NAV being withheld, so rendering it would hand back a wrong
 * numerator over a wrong denominator, and hand back the NAV by inference besides.
 * NAV suppressed ⟹ marks absent ⟹ P&L unsafe, derived here rather than shipped.
 */
export function SummaryCard({
  summary,
  usdMxn,
  fundValueRendered,
}: {
  summary: DashboardSummary;
  usdMxn: number;
  /** False when the push named `summary.fundValueUsd` in `glance.suppressed`. */
  fundValueRendered: boolean;
}) {
  const safety = summary.dataSafety;
  const clean =
    safety.nonLiveExcluded === 0 &&
    safety.invalidExcluded === 0 &&
    safety.shortDeferredExcluded === 0 &&
    !safety.hasWarnings;

  const pnl = summary.totalUnrealizedPnlUsd;
  const pnlPct =
    summary.fundValueUsd > 0 ? (pnl / summary.fundValueUsd) * 100 : 0;

  return (
    // `container-name: summary metrics-card` loses its first name here and keeps its
    // second. Nothing ever queried `summary`; `metrics-card` is what the list below
    // and the glance card's identical list both answer to, and a Tailwind container
    // utility names one container, so the unused half is dropped rather than spelled
    // as an arbitrary property.
    <Card className="@container/metrics-card">
      {/* Fund name left, the data-safety badge hard right. `flex-wrap` and a shrinkable
          title block are what keep the pair on the card at 320px: the warn badge's text
          is a joined list of causes (`⚠ no current mark · 3 non-live`) and there is no
          width at which that is a pill-shaped word. */}
      <header className="flex flex-wrap justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* THE PAGE'S ONE `<h1>`, and the reason `Card.Title` takes a level at all:
              only this call site knows that this card's heading IS `/big-picture`'s
              title rather than a section heading beneath one. */}
          <Card.Title level={1}>{summary.fundName}</Card.Title>
          <p className="m-0 mt-1 text-[var(--muted)]">as of {summary.asOf}</p>
        </div>
        <DataSafetyBadge
          clean={clean}
          safety={safety}
          fundValueRendered={fundValueRendered}
        />
      </header>

      <dl className={METRICS_LIST}>
        <div className={METRICS_ROW}>
          <dt className={METRICS_TERM}>Fund value</dt>
          <dd className={METRICS_FIGURE}>
            {fundValueRendered ? (
              formatUsd(summary.fundValueUsd)
            ) : (
              <Absent why={NO_MARK} />
            )}
          </dd>
        </div>
        <div className={METRICS_ROW}>
          {/* NOT gated: the FX rate comes from `totals` and does not descend from a
              mark, so an absent mark leaves it perfectly good. Blacking out the whole
              card would be the whole-page blackout that per-key suppression exists to
              avoid. */}
          <dt className={METRICS_TERM}>USD/MXN</dt>
          <dd className={METRICS_FIGURE}>{usdMxn.toFixed(2)}</dd>
        </div>
        <div className={METRICS_ROW}>
          <dt className={METRICS_TERM}>Unrealized P&amp;L</dt>
          {fundValueRendered ? (
            <dd className={`${METRICS_FIGURE} ${pnl >= 0 ? POSITIVE : NEGATIVE}`}>
              {formatUsd(pnl)} ({formatSignedPercent(pnlPct)})
            </dd>
          ) : (
            <dd className={METRICS_FIGURE}>
              <Absent why={NO_MARK} />
            </dd>
          )}
        </div>
      </dl>
    </Card>
  );
}

/**
 * TWO CAUSES, ONE BADGE, AND THEY ARE JOINED ONLY HERE. `clean` answers *did the
 * fold exclude any records?*; `fundValueRendered` answers *did the marks arrive?*
 * Those are genuinely different questions, and they stay apart upstream — folding
 * mark-absence into `dataSafety` would destroy the distinction that makes either
 * useful. But a badge is an ASSERTION, and this one is the card's only global one,
 * so it is the one place that has to speak for both: a green `Data OK` above `Fund
 * value — no current mark` certifies data the same card refuses to state.
 *
 * Mark absence folds into the existing warn state rather than earning a third
 * visual state, because a third colour costs a vocabulary the card does not
 * otherwise need. The causes stay distinguishable where distinctions belong — in
 * the TEXT, which names each one.
 */
function DataSafetyBadge({
  clean,
  safety,
  fundValueRendered,
}: {
  clean: boolean;
  safety: DashboardSummary["dataSafety"];
  fundValueRendered: boolean;
}) {
  if (clean && fundValueRendered) {
    return (
      <span className={`${BADGE} bg-[var(--ok)] text-white`}>Data OK</span>
    );
  }
  const parts: string[] = [];
  if (safety.nonLiveExcluded > 0) {
    parts.push(`${safety.nonLiveExcluded} non-live`);
  }
  if (safety.invalidExcluded > 0) {
    parts.push(`${safety.invalidExcluded} invalid`);
  }
  if (safety.shortDeferredExcluded > 0) {
    parts.push(`${safety.shortDeferredExcluded} short-deferred`);
  }
  if (safety.hasWarnings && parts.length === 0) {
    parts.push("warnings");
  }
  // Last, so the `hasWarnings` fallback above is still judged on the exclusion
  // counts alone — and first in the text, because this is the cause that explains
  // the em dashes directly beneath. The words are the em dashes' own, deliberately:
  // one cause named two ways would read as two.
  if (!fundValueRendered) {
    parts.unshift(NO_MARK);
  }
  return (
    <span
      className={`${BADGE} bg-[var(--warn)] text-white`}
      title="Withheld or excluded data"
    >
      ⚠ {parts.join(" · ")}
    </span>
  );
}
