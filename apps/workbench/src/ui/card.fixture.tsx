import { Card, CardTitle, CARD_SURFACE } from "@numisma/components";

/**
 * THE CARD, AND THE TWO COLOURS IT READS (spec #432 §4.1, slice 2).
 *
 * `Card` reads exactly two colours and reads them both from `CARD_SURFACE`: the
 * fill is `--nms-card`, the hairline is `--nms-border`. `CardTitle` reads none at
 * all — it is a heading element and a level, and its whole reason to exist is the
 * level.
 *
 * WHAT TO LOOK FOR IN APP MODE: `#181b22` behind a `#262a33` hairline, which is
 * what `apps/web` painted before this component crossed the boundary. The two sit
 * one step apart on that palette, so the border is a genuinely quiet edge rather
 * than a line you can miss — if the cards below read as flat rectangles with no
 * visible edge at all, the border read is broken, not subtle.
 *
 * WHICH IS WHY THEMED MODE PAINTS THEM NOTHING LIKE EACH OTHER. Both must move
 * when the mode switcher does. A fill that changes while the edge stays put means
 * only one of the two reads is live, and that is the finding this fixture exists
 * to make visible — no guard in the repo can see it.
 *
 * BOTH HEADING LEVELS ARE STAGED. `level` defaults to 2 and every card but two in
 * `apps/web` takes the default; `SummaryCard`'s fund name and the fill path's
 * header pass 1, because those two cards ARE their pages. Heading level is an
 * accessibility fact the call site decides, and this component is the one place in
 * the layer that can get it wrong for every card at once, so both levels are on
 * screen rather than trusted.
 *
 * `CARD_SURFACE` GETS ITS OWN ROW, because three of the eight elements that carry
 * the surface in `apps/web` are not cards and import the string instead of the
 * component. A `<div>` wearing the string must be indistinguishable from a `Card`,
 * and the pair below is where that stops being an assumption.
 *
 * SYNTHESIZED. The words are placeholders, not ledger output.
 */

/** A titled band, so a mode switch is read row by row. */
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
      <div className="flex flex-wrap items-start gap-6">{children}</div>
    </section>
  );
}

export default {
  "surface and headings": (
    <div>
      <Row
        title="the default heading level"
        note="`level` defaults to 2. Every card in apps/web but two takes it, because they are sections beneath a page title."
      >
        <Card className="w-64">
          <CardTitle>A section heading</CardTitle>
          <p className="mt-2 text-sm">
            The fill is one step off the page and the hairline is one step off
            the fill.
          </p>
        </Card>
        <Card className="w-64">
          <Card.Title>Reached as Card.Title</Card.Title>
          <p className="mt-2 text-sm">
            The same function under the call-site vocabulary, asserted equal in
            the package's contract test.
          </p>
        </Card>
      </Row>
      <Row
        title="the page's own heading"
        note="`level={1}`. The fund name on SummaryCard and the fill path's header, the two cards that are their pages."
      >
        <Card className="w-64">
          <CardTitle level={1}>A page title</CardTitle>
          <p className="mt-2 text-sm">
            Renders an h1. Sighted readers see no difference; anything
            navigating by headings sees a document with a title.
          </p>
        </Card>
      </Row>
      <Row
        title="the surface without the component"
        note="What login's form and the route notices carry. Must be indistinguishable from the cards above."
      >
        <div className={`${CARD_SURFACE} w-64`}>
          <p className="text-sm">
            A plain div wearing CARD_SURFACE. A shared surface is not a shared
            component.
          </p>
        </div>
      </Row>
    </div>
  ),
};
