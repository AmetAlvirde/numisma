import { SummaryCard } from "@numisma/components";
import { cleanSummary } from "@numisma/components/ui/summary-card.fixtures.ts";

/**
 * THE FUND SUMMARY, AND THE SIX COLOURS IT READS (spec #439 S1).
 *
 * `SummaryCard` performs exactly six colour reads and three of the names were minted
 * for it: `--nms-muted-foreground` twice (the metrics labels and the `as of` line),
 * `--nms-pos` and `--nms-neg` on the two arms of the P&L ternary, and `--nms-ok` and
 * `--nms-warn` on the two arms of the data-safety badge. Four states below, because no
 * fewer will put all six on screen: the sign pair cannot both paint at once and neither
 * can the badge pair.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through
 * five new spellings: `#9aa1ad` on the metrics labels and the `as of` line, `#46c98b` on
 * a rising P&L, `#f0736a` on a falling one, `#1f7a4d` behind `Data OK`, `#8a5a12` behind
 * the warn badge.
 *
 * WHAT TO LOOK FOR IN THEMED MODE: all six move. THE BADGE FILLS ARE THE TWO WORTH
 * WATCHING, because they are fills rather than type colours — a fill that does not
 * change when the switcher moves is the loudest possible way to say a token is not
 * being read, and both of those names are one commit old.
 *
 * THE SUPPRESSED STATE IS THE ONE A REVIEWER HAS NEVER BEEN ABLE TO SEE. With
 * `fundValueRendered={false}` two `Absent` slots render `— no current mark` and the
 * badge carries that same cause FIRST, ahead of the exclusion counts, in the card's own
 * words. That is the card's whole reason for consulting the suppression list: it sits
 * directly above tables that do, and an unguarded card prints a fund value beside a page
 * of em dashes. `USD/MXN` is deliberately NOT gated — the FX rate comes from `totals`
 * and does not descend from a mark — so two slots and not three is the correct count.
 *
 * SYNTHESIZED. `cleanSummary()` is an authored literal with placeholder words in it, and
 * it is the same one the package's structure test renders. No ledger output has been near
 * it, and this fixture imports nothing from `apps/web`.
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

const clean = cleanSummary();

export default {
  "the six reads": (
    <div>
      <Row
        title="clean, rendered — the ok fill and a rising sign"
        note="--nms-ok behind `Data OK`, --nms-pos on the P&L, --nms-muted-foreground on every label and the `as of` line."
      >
        <SummaryCard summary={clean} usdMxn={18.5} fundValueRendered />
      </Row>
      <Row
        title="clean, rendered, falling P&L — the other arm of the sign"
        note="--nms-neg. Its own state because the two sign colours are two arms of one ternary and cannot both paint at once."
      >
        <SummaryCard
          summary={{ ...clean, totalUnrealizedPnlUsd: -140.25 }}
          usdMxn={18.5}
          fundValueRendered
        />
      </Row>
      <Row
        title="excluded records — the warn fill"
        note="--nms-warn. Its own state for the same reason: the badge's two fills are two arms of one branch."
      >
        <SummaryCard
          summary={{
            ...clean,
            dataSafety: {
              nonLiveExcluded: 3,
              invalidExcluded: 0,
              shortDeferredExcluded: 1,
              hasWarnings: true,
            },
          }}
          usdMxn={18.5}
          fundValueRendered
        />
      </Row>
      <Row
        title="suppressed — no current mark"
        note="Two Absent slots, and the badge naming the same cause first. USD/MXN is not gated, which is why the count is two."
      >
        <SummaryCard
          summary={clean}
          usdMxn={18.5}
          fundValueRendered={false}
        />
      </Row>
    </div>
  ),
};
