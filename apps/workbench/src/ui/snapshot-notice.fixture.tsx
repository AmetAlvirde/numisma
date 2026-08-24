import {
  Button,
  NOTICE_CODE,
  SnapshotEmptyNotice,
  SnapshotStaleNotice,
} from "@numisma/components";

/**
 * THE TWO SNAPSHOT GUARD NOTICES, AND THE ONE COLOUR BETWEEN THEM (spec #432 §4.1,
 * slice 3).
 *
 * Between them the pair reads exactly one colour, twice, and both reads are the stale
 * notice's: `--nms-neg` on the wrapper and again on the heading. The empty notice reads
 * none at all — it is the card surface and nothing else, which is why it sits first
 * below. If the two notices look identical in a mode, that mode is not exercising the
 * token.
 *
 * WHAT TO LOOK FOR IN APP MODE: `#f0736a` on the refusal's box and its heading, on the
 * `#181b22` card surface. That is what `apps/web` painted before these crossed the
 * boundary, and app mode is the parity check for it.
 *
 * WHY THEMED MODE IS THE ONE THAT MATTERS HERE. `apps/web` aliases both `--nms-neg` and
 * `--nms-destructive` onto `--neg`, so app mode shows one red under two names and cannot
 * tell you which of them the refusal read. Themed mode paints `--nms-neg` a cyan and
 * `--nms-destructive` a red, so the destructive Button staged beside the refusal below
 * is the control: if the two go the same colour when you switch into themed mode, the
 * notice is reading the wrong token, and no guard in the repo can see that.
 *
 * GRAYSCALE MODE CANNOT REVIEW SIGN, and that is correct rather than a gap. Both tokens
 * default to the same grey, so the refusal reads as ordinary type there. Grayscale
 * reviews hierarchy, spacing and state; sign is reviewed in the two modes that carry a
 * palette.
 *
 * `NOTICE_CODE` GETS ITS OWN ROW because it is a class string three files spell onto
 * their own `<code>` elements — the empty notice, the fill path's unrecorded-fill copy
 * and the ladder fixture route — and it reads no house colour at all: `bg-black` and
 * `text-white` are Tailwind defaults, not mapped tokens. A chip that repaints on a mode
 * switch is the finding.
 *
 * THIS ROW ALREADY PAID FOR ITSELF, and the way it did is worth keeping. The rule above
 * was written about the background, so the background is what it watched. The chip set
 * `bg-black` and inherited its foreground, and in app mode the ambient foreground is
 * light, so it read correctly and no test disagreed — the class list was pinned to
 * exactly what the app shipped. Rendered here against a palette whose foreground is
 * near-black, it painted black on black. The pairing is now literal on the chip, and the
 * rule reads BOTH halves: an element that sets a background owns the text on it.
 *
 * SYNTHESIZED. The version numbers are authored and are not the engine's real schema
 * window.
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
      <div className="flex flex-col items-start gap-6">{children}</div>
    </section>
  );
}

export default {
  "the two notices": (
    <div className="max-w-xl">
      <Row
        title="the empty projection"
        note="Reads no colour. The card surface, the copy, and the inline chip — nothing here should move when the mode does, except the surface itself."
      >
        <SnapshotEmptyNotice />
      </Row>
      <Row
        title="the refusal"
        note="The only colour read in the pair: --nms-neg on the box and again on the h1, which is redundant by inheritance and written anyway."
      >
        <SnapshotStaleNotice storedVersion={2} min={4} max={6} />
      </Row>
      <Row
        title="the same numbers, a wider window"
        note="The three numbers are all rendered, because refusing to render without them leaves the operator with nothing to act on."
      >
        <SnapshotStaleNotice storedVersion={11} min={4} max={9} />
      </Row>
      <Row
        title="the control: --nms-destructive, beside it"
        note="One red in app mode, two colours in themed mode. If this button and the refusal above stay the same colour when you switch into themed, the notice is reading the wrong token."
      >
        <Button variant="destructive">Delete the plan</Button>
      </Row>
      <Row
        title="the inline chip on its own"
        note="NOTICE_CODE, the class string the empty notice, the fill path and the ladder fixture route each spell onto their own <code>. bg-black and text-white are Tailwind defaults and must not repaint. Read the text, not just the pill: this chip inherited its foreground until this mode showed it black on black."
      >
        <p className="text-sm">
          Run <code className={NOTICE_CODE}>pnpm push</code> to publish the
          latest composition report.
        </p>
      </Row>
    </div>
  ),
};
