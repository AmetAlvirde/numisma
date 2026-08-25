import type { DcaView } from "./dca-card";

/**
 * `DcaCard`'s prop literals, beside the component (spec #439 §4.3, S4).
 *
 * A LITERAL, NEVER A `composeDcaView` CALL, and that is forced rather than chosen. The
 * price sort, the copy before the sort and the `figures`-is-the-gate rule all stay in
 * `apps/web/src/glance/dca-view.ts`, and `seam-isolation.test.ts` forbids the workbench
 * importing from there on every specifier. What keeps these honest instead is the type
 * direction: this package DECLARES `DcaView` and that module returns it, so a field that
 * moves stops compiling on both sides rather than drifting on one.
 *
 * THE ARMS ARE CHOSEN BY WHAT THEY PUT ON SCREEN. The card reads five names across ten
 * sites and four of those ten are `STATE_TONE`, a TOTAL map over the four wire states —
 * so no single view can show them. {@link bareView} exists for the two states the wire
 * ships with no plan body at all, which are exactly the arms a partial map would drop:
 * the deleted rules were a grey base plus two overrides, and the arms the base answered
 * are the ones a conversion loses silently.
 *
 * `ladderWithPlanId` IS THE ONLY ONE THAT REACHES THE SLOT. `planId` is what turns the
 * alert line into a tap target, and it is absent on a v4 row — so every other fixture
 * here renders the real unlinked paragraph, which is a production state rather than a
 * stub.
 *
 * SYNTHESIZED. Every position id, price and count below is authored. No plans-sidecar
 * content and no ledger output has been near this file — the card renders counts, never
 * lines, and neither does its fixture.
 */

/** An in-force ladder with rungs, an alert, and something needing recording. */
export function ladderView(): DcaView {
  return {
    unreadable: false,
    unattributable: 0,
    positions: [
      {
        positionId: "test-ladder",
        state: "active",
        kind: "dcaLadder",
        rungs: [{ priceUsd: 900 }, { priceUsd: 800 }],
        alert: { rungs: 2, filled: 1, needsRecording: 1 },
      },
    ],
  };
}

/** A cadence plan: honestly rungless, no alert, so the absence copy is what renders. */
export function cadenceView(): DcaView {
  return {
    unreadable: false,
    unattributable: 0,
    positions: [
      { positionId: "test-cadence", state: "pending", kind: "dcaTime", rungs: [] },
    ],
  };
}

/** The unreadable file — which is never "no plans declared", and says so. */
export function unreadableView(): DcaView {
  return { unreadable: true, unattributable: 2, positions: [] };
}

/**
 * A row in one of the two states the wire ships bare: `{ positionId, state }` and no plan
 * body at all. Both exist so the state badge can be walked on every arm rather than on
 * the one the live ledger happens to be in — the two colours spec #420 slice 6 deleted
 * were OVERRIDES of a base, and the conversion replaced that cascade with a total map, so
 * the arms that used to be answered by the base are exactly the ones a partial map would
 * drop.
 */
export function bareView(state: "ended" | "unreadable"): DcaView {
  return {
    unreadable: false,
    unattributable: 0,
    positions: [{ positionId: `test-${state}`, state, rungs: [] }],
  };
}

/** The same ladder, with the one field that turns the alert line into a tap target. */
export function ladderWithPlanId(): DcaView {
  const view = ladderView();
  return {
    ...view,
    positions: [{ ...view.positions[0]!, planId: "test-plan" }],
  };
}

/**
 * A ladder DECLARED WITH ZERO RUNGS — a rungless arm that is neither a cadence plan nor
 * a bodiless row, and the third of the three the card names separately.
 *
 * It is the operator writing an empty ladder on purpose, which `Absent` reports as "no
 * rungs declared". Rendering it as "cadence plan" or "plan ended" would state a fact
 * nobody declared, and the three causes collapsing into one another is the exact failure
 * the moved structure test walks all three arms to catch.
 */
export function emptyLadderView(): DcaView {
  return {
    unreadable: false,
    unattributable: 0,
    positions: [
      { positionId: "test-empty", state: "active", kind: "dcaLadder", rungs: [] },
    ],
  };
}
