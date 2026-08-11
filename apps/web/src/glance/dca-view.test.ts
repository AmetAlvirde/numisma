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

/**
 * THE ALERT PROMOTION (spec #285 G-D13, slice #289) — the card becomes the answer to
 * "does anything need me?" and the tap target for the answer to "where am I?".
 *
 * ── MUTATION CHECK (performed 2026-08-11) ───────────────────────────────────────────
 *  - counted `bookAxis !== "recorded"` WITHOUT the `consumed > 0` conjunct → "counts
 *    only rungs the venue has actually filled as needing recording" red at 8 where 1
 *    was expected. Right reason: every resting day-zero rung is `not-recorded`, and
 *    calling that a call to action would put a permanent warning on the phone.
 *  - returned `alert` unconditionally instead of only when the row reconciled → "gives
 *    a v4 row no alert line rather than a fabricated all-clear" red. Right reason: an
 *    unreconciled row's `0 filled` is not a measurement.
 */
describe("composeDcaView — the alert line and the tap target", () => {
  /** A synthesized four-rung ladder: one filled and recorded, one filled and NOT. */
  const WALKED: DcaBlock = {
    source: "loaded",
    unattributable: 0,
    tornActs: 0,
    positions: [
      {
        positionId: "capital-x-btc",
        state: "active",
        kind: "dcaLadder",
        planId: "11111111-2222-4333-8444-555555555555",
        rungs: [
          {
            priceUsd: 60_000,
            venueAxis: "filled",
            bookAxis: "recorded",
            venueConsumedQuantity: 1,
          },
          {
            priceUsd: 58_000,
            venueAxis: "filled",
            bookAxis: "not-recorded",
            venueConsumedQuantity: 1,
          },
          { priceUsd: 56_000, venueAxis: "resting", bookAxis: "not-recorded", resting: true },
          { priceUsd: 54_000 },
        ],
        figures: { waitingDeclaredUsd: 500, waitingRestingUsd: 250 },
      },
    ],
  };

  it("carries the plan id so the card can link to the ladder route", () => {
    const view = composeDcaView(anchorWith(WALKED));
    expect(view.positions[0]!.planId).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("counts rungs and the ones the venue has filled", () => {
    const alert = composeDcaView(anchorWith(WALKED)).positions[0]!.alert!;
    expect(alert.rungs).toBe(4);
    expect(alert.filled).toBe(2);
  });

  it("counts only rungs the venue has actually filled as needing recording", () => {
    // A resting rung is `not-recorded` too, and always will be — there is nothing to
    // record. Counting it would pin a permanent warning to the phone on day zero.
    const alert = composeDcaView(anchorWith(WALKED)).positions[0]!.alert!;
    expect(alert.needsRecording).toBe(1);
  });

  it("gives day zero an alert with nothing to do — counts, and no warning", () => {
    const alert = composeDcaView(
      anchorWith({
        source: "loaded",
        unattributable: 0,
        tornActs: 0,
        positions: [
          {
            positionId: "p",
            state: "pending",
            kind: "dcaLadder",
            planId: "11111111-2222-4333-8444-555555555555",
            rungs: [
              { priceUsd: 60_000, venueAxis: "resting", bookAxis: "not-recorded" },
              { priceUsd: 50_000, venueAxis: "resting", bookAxis: "not-recorded" },
            ],
            figures: { waitingDeclaredUsd: 500, waitingRestingUsd: 500 },
          },
        ],
      }),
    ).positions[0]!.alert!;
    expect(alert).toEqual({ rungs: 2, filled: 0, needsRecording: 0 });
  });

  it("gives a v4 row no alert line rather than a fabricated all-clear", () => {
    // No `figures` means no reconciliation ran. "0 filled" would be a measurement
    // nobody took, and the card renders the plan without an alert instead.
    const view = composeDcaView(
      anchorWith({
        source: "loaded",
        unattributable: 0,
        positions: [
          {
            positionId: "p",
            state: "pending",
            kind: "dcaLadder",
            rungs: [{ priceUsd: 60_000 }, { priceUsd: 50_000 }],
          },
        ],
      }),
    );
    expect(view.positions[0]!.alert).toBeUndefined();
    expect(view.positions[0]!.planId).toBeUndefined();
  });
});
