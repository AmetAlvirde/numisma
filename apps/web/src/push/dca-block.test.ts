/**
 * Unit tests for the pure `DcaBlock` builder (spec #277, slice #278).
 *
 * IN-MEMORY FIXTURES WITH SYNTHESIZED FIGURES ONLY. The real ladder lives in the
 * git-ignored accumulus sidecar and never enters this repo; every price and size
 * below is invented, and no assertion here depends on a real desk figure.
 *
 * The key-set assertions are the load-bearing ones. Asserting VALUES would pass
 * just as happily on a row that also carried `sizeUsd` or `endedBy`, and the whole
 * point of this builder is what it REFUSES to put on the wire.
 */
import type {
  DcaLadderPlanRecord,
  DcaTimePlanRecord,
  IsoDate,
  LoadedPlanRecord,
  LoadedPlans,
  NoPlanRecord,
  SkippedPlanLine,
} from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { buildDcaBlock } from "./dca-block.ts";

const ASOF = "2026-08-10" as IsoDate;

function loadedPlans(parts: Partial<LoadedPlans> = {}): LoadedPlans {
  return {
    load: { status: "loaded" },
    plans: [],
    skipped: [],
    ...parts,
  };
}

/** A synthesized two-rung ladder. The figures are invented, not the desk's. */
function ladder(
  positionId: string,
  line: number,
  effectiveAt = "2026-01-01",
): LoadedPlanRecord {
  const record: DcaLadderPlanRecord = {
    kind: "dcaLadder",
    // Synthesized, obviously fake, and STABLE — it counts the fixture's own line rather
    // than being generated. Nothing on the wire or the card carries it.
    id: `00000000-0000-4000-8000-${String(line).padStart(12, "0")}`,
    positionId,
    effectiveAt: effectiveAt as IsoDate,
    tierOrder: ["c1"],
    rungs: [
      { id: "r1", priceUsd: 11_000, sizeUsd: 250 },
      { id: "r2", priceUsd: 9_000, sizeUsd: 250 },
    ],
  };
  return { ...record, line };
}

function timePlan(positionId: string, line: number): LoadedPlanRecord {
  const record: DcaTimePlanRecord = {
    kind: "dcaTime",
    positionId,
    effectiveAt: "2026-01-01" as IsoDate,
    cadence: "weekly",
    anchorAt: "2026-01-05" as IsoDate,
    amountUsd: 100,
    tierOrder: ["c1"],
  };
  return { ...record, line };
}

function terminator(positionId: string, line: number): LoadedPlanRecord {
  const record: NoPlanRecord = {
    kind: "noPlan",
    positionId,
    effectiveAt: "2026-02-01" as IsoDate,
    reason: "ladder filled",
  };
  return { ...record, line };
}

function skip(parts: Partial<SkippedPlanLine> & { line: number }): SkippedPlanLine {
  return { reason: "invalid", detail: "synthesized", ...parts };
}

describe("buildDcaBlock — the plans roster narrowed to the wire", () => {
  it("maps a failed load to `source: \"unreadable\"` with nothing else to say", () => {
    const block = buildDcaBlock(
      loadedPlans({ load: { status: "load-failed", message: "synthesized" } }),
      ASOF,
      new Set(),
    );
    expect(block).toEqual({ source: "unreadable", positions: [], unattributable: 0 });
  });

  it("maps loaded-and-empty — the normal starting state — to an empty branch", () => {
    const block = buildDcaBlock(loadedPlans(), ASOF, new Set());
    expect(block).toEqual({ source: "loaded", positions: [], unattributable: 0 });
  });

  it("OMITS a `none` row — absence is the encoding, `none` never reaches the wire", () => {
    // A position the sidecar names ONLY through a future-dated attributable skip:
    // enumerated as a row, looked up as `none`.
    const block = buildDcaBlock(
      loadedPlans({
        skipped: [skip({ line: 1, positionId: "ghost", effectiveAt: "2099-01-01" as IsoDate })],
      }),
      ASOF,
      new Set(),
    );
    expect(block.positions).toEqual([]);
  });

  it("ships a pending ladder with `kind` and `priceUsd`-ONLY rungs", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(),
    );
    expect(block.positions).toHaveLength(1);
    const row = block.positions[0]!;
    expect(Object.keys(row).sort()).toEqual(["kind", "positionId", "rungs", "state"]);
    expect(row.state).toBe("pending");
    expect(row.kind).toBe("dcaLadder");
    for (const rung of row.rungs ?? []) {
      expect(Object.keys(rung)).toEqual(["priceUsd"]);
    }
  });

  it("ships an active ladder the same way — born-ness only moves `state`", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
    );
    const row = block.positions[0]!;
    expect(row.state).toBe("active");
    expect(row.kind).toBe("dcaLadder");
    expect(row.rungs?.map((rung) => rung.priceUsd)).toEqual([11_000, 9_000]);
  });

  it("preserves rung order AS DECLARED — the descending sort is the view's job", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(),
    );
    expect(block.positions[0]!.rungs?.map((rung) => rung.priceUsd)).toEqual([11_000, 9_000]);
  });

  it("gives a `dcaTime` row its `kind` and NO rungs key at all", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [timePlan("cap-eth", 1)] }),
      ASOF,
      new Set(["cap-eth"]),
    );
    const row = block.positions[0]!;
    expect(Object.keys(row).sort()).toEqual(["kind", "positionId", "state"]);
    expect("rungs" in row).toBe(false);
    expect(row.kind).toBe("dcaTime");
  });

  it("reduces an `ended` row to `{ positionId, state }` — `endedBy` is an INPUT", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1), terminator("cap-btc", 2)] }),
      ASOF,
      new Set(["cap-btc"]),
    );
    const row = block.positions[0]!;
    expect(Object.keys(row).sort()).toEqual(["positionId", "state"]);
    expect(row.state).toBe("ended");
  });

  it("reduces an `unreadable` row to `{ positionId, state }` — `skipped` is an INPUT", () => {
    const block = buildDcaBlock(
      loadedPlans({
        skipped: [skip({ line: 1, positionId: "cap-sol", effectiveAt: "2026-03-01" as IsoDate })],
      }),
      ASOF,
      new Set(),
    );
    const row = block.positions[0]!;
    expect(Object.keys(row).sort()).toEqual(["positionId", "state"]);
    expect(row.state).toBe("unreadable");
  });

  it("ships `unattributable` as a COUNT, never the line content", () => {
    const block = buildDcaBlock(
      loadedPlans({ skipped: [skip({ line: 1 }), skip({ line: 2 })] }),
      ASOF,
      new Set(),
    );
    expect(block.unattributable).toBe(2);
  });

  it("puts NO date-shaped value anywhere in the serialized branch", () => {
    const block = buildDcaBlock(
      loadedPlans({
        plans: [ladder("cap-btc", 1), timePlan("cap-eth", 2), terminator("cap-old", 3)],
        skipped: [skip({ line: 4 }), skip({ line: 5, positionId: "cap-bad" })],
      }),
      ASOF,
      new Set(["cap-eth"]),
    );
    expect(JSON.stringify(block)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
