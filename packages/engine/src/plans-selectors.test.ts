/**
 * The READ SIDE of the `plans.jsonl` sidecar: `pickPlanAsOf` and `listPlansAsOf`.
 *
 * Every figure, every id and every date here is SYNTHETIC and invented. The fund's
 * real plans are figures and must never enter this repository (ADR-007); these tests
 * assert PROPERTIES of the selection rule, never a real value.
 *
 * The fixtures are built by hand rather than by round-tripping the loader: the seam
 * under test is `LoadedPlans` → `PlanLookup`, and constructing the input directly is
 * what keeps these tests IO-free and lets a skip carry exactly the fields the case
 * needs (a scraped `effectiveAt`, or deliberately none).
 */
import { describe, expect, it } from "vitest";
import {
  listPlansAsOf,
  pickPlanAsOf,
  type LoadedPlanRecord,
  type LoadedPlans,
  type SkippedPlanLine,
} from "./plans.js";

const NOBODY: ReadonlySet<string> = new Set<string>();
const BORN = (...ids: string[]): ReadonlySet<string> => new Set(ids);

function loaded(
  plans: LoadedPlanRecord[],
  skipped: SkippedPlanLine[] = [],
): LoadedPlans {
  return { load: { status: "loaded" }, plans, skipped };
}

function ladder(
  positionId: string,
  effectiveAt: string,
  line: number,
): LoadedPlanRecord {
  return {
    kind: "dcaLadder",
    positionId,
    effectiveAt,
    line,
    tierOrder: ["c1"],
    rungs: [{ id: "r1", priceUsd: 100, sizeUsd: 25 }],
  };
}

function timePlan(
  positionId: string,
  effectiveAt: string,
  line: number,
): LoadedPlanRecord {
  return {
    kind: "dcaTime",
    positionId,
    effectiveAt,
    line,
    cadence: "weekly",
    anchorAt: "2026-01-05",
    amountUsd: 10,
    tierOrder: ["c1"],
  };
}

function noPlan(
  positionId: string,
  effectiveAt: string,
  line: number,
): LoadedPlanRecord {
  return { kind: "noPlan", positionId, effectiveAt, line };
}

function skip(
  line: number,
  positionId?: string,
  effectiveAt?: string,
): SkippedPlanLine {
  return {
    line,
    reason: "invalid",
    detail: "line is not valid JSON",
    ...(positionId === undefined ? {} : { positionId }),
    ...(effectiveAt === undefined ? {} : { effectiveAt }),
  };
}

describe("pickPlanAsOf — the five arms", () => {
  it("answers `none` for a position the sidecar never names", () => {
    const lookup = pickPlanAsOf(loaded([ladder("pos-a", "2026-07-01", 1)]), "pos-z", "2026-07-10", NOBODY);
    expect(lookup).toEqual({ status: "none", unattributable: [] });
  });

  it("answers `active` and locks the WHOLE shape exhaustively", () => {
    // The one exhaustive `toEqual` the acceptance names: no field of the returned
    // union arm goes unasserted, so a field added silently breaks this test.
    const plan = ladder("pos-a", "2026-07-01", 2);
    const file = loaded([ladder("pos-a", "2026-06-01", 1), plan], [skip(3, "pos-a", "2026-05-01")]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"))).toEqual({
      status: "active",
      plan: {
        kind: "dcaLadder",
        positionId: "pos-a",
        effectiveAt: "2026-07-01",
        line: 2,
        tierOrder: ["c1"],
        rungs: [{ id: "r1", priceUsd: 100, sizeUsd: 25 }],
      },
      skipped: [
        {
          line: 3,
          reason: "invalid",
          detail: "line is not valid JSON",
          positionId: "pos-a",
          effectiveAt: "2026-05-01",
        },
      ],
      unattributable: [],
    });
  });

  it("answers `pending` when the winning plan names a position not yet born", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 1)]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", NOBODY);
    expect(lookup).toEqual({
      status: "pending",
      plan: ladder("pos-a", "2026-07-01", 1),
      skipped: [],
      unattributable: [],
    });
  });

  it("answers `ended` when the winning line is the terminator", () => {
    const file = loaded([ladder("pos-a", "2026-06-01", 1), noPlan("pos-a", "2026-07-01", 2)]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    expect(lookup).toEqual({
      status: "ended",
      endedBy: { kind: "noPlan", positionId: "pos-a", effectiveAt: "2026-07-01", line: 2 },
      skipped: [],
      unattributable: [],
    });
  });

  it("answers `unreadable` when the newest in-window line for the position was skipped", () => {
    const file = loaded([ladder("pos-a", "2026-06-01", 1)], [skip(2, "pos-a", "2026-07-01")]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    expect(lookup.status).toBe("unreadable");
    expect(lookup).not.toHaveProperty("plan");
  });
});

describe("pickPlanAsOf — selection is latest `effectiveAt ≤ asOf`", () => {
  it("ignores a plan whose `effectiveAt` is in the future", () => {
    const file = loaded([ladder("pos-a", "2026-06-01", 1), timePlan("pos-a", "2026-08-01", 2)]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    expect(lookup.status).toBe("active");
    if (lookup.status !== "active") throw new Error("unreachable");
    expect(lookup.plan.effectiveAt).toBe("2026-06-01");
  });

  it("keeps the last line in force forever without a terminator", () => {
    const file = loaded([ladder("pos-a", "2026-06-01", 1)]);
    expect(pickPlanAsOf(file, "pos-a", "2099-01-01", BORN("pos-a")).status).toBe("active");
  });

  it("answers `none` at a date before the position's first plan", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 1)]);
    expect(pickPlanAsOf(file, "pos-a", "2026-06-30", BORN("pos-a"))).toEqual({
      status: "none",
      unattributable: [],
    });
  });
});

describe("pickPlanAsOf — the tie-break is (effectiveAt, line), effectiveAt PRIMARY", () => {
  it("plan/plan on the same day: last-in-file wins", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 1), timePlan("pos-a", "2026-07-01", 2)]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-01", BORN("pos-a"));
    if (lookup.status !== "active") throw new Error(`expected active, got ${lookup.status}`);
    expect(lookup.plan.line).toBe(2);
    expect(lookup.plan.kind).toBe("dcaTime");
  });

  it("same-day `noPlan` THEN plan resolves `active`", () => {
    const file = loaded([noPlan("pos-a", "2026-07-01", 1), ladder("pos-a", "2026-07-01", 2)]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-01", BORN("pos-a"));
    expect(lookup.status).toBe("active");
  });

  it("same-day plan THEN `noPlan` resolves `ended`", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 1), noPlan("pos-a", "2026-07-01", 2)]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-01", BORN("pos-a"));
    if (lookup.status !== "ended") throw new Error(`expected ended, got ${lookup.status}`);
    expect(lookup.endedBy.line).toBe(2);
  });

  it("`effectiveAt` stays PRIMARY: a back-dated correction appended today does NOT win", () => {
    // Inverting the keys would let line 2 (appended later, effective EARLIER) beat
    // line 1, which breaks as-of replay outright.
    const file = loaded([ladder("pos-a", "2026-07-01", 1), timePlan("pos-a", "2026-06-01", 2)]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    if (lookup.status !== "active") throw new Error(`expected active, got ${lookup.status}`);
    expect(lookup.plan.effectiveAt).toBe("2026-07-01");
    expect(lookup.plan.line).toBe(1);
  });
});

describe("pickPlanAsOf — skips are an INPUT to selection (P3)", () => {
  it("P3: a strictly-newer skipped line yields `unreadable`, never the replaced plan", () => {
    const file = loaded([ladder("pos-a", "2026-06-01", 1)], [skip(2, "pos-a", "2026-07-01")]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    expect(lookup).toEqual({
      status: "unreadable",
      skipped: [skip(2, "pos-a", "2026-07-01")],
      unattributable: [],
    });
  });

  it("an OLDER skip does not black out a readable newer plan", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 2)], [skip(1, "pos-a", "2026-06-01")]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    expect(lookup.status).toBe("active");
  });

  it("the same-day typo-then-correction row resolves `active`", () => {
    // Line 1 is the typo (skipped, same day); line 2 is the correction. The pair
    // comparison makes the correction win — not a permanent blackout.
    const file = loaded([ladder("pos-a", "2026-07-01", 2)], [skip(1, "pos-a", "2026-07-01")]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-01", BORN("pos-a"));
    if (lookup.status !== "active") throw new Error(`expected active, got ${lookup.status}`);
    expect(lookup.plan.line).toBe(2);
    expect(lookup.skipped).toEqual([skip(1, "pos-a", "2026-07-01")]);
  });

  it("a same-day skip appended AFTER the plan still blacks the position out", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 1)], [skip(2, "pos-a", "2026-07-01")]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-01", BORN("pos-a")).status).toBe("unreadable");
  });

  it("a FUTURE-dated skip is out of window and does not black out the present", () => {
    const file = loaded([ladder("pos-a", "2026-06-01", 1)], [skip(2, "pos-a", "2026-08-01")]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    expect(lookup.status).toBe("active");
    if (lookup.status !== "active") throw new Error("unreachable");
    expect(lookup.skipped).toEqual([]);
  });

  it("an UNDATED skip is conservatively in-window and supersedes by line alone", () => {
    const file = loaded([ladder("pos-a", "2026-06-01", 1)], [skip(2, "pos-a")]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a")).status).toBe("unreadable");
  });

  it("an UNDATED skip on an earlier line does not beat a later readable plan", () => {
    const file = loaded([ladder("pos-a", "2026-06-01", 2)], [skip(1, "pos-a")]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a")).status).toBe("active");
  });

  it("reports the position's in-window skips in FILE ORDER", () => {
    const file = loaded(
      [ladder("pos-a", "2026-07-01", 5)],
      [skip(4, "pos-a", "2026-05-01"), skip(2, "pos-a", "2026-06-01"), skip(1, "pos-a", "2026-04-01")],
    );
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    if (lookup.status !== "active") throw new Error(`expected active, got ${lookup.status}`);
    expect(lookup.skipped.map((entry) => entry.line)).toEqual([1, 2, 4]);
  });
});

describe("pickPlanAsOf — the P4 residual is a STATED LIMIT, not a defect", () => {
  it("an undated skip with NO readable winner blacks the position out at every date", () => {
    // Deliberate and documented: an undated skip could carry any date, including a
    // back-dated one, so with no winner the honest answer stays `unreadable`. The
    // floor-at-min(effectiveAt) alternative is unsound — back-dated corrections are
    // legal, so the floor floors nothing. Repair is appending a corrected line.
    const file = loaded([], [skip(1, "pos-a")]);
    for (const asOf of ["2000-01-01", "2026-07-10", "2099-12-31"]) {
      expect(pickPlanAsOf(file, "pos-a", asOf, BORN("pos-a")).status).toBe("unreadable");
    }
  });

  it("blacks it out even at an `asOf` BEFORE the position's first plan", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 2)], [skip(1, "pos-a")]);
    // At 2026-06-01 the July plan is out of window, so there is no readable winner
    // and the undated skip stands alone: `unreadable`, not `none`.
    expect(pickPlanAsOf(file, "pos-a", "2026-06-01", BORN("pos-a")).status).toBe("unreadable");
    // Once the plan is in window it is the later line and wins.
    expect(pickPlanAsOf(file, "pos-a", "2026-07-01", BORN("pos-a")).status).toBe("active");
  });

  it("a DATED in-window skip with no readable winner is also `unreadable`, never `none`", () => {
    const file = loaded([], [skip(1, "pos-a", "2026-06-01")]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a")).status).toBe("unreadable");
    // Before that skip's own date there is nothing in window at all.
    expect(pickPlanAsOf(file, "pos-a", "2026-05-01", BORN("pos-a")).status).toBe("none");
  });
});

describe("pickPlanAsOf — `noPlan` × skip, both directions", () => {
  it("a NEWER skip over a terminator yields `unreadable`", () => {
    const file = loaded([noPlan("pos-a", "2026-06-01", 1)], [skip(2, "pos-a", "2026-07-01")]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a")).status).toBe("unreadable");
  });

  it("an OLDER skip under a terminator leaves `ended` standing", () => {
    const file = loaded([noPlan("pos-a", "2026-07-01", 2)], [skip(1, "pos-a", "2026-06-01")]);
    const lookup = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    if (lookup.status !== "ended") throw new Error(`expected ended, got ${lookup.status}`);
    expect(lookup.endedBy.effectiveAt).toBe("2026-07-01");
    expect(lookup.skipped).toEqual([skip(1, "pos-a", "2026-06-01")]);
  });

  it("`ended` is UNCHANGED by born-ness — `pending` replaces `active` only", () => {
    const file = loaded([noPlan("pos-a", "2026-07-01", 1)]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-10", NOBODY).status).toBe("ended");
  });

  it("`unreadable` is UNCHANGED by born-ness", () => {
    const file = loaded([], [skip(1, "pos-a", "2026-06-01")]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-10", NOBODY).status).toBe("unreadable");
  });
});

describe("pickPlanAsOf — `pending` vs `active` is driven SOLELY by existingPositionIds", () => {
  it("flips on born-ness with an otherwise identical file, date and position", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 1)]);
    const unborn = pickPlanAsOf(file, "pos-a", "2026-07-10", NOBODY);
    const born = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a"));
    expect(unborn.status).toBe("pending");
    expect(born.status).toBe("active");
    // Day zero renders `pending`, never `$0` — and the plan itself is identical.
    if (unborn.status !== "pending" || born.status !== "active") throw new Error("unreachable");
    expect(unborn.plan).toEqual(born.plan);
  });

  it("a set naming OTHER positions does not make this one born", () => {
    const file = loaded([ladder("pos-a", "2026-07-01", 1)]);
    expect(pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-b", "pos-c")).status).toBe("pending");
  });
});

describe("pickPlanAsOf — plan bodies survive selection intact", () => {
  it("carries a `dcaLadder` body through unchanged", () => {
    const plan: LoadedPlanRecord = {
      kind: "dcaLadder",
      positionId: "pos-a",
      effectiveAt: "2026-07-01",
      line: 1,
      tierOrder: ["c1", "c2"],
      rungs: [
        { id: "rung-1", priceUsd: 90, sizeUsd: 30 },
        { id: "rung-2", priceUsd: 80, sizeUsd: 40 },
      ],
    };
    const lookup = pickPlanAsOf(loaded([plan]), "pos-a", "2026-07-10", BORN("pos-a"));
    if (lookup.status !== "active" || lookup.plan.kind !== "dcaLadder") {
      throw new Error("expected an active dcaLadder");
    }
    expect(lookup.plan.rungs).toEqual([
      { id: "rung-1", priceUsd: 90, sizeUsd: 30 },
      { id: "rung-2", priceUsd: 80, sizeUsd: 40 },
    ]);
    expect(lookup.plan.tierOrder).toEqual(["c1", "c2"]);
  });

  it("carries a `dcaTime` body through unchanged", () => {
    const plan: LoadedPlanRecord = {
      kind: "dcaTime",
      positionId: "pos-b",
      effectiveAt: "2026-07-01",
      line: 1,
      cadence: "monthly",
      anchorAt: "2026-02-15",
      amountUsd: 12.5,
      tierOrder: ["c1"],
    };
    const lookup = pickPlanAsOf(loaded([plan]), "pos-b", "2026-07-10", BORN("pos-b"));
    if (lookup.status !== "active" || lookup.plan.kind !== "dcaTime") {
      throw new Error("expected an active dcaTime");
    }
    expect(lookup.plan.cadence).toBe("monthly");
    expect(lookup.plan.amountUsd).toBe(12.5);
    expect(lookup.plan.anchorAt).toBe("2026-02-15");
  });
});

describe("`unattributable` is FILE-GLOBAL — not this position's damage", () => {
  const orphans = [skip(3), skip(7)];
  const file = loaded(
    [ladder("pos-a", "2026-07-01", 1), timePlan("pos-b", "2026-07-01", 2)],
    [orphans[0]!, orphans[1]!],
  );

  it("two different positions carry the IDENTICAL unattributable array", () => {
    const a = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a", "pos-b"));
    const b = pickPlanAsOf(file, "pos-b", "2026-07-10", BORN("pos-a", "pos-b"));
    expect(a.unattributable).toEqual(orphans);
    expect(b.unattributable).toEqual(orphans);
    expect(a.unattributable).toEqual(b.unattributable);
  });

  it("does NOT smear into either position's own `skipped`", () => {
    const a = pickPlanAsOf(file, "pos-a", "2026-07-10", BORN("pos-a", "pos-b"));
    if (a.status !== "active") throw new Error(`expected active, got ${a.status}`);
    expect(a.skipped).toEqual([]);
  });

  it("reaches even a position the sidecar never names, through the `none` arm", () => {
    expect(pickPlanAsOf(file, "pos-z", "2026-07-10", NOBODY)).toEqual({
      status: "none",
      unattributable: orphans,
    });
  });

  it("reports unattributable skips in FILE ORDER", () => {
    const scrambled = loaded([], [skip(9), skip(2), skip(5)]);
    expect(pickPlanAsOf(scrambled, "pos-z", "2026-07-10", NOBODY).unattributable.map((s) => s.line)).toEqual([2, 5, 9]);
  });
});

describe("`load-failed` → `unreadable` for EVERY position, never `none`", () => {
  const failed: LoadedPlans = {
    load: { status: "load-failed", message: "EACCES" },
    plans: [],
    skipped: [],
  };

  it("answers `unreadable` for a position the file never mentioned", () => {
    expect(pickPlanAsOf(failed, "pos-anything", "2026-07-10", BORN("pos-anything"))).toEqual({
      status: "unreadable",
      skipped: [],
      unattributable: [],
    });
  });

  it("answers `unreadable` regardless of born-ness", () => {
    expect(pickPlanAsOf(failed, "pos-a", "2026-07-10", NOBODY).status).toBe("unreadable");
  });

  it("`listPlansAsOf` reports no rows but does not claim the fund has no plans", () => {
    expect(listPlansAsOf(failed, "2026-07-10", NOBODY)).toEqual({
      positions: [],
      unattributable: [],
    });
  });
});

describe("`asOf` is REQUIRED and validated with the same strict validator as `effectiveAt`", () => {
  const file = loaded([ladder("pos-a", "2026-07-01", 1)]);

  it("rejects a non-strict ISO date rather than mis-sorting it", () => {
    expect(() => pickPlanAsOf(file, "pos-a", "2026-7-1", NOBODY)).toThrow(/not a calendar date/);
    expect(() => listPlansAsOf(file, "2026-7-1", NOBODY)).toThrow(/not a calendar date/);
  });

  it("rejects the forms that would sort under `0`", () => {
    expect(() => pickPlanAsOf(file, "pos-a", "08/10/2026", NOBODY)).toThrow();
    expect(() => pickPlanAsOf(file, "pos-a", "2026-07-01T00:00:00Z", NOBODY)).toThrow();
    expect(() => pickPlanAsOf(file, "pos-a", "", NOBODY)).toThrow();
  });

  it("rejects an impossible calendar date", () => {
    expect(() => pickPlanAsOf(file, "pos-a", "2026-02-30", NOBODY)).toThrow();
  });
});

describe("a wholly empty `LoadedPlans`", () => {
  const empty = loaded([]);

  it("answers `none` from `pickPlanAsOf`", () => {
    expect(pickPlanAsOf(empty, "pos-a", "2026-07-10", BORN("pos-a"))).toEqual({
      status: "none",
      unattributable: [],
    });
  });

  it("answers an empty roster from `listPlansAsOf`", () => {
    expect(listPlansAsOf(empty, "2026-07-10", BORN("pos-a"))).toEqual({
      positions: [],
      unattributable: [],
    });
  });
});

describe("listPlansAsOf — one row per position NAMED BY THE SIDECAR", () => {
  it("omits positions with no sidecar line and keeps first-mention file order", () => {
    const file = loaded(
      [ladder("pos-b", "2026-07-01", 2), timePlan("pos-a", "2026-07-01", 1)],
      [skip(3, "pos-c", "2026-06-01")],
    );
    const roster = listPlansAsOf(file, "2026-07-10", BORN("pos-a", "pos-b", "pos-c"));
    expect(roster.positions.map((row) => row.positionId)).toEqual(["pos-a", "pos-b", "pos-c"]);
    // `pos-z` exists in the fold but nowhere in the sidecar — omitted here, and
    // `pickPlanAsOf` is the surface that answers `none` for it.
    expect(roster.positions.some((row) => row.positionId === "pos-z")).toBe(false);
    expect(pickPlanAsOf(file, "pos-z", "2026-07-10", BORN("pos-z")).status).toBe("none");
  });

  /**
   * The title used to be "agrees with `pickPlanAsOf` row by row", and it carried a
   * second assertion — `expect(row.lookup).toEqual(pickPlanAsOf(file, row.positionId,
   * …))` — that was a TAUTOLOGY: `listPlansAsOf` builds each row by making exactly that
   * call, so it holds for any delegating implementation including a broken one. It has
   * been removed rather than rewritten; what a roster test can actually pin is that the
   * three states come out in file order, which is what remains.
   */
  it("resolves each row's state, in first-mention file order", () => {
    const file = loaded(
      [
        ladder("pos-a", "2026-07-01", 1),
        noPlan("pos-b", "2026-06-01", 2),
        timePlan("pos-c", "2026-05-01", 3),
      ],
      [skip(4, "pos-c", "2026-07-01"), skip(5)],
    );
    const born = BORN("pos-a", "pos-b");
    const roster = listPlansAsOf(file, "2026-07-10", born);
    expect(roster.positions.map((row) => row.lookup.status)).toEqual([
      "active",
      "ended",
      "unreadable",
    ]);
  });

  it("keeps its own top-level `unattributable` when there are no rows at all", () => {
    // A file whose only corrupt lines are unattributable yields `positions: []`, so
    // the top level is the SOLE channel — the duplication is structural.
    const file = loaded([], [skip(1), skip(2)]);
    expect(listPlansAsOf(file, "2026-07-10", NOBODY)).toEqual({
      positions: [],
      unattributable: [skip(1), skip(2)],
    });
  });

  it("lists a position named ONLY by a future-dated skip, as a `none` row", () => {
    // A deliberate leak of "the sidecar knows this id" — never of any figure.
    const file = loaded([], [skip(1, "pos-future", "2099-01-01")]);
    const roster = listPlansAsOf(file, "2026-07-10", NOBODY);
    expect(roster.positions).toEqual([
      { positionId: "pos-future", lookup: { status: "none", unattributable: [] } },
    ]);
  });

  it("renders `pending` for a declared-but-unborn position", () => {
    const file = loaded([ladder("pos-new", "2026-07-01", 1)]);
    const roster = listPlansAsOf(file, "2026-07-10", NOBODY);
    expect(roster.positions.map((row) => row.lookup.status)).toEqual(["pending"]);
  });
});
