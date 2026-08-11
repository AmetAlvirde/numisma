/**
 * `composeDcaView` — the pure mediation between the wire's `dca` branch and what the
 * card renders (spec #277, slice 3).
 *
 * The claims worth asserting are the ones JSX could plausibly have absorbed: the
 * DESCENDING price sort, the fact that sorting does not mutate the wire, and that
 * every arm of the five-state wire reaches a renderable shape without the card having
 * to reason about optionality.
 */
import { describe, expect, it } from "vitest";
import type { DcaBlock, SnapshotAnchor } from "../projection/contract.ts";
import { composeDcaView } from "./dca-view.ts";

/** A minimal anchor carrying only the branch under test. */
function anchorWith(dca: DcaBlock): SnapshotAnchor {
  return { fundId: "test-fund", asOf: "2026-08-10", report: { dca } } as SnapshotAnchor;
}

const LADDER: DcaBlock = {
  source: "loaded",
  positions: [
    {
      positionId: "capital-x-btc",
      state: "pending",
      kind: "dcaLadder",
      // DECLARED ORDER, deliberately not sorted: the wire preserves the file's order
      // and this module is where the presentation order is decided.
      rungs: [{ priceUsd: 900 }, { priceUsd: 1100 }, { priceUsd: 1000 }],
    },
  ],
  unattributable: 0,
};

describe("composeDcaView — the wire's dca branch, shaped for the card", () => {
  it("sorts rungs DESCENDING by price — the sort lives here, never in JSX", () => {
    const view = composeDcaView(anchorWith(LADDER));
    expect(view.positions[0]!.rungs.map((rung) => rung.priceUsd)).toEqual([
      1100, 1000, 900,
    ]);
  });

  it("does NOT mutate the wire's own array while sorting", () => {
    // `Array.prototype.sort` is in-place, and `latest.report` is the loader's object:
    // sorting it would reorder the payload every other surface reads.
    const block = structuredClone(LADDER);
    composeDcaView(anchorWith(block));
    expect(block.positions[0]!.rungs!.map((rung) => rung.priceUsd)).toEqual([
      900, 1100, 1000,
    ]);
  });

  it("gives every position a rungs ARRAY, so the card never re-derives absence", () => {
    const view = composeDcaView(
      anchorWith({
        source: "loaded",
        positions: [
          { positionId: "a", state: "active", kind: "dcaTime" },
          { positionId: "b", state: "ended" },
          { positionId: "c", state: "unreadable" },
        ],
        unattributable: 0,
      }),
    );
    expect(view.positions.map((position) => position.rungs)).toEqual([[], [], []]);
    // …and the state and kind survive verbatim: they are the card's whole content.
    expect(view.positions.map((position) => `${position.state}/${position.kind}`)).toEqual([
      "active/dcaTime",
      "ended/undefined",
      "unreadable/undefined",
    ]);
  });

  it("carries position order through as the wire gave it (first-mention order)", () => {
    const view = composeDcaView(
      anchorWith({
        source: "loaded",
        positions: [
          { positionId: "second-mentioned", state: "ended" },
          { positionId: "first-mentioned", state: "pending", kind: "dcaTime" },
        ],
        unattributable: 0,
      }),
    );
    expect(view.positions.map((position) => position.positionId)).toEqual([
      "second-mentioned",
      "first-mentioned",
    ]);
  });

  it("raises the loader's whole-file failure to a boolean the card can render", () => {
    const view = composeDcaView(
      anchorWith({ source: "unreadable", positions: [], unattributable: 0 }),
    );
    expect(view.unreadable).toBe(true);
    expect(view.positions).toEqual([]);
  });

  it("distinguishes an unreadable FILE from a file that declares no plan", () => {
    // The distinction the `source` field exists for: both render empty, and they must
    // not render the SAME empty.
    const view = composeDcaView(
      anchorWith({ source: "loaded", positions: [], unattributable: 0 }),
    );
    expect(view.unreadable).toBe(false);
    expect(view.positions).toEqual([]);
  });

  it("passes the unattributable COUNT through untouched", () => {
    const view = composeDcaView(
      anchorWith({ source: "loaded", positions: [], unattributable: 3 }),
    );
    expect(view.unattributable).toBe(3);
  });
});
