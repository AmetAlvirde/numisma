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

/** One rung, ready to render — the price axis and nothing else, as it arrives. */
export interface DcaRungView {
  priceUsd: number;
}

/** One position's plan, shaped so the card branches on data rather than on absence. */
export interface DcaPositionView {
  positionId: string;
  state: DcaPositionRow["state"];
  /** Present on `pending`/`active` rows only, exactly as the wire has it. */
  kind?: DcaPositionRow["kind"];
  /**
   * The declared rungs, DESCENDING by price — and ALWAYS an array, empty where the
   * wire has no `rungs` key at all. That normalization is the point: a `dcaTime` plan
   * and an ended ladder are different FACTS, carried by `state` and `kind`, and the
   * card should read them there rather than inferring them from a missing key.
   */
  rungs: readonly DcaRungView[];
}

export interface DcaView {
  /**
   * The loader's whole-file failure, raised to the one boolean the card renders. An
   * unreadable file and a file that declares no plan both produce zero positions, and
   * they must NOT render the same empty — that is the entire reason `source` is on
   * the wire.
   */
  unreadable: boolean;
  /** One entry per declared position, in the wire's own first-mention order. */
  positions: readonly DcaPositionView[];
  /** The COUNT of unreadable lines that named no position. Never their content. */
  unattributable: number;
}

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
    positions: dca.positions.map((position) => ({
      positionId: position.positionId,
      state: position.state,
      ...(position.kind === undefined ? {} : { kind: position.kind }),
      // Copy, then sort. See this module's header for why the copy is load-bearing.
      rungs: [...(position.rungs ?? [])].sort((a, b) => b.priceUsd - a.priceUsd),
    })),
  };
}
