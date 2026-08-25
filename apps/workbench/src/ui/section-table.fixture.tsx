import { SectionTable } from "@numisma/components";
import {
  anchoredView,
  anchorlessView,
  section,
} from "@numisma/components/ui/section-table.fixtures.ts";

/**
 * THE COMPOSITION TABLE, AND THE FOUR COLOURS IT READS (spec #439 S2).
 *
 * `SectionTable` performs exactly four colour reads and no name was minted for it:
 * `--nms-border` once on the cell hairline, and `--nms-muted-foreground` three times —
 * the column headings, the "no earlier anchor" span inside the anchor column's header,
 * and the percentage suffix inside a rendered delta. The two sign colours on the deltas
 * are NOT among them: they arrive through `POSITIVE` and `NEGATIVE`, which `SummaryCard`
 * owns and S1 already rewrote, so the strings appear nowhere in `section-table.tsx`.
 *
 * `--muted` MAPS TO `--nms-muted-foreground` AND NEVER TO `--nms-muted`. Both names are
 * declared, so the wrong one passes the namespace guard, passes the package's own
 * `tokens.test.ts`, emits a real rule, and paints a recessed-surface grey as type colour
 * on every column heading in the app. No guard in the repo can see that. This fixture and
 * the slice brief's enumeration are the whole instrument for it.
 *
 * TWO ARMS, AND BOTH ARE NEEDED. The anchored one shows three of the four reads and both
 * sign colours; the genesis one is the ONLY place read 3 renders at all, because the
 * moved structure test never pins that span's class string.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through the
 * new spellings: `#262a33` hairlines under every row including the header's, `#9aa1ad` on
 * the five column headings and on the percentage suffix, `#46c98b` on the up delta and
 * `#f0736a` on the down one.
 *
 * WHAT TO LOOK FOR IN THEMED MODE: all four move, and THE HAIRLINE IS THE ONE TO WATCH.
 * It is a border rather than a fill or a type colour, and a border that stays put while
 * the header type recolours means read 1 is dead and read 2 is live — a distinction no
 * guard in the repo can draw.
 *
 * SYNTHESIZED. `Portfolios`, `Alpha` and `Beta` are authored placeholders from
 * `section-table.fixtures.ts`, the same literals the package's structure test renders. No
 * ledger output has been near them, and this fixture imports nothing from `apps/web`.
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
      <div className="max-w-[560px]">{children}</div>
    </section>
  );
}

export default {
  "the four reads": (
    <div>
      <Row
        title="anchored — the hairline, the headings, the suffix and both signs"
        note="--nms-border under every cell including the header's, --nms-muted-foreground on the five headings and on the percentage suffix, --nms-pos on the up delta and --nms-neg on the down one. `Beta` is suppressed and keeps its place in the ranking, rendering four em dashes over four different causes."
      >
        <SectionTable section={section()} view={anchoredView()} />
      </Row>
      <Row
        title="genesis — no earlier anchor, and NAV withheld"
        note="The anchor column's header renders `no earlier anchor` instead of a date, which is the only place the third --nms-muted-foreground read appears anywhere. The `% of fund` column goes to em dashes naming the PAGE's cause rather than the row's."
      >
        <SectionTable section={section()} view={anchorlessView()} />
      </Row>
    </div>
  ),
};
