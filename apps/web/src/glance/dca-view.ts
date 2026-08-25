/**
 * THE DCA VIEW (spec #277, slice 3) — the pure module `/`'s DCA card renders from.
 *
 * PURE, for the same reason `verdict.ts` and `row-view.ts` are: no IO, no clock, no
 * database. It reads the wire and nothing else, so the cases the real sidecar does
 * not currently contain — a `dcaTime` plan, an ended ladder, an unreadable file — are
 * exercisable at all.
 *
 * IT EXISTS SO THE ROUTE NEVER HANDS THE LOADER RESULT TO JSX. The mediation is the
 * same one `composeBigPicture` performs one surface over: the wire shape is a
 * CONCLUSION about the operator's plans, and the card's shape is a decision about how
 * to read it. Keeping them apart is what makes the second decision testable.
 *
 * ── THE PRICE SORT LIVES HERE ───────────────────────────────────────────────────
 * The card is a rung table read top-down, so the rungs render DESCENDING by price:
 * the nearest fill to spot on a falling market is the first line the eye lands on.
 * That is a PRESENTATION decision, which is exactly why the wire does not make it —
 * `push/dca-block.ts` ships the file's declared order, deliberately, so the payload
 * carries no second invisible contract about ordering. A sort inside JSX would be the
 * same decision made where nothing can assert it.
 *
 * The sort COPIES before it sorts. `latest.report` is the loader's own object, shared
 * with every other surface on the page; an in-place sort would silently reorder the
 * payload for all of them.
 *
 * ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────────
 * No accumulated total, no `$0`, no capital figure of any kind. Day zero renders the
 * STATE WORD (`pending`), because zero is a measurement and pending is the absence of
 * one — and the wire carries no sizes to total even if this module wanted to.
 *
 * No copy, either: the state words, the absence phrasing and the unreadable-file line
 * are the CARD's, beside the em dash they share. This module decides shape and order;
 * the component decides wording.
 */
import type { DcaPositionRow, SnapshotAnchor } from "../projection/contract.ts";
import { needsRecording, venueFilled } from "../ladder/fill-path-view.ts";
/**
 * THE CARD'S SHAPE IS THE PACKAGE'S, AND THIS MODULE IMPORTS ITS OWN RETURN TYPE BACK
 * (spec #439 §4.1, S4). All four names used to be declared here; they are declared in
 * `@numisma/components`'s `ui/dca-card.tsx` now, beside the component that renders
 * them.
 *
 * THE CONSUMER DEFINES THE INTERFACE, which is the standard direction and also the only
 * one that lets a cosmos fixture build a `DcaView` literal without importing `apps/web`
 * — `seam-isolation.test.ts` forbids that outright. Every line of `composeDcaView` stays
 * here, and nothing about what it emits changed.
 *
 * IT IS NOT A COPY WAITING TO DRIFT, because the arrow points both ways: this module
 * RETURNS the package's `DcaView`, so a field added on either side stops compiling at
 * the assignments below. The two fields the package had to SPELL — `state` and `kind`,
 * indexed accesses into `DcaPositionRow`, which stays here because 34 files including
 * all of `push/` read it — get the same treatment for free: `composeDcaView` assigns
 * `position.state` and spreads `position.kind` straight into a `DcaPositionView`, so a
 * fifth state or a third kind on the wire reds THIS file, in front of the author who
 * has to decide what the card says about it.
 *
 * THREE NAMES, NOT FOUR. `DcaRungView` is the package's too and this module has no
 * lexical use for it: it is reached through `DcaPositionView["rungs"]`, so the sort
 * below is already checked against it. Importing a fourth name to read as complete
 * would be an unused binding, and this file's whole argument is that the check lands
 * where a reader can act on it.
 */
import type { DcaAlertView, DcaPositionView, DcaView } from "@numisma/components";

/**
 * Compose everything the DCA card needs for `latest`.
 *
 * Takes the ANCHOR, not the block, mirroring `composeBigPicture`: the route hands
 * over what the loader returned and the composition decides what to read out of it.
 */
export function composeDcaView(latest: SnapshotAnchor): DcaView {
  const dca = latest.report.dca;
  return {
    unreadable: dca.source === "unreadable",
    unattributable: dca.unattributable,
    // ANNOTATED PER POSITION, not left to the return type alone (spec #439 §4.1, S4).
    // The package spells `state` and `kind` out because `DcaPositionRow` cannot move,
    // and the latch on that is the assignment below. A `DcaView` return type checks it
    // too, but the error surfaces on the whole object literal; the annotation here puts
    // it on the row whose wire field grew a member.
    positions: dca.positions.map((position): DcaPositionView => ({
      positionId: position.positionId,
      state: position.state,
      ...(position.kind === undefined ? {} : { kind: position.kind }),
      // Copy, then sort. See this module's header for why the copy is load-bearing.
      rungs: [...(position.rungs ?? [])].sort((a, b) => b.priceUsd - a.priceUsd),
      ...(position.planId === undefined ? {} : { planId: position.planId }),
      ...alertFor(position),
    })),
  };
}

/**
 * The alert counts for one row, or nothing at all.
 *
 * `figures` IS THE GATE, not `rungs`. Its presence is the wire's statement that a
 * reconciliation ran for this ladder (see `projection/contract.ts`); without it the
 * per-rung axes are absent too, and every count would come back zero for a reason that
 * has nothing to do with the ladder's actual state.
 */
function alertFor(position: DcaPositionRow): { alert?: DcaAlertView } {
  if (position.figures === undefined || position.rungs === undefined) return {};
  const rungs = position.rungs;
  return {
    alert: {
      rungs: rungs.length,
      filled: rungs.filter(venueFilled).length,
      needsRecording: rungs.filter(needsRecording).length,
    },
  };
}
