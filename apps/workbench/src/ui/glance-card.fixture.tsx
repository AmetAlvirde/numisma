import { GlanceCard } from "@numisma/components";
import {
  alarmingVerdict,
  fallingVerdict,
  risingVerdict,
  standingVerdict,
  unresolvedVerdict,
} from "@numisma/components/ui/glance-card.fixtures.ts";

/**
 * THE GLANCE, AND THE ONE COLOUR IT READS FOUR TIMES (spec #439 S3).
 *
 * `GlanceCard` performs exactly four colour reads and no name was minted for it: all
 * four are `--nms-muted-foreground`, which wave 1 already declared. The verdict line's
 * two sign colours are NOT among them — they arrive through `POSITIVE` and `NEGATIVE`,
 * which `SummaryCard` owns and S1 already rewrote, so neither string appears anywhere in
 * `glance-card.tsx`. A grep of that file that reports six reads has counted the two
 * mentions in a docblock explaining why the sign classes were inverted.
 *
 * ONE TOKEN MAKES THE THEMED-MODE CLAIM THIN, so this fixture answers the useful half
 * instead. "The token repaints" is satisfied by any single card; "every SITE that reads
 * it repaints" is the claim worth staging, and no single verdict can carry all four
 * reads at once — the Change slot's suppressed arm and its rendered arm are two branches
 * of one `if`. So the four bands below put all four sites on screen together:
 *
 *  1. the "as of" line, on every band;
 *  2. the suppressed Change's trailing reference, on `standing` and `alarming`;
 *  3. the rendered Change's trailing reference, on `rising` and `falling`;
 *  4. the Reserve `floor N%` suffix, on the first three bands.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through
 * the new spelling: `#9aa1ad` on all four sites, `#46c98b` on the settled verdict line
 * and on the ▲, `#f0736a` on the alarming verdict line and on the ▼.
 *
 * WHAT TO LOOK FOR IN THEMED MODE: all four sites move to `#5c7cff` together. One that
 * stays grey is a read that never crossed, and the "as of" line is the one to check
 * last — it is the only site that renders on every band, so a stale read there is the
 * easiest to mistake for a correct one somewhere else.
 *
 * IN GRAYSCALE the card is reviewed on hierarchy and spacing: the verdict must land
 * before the eye reaches the numbers, and sign is deliberately not reviewable.
 *
 * SYNTHESIZED. Every date, figure and sentence comes from `glance-card.fixtures.ts`, the
 * same literals the package's structure test renders. No ledger output has been near
 * them, and this fixture imports nothing from `apps/web`.
 */

/** A titled band, so a mode switch is read one state at a time. */
function Row({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <p className="mb-3 text-xs text-foreground/60">{note}</p>
      <div className="max-w-[420px]">{children}</div>
    </section>
  );
}

export default {
  "the four reads": (
    <div>
      <Row
        title="standing — the settled verdict, and a withheld Change that still names its date"
        note="Reads 1, 2 and 4 at once. The verdict line takes --nms-pos; the Change slot prints an em dash with `reference withheld` beside it and STILL renders `vs Mon 5 Jan`, because V3 is about the date, not the number."
      >
        <GlanceCard verdict={standingVerdict()} />
      </Row>
      <Row
        title="alarming — the arm that needs the operator"
        note="The same three reads, with the verdict line on --nms-neg. Inverted against the class names that are gone: `.verdict-yes` was the alarming colour, and the alarming answer still gets it."
      >
        <GlanceCard verdict={alarmingVerdict()} />
      </Row>
      <Row
        title="rising — a rendered Change, up"
        note="Read 3, which no other band shows: the rendered arm's own `vs Mon 5 Jan` span. The ▲ takes --nms-pos from `POSITIVE`, which this card imports and never decides."
      >
        <GlanceCard verdict={risingVerdict()} />
      </Row>
      <Row
        title="falling — the same slot, down"
        note="The ▼ on --nms-neg, and read 3 again beside it. Both signs on one slot are two arms of one ternary, so two bands are what puts them on screen together."
      >
        <GlanceCard verdict={fallingVerdict()} />
      </Row>
      <Row
        title="unresolved — the three causes the bands above do not carry"
        note="All three slots suppressed, one cause each: `no current mark`, `no earlier anchor`, `no floor set`. With `SuppressionReason`'s fourth member on the first two bands, every cause reaches the operator's words somewhere here. The genesis Change has NO reference to name, so its trailing span does not render at all and the em dash stands alone — which is also the only band without read 4."
      >
        <GlanceCard verdict={unresolvedVerdict()} />
      </Row>
    </div>
  ),
};
