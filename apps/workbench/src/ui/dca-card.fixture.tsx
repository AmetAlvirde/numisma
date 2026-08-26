import { DcaCard } from "@numisma/components";
import {
  bareView,
  cadenceView,
  emptyLadderView,
  ladderView,
  ladderWithPlanId,
  unreadableView,
} from "@numisma/components/ui/dca-card.fixtures.ts";

/**
 * THE DCA CARD, ITS FIVE COLOURS, AND THE SLOT THAT REPLACED ITS ROUTER (spec #439 S4).
 *
 * `DcaCard` performs exactly ten colour reads across five names and mints none of them:
 * `--nms-muted-foreground` six times, and `--nms-pos`, `--nms-warn`, `--nms-foreground`
 * and `--nms-neg` once each. Five distinct tokens is what gives the themed-mode clause
 * real teeth here — a token that does not visibly change between modes is a token this
 * fixture failed to exercise.
 *
 * FOUR OF THE TEN ARE ONE THING. `STATE_TONE` is a TOTAL map over the four wire states,
 * deliberately: the deleted stylesheet rules were a grey base plus two overrides, and two
 * unvariant colour utilities on one element are resolved by Tailwind's emitted order
 * rather than by source order. A partial map emits no colour at all on the arm it drops,
 * the word inherits the card's body text, and it reads as legible, plausible and the
 * wrong answer to *is this plan in force?*. The arm a partial map drops is the one the
 * live ledger is never in — which is why all four badges are staged below rather than the
 * one the wire happens to carry.
 *
 * ── THE API CHANGE, SIDE BY SIDE ────────────────────────────────────────────────────
 * The card cannot import a router: this workbench has none, and its vite config states
 * that absence as the whole point of the second consumer. So the package owns the
 * anchor's classes and hands them out through an OPTIONAL `renderLink`, widened by the
 * `planId` the card holds the only copy of.
 *
 * BOTH ARMS ARE ON SCREEN because they are the review. The slot arm supplies a dead
 * `<a href="#">`, the way `crumb.fixture.tsx` does, so a click never leaves the state
 * under review. The slotless arm is NOT a stub — it is the paragraph a v4 row produces in
 * production, and it is the reason optional beat currying.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through the
 * new spelling: `#9aa1ad` on all six greys, `#e7e9ee` on the anchor, `#f0736a` on the
 * "needs recording" span, and the `active` and `unreadable` badges on the values S1
 * carried across for the positive and warning roles.
 *
 * WHAT TO LOOK FOR IN THEMED MODE: all five tokens move. The greys go `#5c7cff`, the
 * anchor `#1b1a17` and the warn span `#00e5ff`. The two badge colours move with them; a
 * badge that stays put is a `STATE_TONE` entry that never crossed.
 *
 * IN GRAYSCALE the card is reviewed on hierarchy and spacing: the plan head's wrap at
 * narrow widths, the rung table spanning its card rather than huddling left, and the
 * alert line reading as a thumb-sized target. Colour is deliberately not reviewable.
 *
 * COUNTS, NEVER LINES. Every position id, price and count comes from
 * `dca-card.fixtures.ts`, the same literals the package's structure test renders. No
 * plans-sidecar content and no ledger output has been near them, and this fixture imports
 * nothing from `apps/web`.
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

/**
 * The slot, as a call site with no router: a dead anchor carrying the package's classes.
 *
 * `href="#"` AND `preventDefault`, both. The href is what makes it an anchor to the
 * accessibility tree and to the user agent's focus ring; suppressing the navigation is
 * what keeps a click from leaving the state under review. `apps/web` returns a fully
 * typed `<Link to="/ladder/$planId">` from this same slot.
 */
function deadLink({
  className,
  children,
  planId,
}: {
  className: string;
  children: React.ReactNode;
  planId: string;
}) {
  return (
    <a className={className} href="#" title={planId} onClick={(e) => e.preventDefault()}>
      {children}
    </a>
  );
}

export default {
  "the four state badges": (
    <div>
      <Row
        title="active — the ladder in force, with rungs and an alert"
        note="Read 7: the badge takes --nms-pos. Also the warn span on --nms-neg, and the rung table, which is where #442's six table constants are seen in this card's context — the place they were most likely to be got wrong."
      >
        <DcaCard view={ladderView()} />
      </Row>
      <Row
        title="pending — a declared plan awaiting its first fill"
        note="Read 4, and DELIBERATELY NOT AN ALARM COLOUR: day zero is the normal starting state, so the badge takes the same recessed grey `ended` does. The kind span beside it, `time-based`, is read 6 on the same line."
      >
        <DcaCard view={cadenceView()} />
      </Row>
      <Row
        title="ended — a bodiless row, and the second grey badge"
        note="Read 5. The wire ships `{ positionId, state }` and nothing else on this arm, so there is no kind span and no alert — the badge and the named absence are the whole of it."
      >
        <DcaCard view={bareView("ended")} />
      </Row>
      <Row
        title="unreadable — the only badge that wants the eye"
        note="Read 8: --nms-warn, and the one state that is a problem rather than a stage. Check this against `ended` above in themed mode; two greys and one warn is the shape, and a warn that reads grey is the entry that never crossed."
      >
        <DcaCard view={bareView("unreadable")} />
      </Row>
    </div>
  ),

  "the slot, and its absence": (
    <div>
      <Row
        title="with a slot — the anchor, its classes and its arrow"
        note="Read 9: --nms-foreground on the resting anchor, plus the underline on hover and focus-visible. The arrow is the PACKAGE's, unlike Crumb's, and sits inside the link with the alert text as one sentence. The href is dead on purpose."
      >
        <DcaCard view={ladderWithPlanId()} renderLink={deadLink} />
      </Row>
      <Row
        title="without one — the real unlinked arm, not a stub"
        note="The SAME view, no slot. Same counts, same box, no anchor and no arrow. This is what a v4 row renders in production, which is why the slot is optional: nothing here has to pretend."
      >
        <DcaCard view={ladderWithPlanId()} />
      </Row>
    </div>
  ),

  "the absences, each by its own cause": (
    <div>
      <Row
        title="the unreadable file, and the unattributable lines"
        note="Two different facts on one card, and they must never render as the same empty — that is the entire reason `source` is on the wire. Reads 1 and 2, the two file-level greys. The count of unreadable lines renders; their content is not even on the wire."
      >
        <DcaCard view={unreadableView()} />
      </Row>
      <Row
        title="no plan declared at all"
        note="Read 3. A readable file that declares nothing, which is the sentence the unreadable arm above must never be allowed to say."
      >
        <DcaCard view={{ unreadable: false, unattributable: 0, positions: [] }} />
      </Row>
      <Row
        title="a ladder declared with zero rungs"
        note="The third rungless arm, and the one neither band above carries: `no rungs declared` is a declaration the operator wrote that way. Beside `cadence plan — no rung ladder` and `plan ended` on the bands above, all three causes reach the operator's own words, which is what stops them collapsing into one another."
      >
        <DcaCard view={emptyLadderView()} />
      </Row>
    </div>
  ),
};
