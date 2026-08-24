import { Absent } from "@numisma/components";
import { formatUsd } from "@numisma/engine/format";
import type {
  ChangeSlot,
  FundValueSlot,
  ReserveSlot,
  SuppressionReason,
  Verdict,
} from "../glance/verdict.ts";
import { referenceLabel } from "../glance/verdict.ts";
import { Card } from "@numisma/components";
import {
  METRICS_FIGURE,
  METRICS_LIST,
  METRICS_ROW,
  METRICS_TERM,
  NEGATIVE,
  POSITIVE,
} from "./SummaryCard.tsx";

/**
 * THE CARD IS THE QUERY CONTAINER, not the viewport, so the glance lays itself out the
 * same whether the narrowness comes from a 320px phone or from a column it is dropped
 * into later. `.glance` said `container-type: inline-size; container-name: glance
 * metrics-card`, and BOTH NAMES ARE LOAD-BEARING, which is why this is two classes
 * rather than one.
 *
 * THE NAMED FORM WOULD HAVE COMPILED AND STRANDED THE LIST. Tailwind's `@container` with
 * a name attached emits the `container` SHORTHAND — `container: glance / inline-size` —
 * and the shorthand sets `container-name` to exactly what it is given. Naming this card
 * there drops `metrics-card`, the name slice 3 moved the metrics list's
 * `@[380px]/metrics-card:` variants onto. The list would then answer to a container that
 * no longer exists and sit at its narrow layout at every width — no missing rule, no
 * failing test, nothing to see in a diff. Verified in Chrome by binary-searching the
 * reflow width, which is the only channel that can see it.
 *
 * So the two properties are written separately: the BARE `@container` utility, which
 * emits `container-type: inline-size` and no name at all, and an arbitrary property for
 * the name pair. They set disjoint properties, so Tailwind's emitted order — which is
 * what actually resolves two utilities touching one property, not source order — has
 * nothing to resolve. The underscore is Tailwind's space in an arbitrary value.
 *
 * `glance` HAS NO QUERY TODAY and is kept anyway: it is the name for anything only this
 * card wants, and the whole hazard above is what dropping a name costs.
 */
const GLANCE_CONTAINER = "@container [container-name:glance_metrics-card]";

/**
 * THE VERDICT LINE — `.verdict`, and the two sign classes that ruled it.
 *
 * `margin: 0` on a `<p>` with preflight off is FOUR EDGES, not a formality: the UA's own
 * `1em` block margins are live, and `m-0` is the whole rule.
 *
 * `leading-tight` is the one default-scale class here and it is an exact match —
 * Tailwind's `--leading-tight` is `1.25`, the value the deleted rule set. The size,
 * weight and tracking have no exact scale entry (`text-2xl` is the right `1.5rem` but
 * drags its own paired line-height along), so they are read as arbitrary values.
 *
 * THE SIGN COLOURS ARE INVERTED AGAINST THE CLASS NAMES, deliberately and unchanged:
 * `.verdict-yes` — the arm where `needsYou` is true — was `var(--neg)`, and `.verdict-no`
 * was `var(--pos)`. "Yes, this needs you" is the alarming answer and it is painted the
 * alarming colour. The two constants below are the same strings `SummaryCard` exports
 * for its figures, so one spelling of a house colour serves both.
 */
const VERDICT = "m-0 text-[1.5rem] leading-tight font-[650] tracking-[-0.01em]";

/**
 * THE GLANCE (D1/D3) — a verdict sentence and a CLOSED SET of exactly three standing
 * numbers: fund value, change, Reserve %. Adding a fourth later costs a slot.
 *
 * It is judged on how fast and how confidently it delivers the *no* — the answer on
 * 22 of the fund's first 28 recorded days — so the verdict is the only thing above 20px and
 * it lands before the eye reaches the numbers.
 *
 * ALL THREE SLOTS ALWAYS RENDER. An empty slot already means *suppressed* (V1/D7); it
 * must not also mean "nothing to say", or the diagnostic value of an absence is
 * destroyed. An absent number renders as an em dash with its CAUSE beside it, so it
 * can never be misread as zero.
 *
 * VERDICT AND SLOT ARE NOT DUPLICATES. The verdict names the CONDITION ("Fund moved
 * more than 1.5% since Mon 13 Jul"); the slot carries the NUMBER ("▲1.83% vs Mon 13
 * Jul"). A firing `navMove` forces the Change slot's reference to its own — which
 * here is structural rather than enforced: both read the one reference the verdict
 * resolved.
 */
export function GlanceCard({ verdict }: { verdict: Verdict }) {
  return (
    <Card className={GLANCE_CONTAINER}>
      <p className={`${VERDICT} ${verdict.needsYou ? NEGATIVE : POSITIVE}`}>
        {verdict.sentence}
      </p>
      <p className="m-0 mt-1 text-[var(--muted)]">as of {referenceLabel(verdict.asOf)}</p>

      {/* THE SHARED LIST, AND THE SHARED BREAKPOINT WITH IT (spec #420 Seam B). These
          six strings come from `SummaryCard` because `.metrics` was one rule serving
          both cards and the migration keeps it one thing: the glance and the big
          picture stay one visual system, and they reflow at the same card width
          because they answer to the same container name. That container is now declared
          by the two classes above this component, and keeping its second name is the
          whole reason those are two classes. */}
      <dl className={METRICS_LIST}>
        <div className={METRICS_ROW}>
          <dt className={METRICS_TERM}>Fund value</dt>
          <dd className={METRICS_FIGURE}>
            <FundValue slot={verdict.slots.fundValue} />
          </dd>
        </div>
        <div className={METRICS_ROW}>
          <dt className={METRICS_TERM}>Change</dt>
          <dd className={METRICS_FIGURE}>
            <Change slot={verdict.slots.change} />
          </dd>
        </div>
        <div className={METRICS_ROW}>
          <dt className={METRICS_TERM}>Reserve</dt>
          <dd className={METRICS_FIGURE}>
            <Reserve slot={verdict.slots.reserve} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/**
 * Why a number is absent, in the operator's words. Every cause is NAMED: "the number
 * is missing" and "the number is missing BECAUSE the feed did not run" are different
 * amounts of information, and the second one is the whole reason suppression is
 * per-number instead of whole-page.
 */
const REASON_COPY: Record<SuppressionReason, string> = {
  "unexpected-absence": "no current mark",
  "no-policy": "no floor set",
  "no-earlier-anchor": "no earlier anchor",
  "reference-withheld": "reference withheld",
};

/**
 * The translation `Absent` deliberately does not do. The shared primitive takes words,
 * not this module's enum, so the vocabulary stays here with the view that owns it.
 * `undefined` falls through to the primitive's own default, which reads `suppressed` —
 * the arm this card rendered before the extraction, unchanged.
 */
function whyAbsent(reason: SuppressionReason | undefined): string | undefined {
  return reason ? REASON_COPY[reason] : undefined;
}

function FundValue({ slot }: { slot: FundValueSlot }) {
  if (!slot.rendered) return <Absent why={whyAbsent(slot.suppressedBy)} />;
  return <>{formatUsd(slot.usdValue!)}</>;
}

function Change({ slot }: { slot: ChangeSlot }) {
  if (!slot.rendered) {
    return (
      <>
        <Absent why={whyAbsent(slot.suppressedBy)} />
        {/* V3: never claim a date you don't have — but when a reference WAS
            resolved, name it even though the number is withheld. */}
        {slot.referenceLabel ? (
          <span className="m-0 text-[0.75rem] font-medium text-[var(--muted)]"> vs {slot.referenceLabel}</span>
        ) : null}
      </>
    );
  }
  const pct = slot.percent!;
  return (
    <>
      <span className={pct >= 0 ? POSITIVE : NEGATIVE}>
        {pct >= 0 ? "▲" : "▼"}
        {Math.abs(pct).toFixed(2)}%
      </span>
      {/* D4: always against a NAMED reference, always rendered — never a bare
          "today", and always the anchor actually landed on (V3). */}
      <span className="m-0 text-[0.75rem] font-medium text-[var(--muted)]"> vs {slot.referenceLabel}</span>
    </>
  );
}

function Reserve({ slot }: { slot: ReserveSlot }) {
  if (!slot.rendered) return <Absent why={whyAbsent(slot.suppressedBy)} />;
  return (
    <>
      {slot.percentOfFund!.toFixed(1)}%
      {/* C4: the wire says `target`, the UI says FLOOR. The divergence is
          deliberate — renaming would mean migrating an append-only sidecar. */}
      <span className="m-0 text-[0.75rem] font-medium text-[var(--muted)]"> floor {slot.floorPct}%</span>
    </>
  );
}
