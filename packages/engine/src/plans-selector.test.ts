// PROTOTYPE (`prototype/plans-sidecar`) — the PURE as-of selectors over the plan
// sidecar. Locks the four outcomes a surface must never conflate (`S6`/`S7`):
//
//   none       — never had a plan
//   active     — a plan was in force
//   ended      — a `noPlan` terminator was in force
//   unreadable — a line bearing on this answer was skipped
//
// EVERY LADDER HERE IS SYNTHETIC (`S8`). Sibling: `preferences-selector.test.ts`.
import { describe, expect, it } from "vitest";
import {
  listPlansAsOf,
  pickPlanAsOf,
  type DcaLadderPlan,
  type DcaTimePlan,
  type LoadedPlans,
  type NoPlanRecord,
  type SkippedPlanLine,
} from "./plans.js";

const POS = "pos-synthetic-1";
const OTHER = "pos-synthetic-2";

function ladder(effectiveAt: string, positionId = POS, rungPrice = 50_000): DcaLadderPlan {
  return {
    kind: "dcaLadder",
    positionId,
    effectiveAt,
    tierOrder: ["c2", "c1"],
    rungs: [{ id: "r1", priceUsd: rungPrice, sizeUsd: 100 }],
  };
}

function timed(effectiveAt: string, positionId = POS): DcaTimePlan {
  return {
    kind: "dcaTime",
    positionId,
    effectiveAt,
    tierOrder: ["c1"],
    cadence: "weekly",
    amountUsd: 50,
    startsAt: effectiveAt,
  };
}

function noPlan(effectiveAt: string, positionId = POS, reason?: string): NoPlanRecord {
  return { kind: "noPlan", positionId, effectiveAt, ...(reason ? { reason } : {}) };
}

function loaded(
  plans: LoadedPlans["plans"],
  unknownKind: SkippedPlanLine[] = [],
  invalid: SkippedPlanLine[] = [],
): LoadedPlans {
  return { plans, unknownKind, invalid };
}

describe("pickPlanAsOf — latest effectiveAt <= asOf, per position", () => {
  it("returns `none` when the position never had a plan", () => {
    const result = pickPlanAsOf(loaded([ladder("2026-06-01", OTHER)]), POS, "2026-07-01");
    expect(result.status).toBe("none");
  });

  it("returns `none` for a date BEFORE the position's first plan", () => {
    const result = pickPlanAsOf(loaded([ladder("2026-06-01")]), POS, "2026-05-31");
    expect(result.status).toBe("none");
  });

  it("SUPERSEDES: the later plan wins, and the earlier one still replays", () => {
    const book = loaded([ladder("2026-06-01", POS, 50_000), ladder("2026-07-01", POS, 40_000)]);

    const later = pickPlanAsOf(book, POS, "2026-07-15");
    expect(later.status).toBe("active");
    expect(later.status === "active" && later.plan.effectiveAt).toBe("2026-07-01");

    // Faithful time travel: replaying June must not see July's re-pricing.
    const earlier = pickPlanAsOf(book, POS, "2026-06-15");
    expect(earlier.status === "active" && earlier.plan.effectiveAt).toBe("2026-06-01");
  });

  it("selects on the boundary date itself (<=, not <)", () => {
    const result = pickPlanAsOf(loaded([ladder("2026-06-01")]), POS, "2026-06-01");
    expect(result.status).toBe("active");
  });

  it("replays deterministically from a NON-MONOTONIC file (loader preserves append order)", () => {
    const book = loaded([ladder("2026-07-01"), ladder("2026-06-01"), timed("2026-06-15")]);
    const result = pickPlanAsOf(book, POS, "2026-06-20");
    expect(result.status === "active" && result.plan.effectiveAt).toBe("2026-06-15");
    expect(result.status === "active" && result.plan.kind).toBe("dcaTime");
  });

  it("takes the latest plan overall when `asOf` is omitted", () => {
    const book = loaded([ladder("2026-06-01"), ladder("2026-07-01")]);
    const result = pickPlanAsOf(book, POS);
    expect(result.status === "active" && result.plan.effectiveAt).toBe("2026-07-01");
  });

  it("keeps positions independent — one position's plan never answers for another", () => {
    const book = loaded([ladder("2026-06-01", POS), timed("2026-06-02", OTHER)]);
    expect(pickPlanAsOf(book, POS, "2026-07-01").status === "active").toBe(true);
    const other = pickPlanAsOf(book, OTHER, "2026-07-01");
    expect(other.status === "active" && other.plan.kind).toBe("dcaTime");
  });
});

describe("pickPlanAsOf — noPlan terminates, and `ended` is not `none`", () => {
  it("returns `ended` (never `none`) after a terminator", () => {
    const book = loaded([ladder("2026-06-01"), noPlan("2026-07-01", POS, "fully filled")]);
    const result = pickPlanAsOf(book, POS, "2026-07-15");

    // The distinction is the point: "ended on that date" and "never had a plan" are
    // different facts, and a surface that shows the same thing for both is lying.
    expect(result.status).toBe("ended");
    expect(result.status === "ended" && result.plan.reason).toBe("fully filled");
  });

  it("still shows the plan for dates BEFORE the terminator", () => {
    const book = loaded([ladder("2026-06-01"), noPlan("2026-07-01")]);
    expect(pickPlanAsOf(book, POS, "2026-06-30").status).toBe("active");
    expect(pickPlanAsOf(book, POS, "2026-07-01").status).toBe("ended");
  });

  it("RESUMES: a later plan line after a noPlan puts a plan back in force", () => {
    const book = loaded([
      ladder("2026-06-01"),
      noPlan("2026-07-01", POS, "paused, waiting for a lower entry"),
      timed("2026-08-01"),
    ]);

    // Pause and end are the same act; resumption is just a later line (`S7`).
    expect(pickPlanAsOf(book, POS, "2026-06-15").status).toBe("active");
    expect(pickPlanAsOf(book, POS, "2026-07-15").status).toBe("ended");
    const resumed = pickPlanAsOf(book, POS, "2026-08-15");
    expect(resumed.status).toBe("active");
    expect(resumed.status === "active" && resumed.plan.kind).toBe("dcaTime");
  });

  it("a position whose ONLY line is a terminator reads `ended`, not `none`", () => {
    const result = pickPlanAsOf(loaded([noPlan("2026-06-01")]), POS, "2026-07-01");
    expect(result.status).toBe("ended");
  });
});

describe("pickPlanAsOf — a skipped line means NOT READABLE, never `no plan`", () => {
  const unknown = (effectiveAt: string | undefined, positionId: string | undefined = POS) =>
    ({
      reason: "unknownKind",
      line: 1,
      kind: "dcaFromTheFuture",
      ...(positionId === undefined ? {} : { positionId }),
      ...(effectiveAt === undefined ? {} : { effectiveAt }),
      detail: "no reader",
    }) satisfies SkippedPlanLine;

  it("reports `unreadable` when the position's ONLY line was skipped", () => {
    const result = pickPlanAsOf(loaded([], [unknown("2026-06-01")]), POS, "2026-07-01");
    // S6's surface rule: "not readable" and "no plan" are OPPOSITE facts.
    expect(result.status).toBe("unreadable");
    expect(result.skipped).toHaveLength(1);
  });

  it("reports `unreadable` when a skipped line SUPERSEDES the readable one", () => {
    // The subtle case: an 08-01 ladder is readable, but a 09-01 line this build
    // cannot read replaced it. Returning the 08-01 ladder would state a plan the
    // fund had ALREADY REPLACED — wrong, not merely incomplete.
    const book = loaded([ladder("2026-08-01")], [unknown("2026-09-01")]);
    expect(pickPlanAsOf(book, POS, "2026-09-15").status).toBe("unreadable");
  });

  it("still answers `active` when the skipped line is OLDER than the winner", () => {
    // A skip that was already superseded by a readable plan does not poison the
    // answer — the newer readable line is the truth regardless.
    const book = loaded([ladder("2026-09-01")], [unknown("2026-08-01")]);
    const result = pickPlanAsOf(book, POS, "2026-09-15");
    expect(result.status).toBe("active");
    // ...but the skip still RIDES ALONG, so a surface replaying August can warn.
    expect(result.skipped).toHaveLength(1);
  });

  it("still answers `active` when the skipped line is OUTSIDE the as-of window", () => {
    const book = loaded([ladder("2026-08-01")], [unknown("2026-09-01")]);
    // Asked as-of August, September's unreadable line is simply not yet in effect.
    expect(pickPlanAsOf(book, POS, "2026-08-15").status).toBe("active");
  });

  it("treats a skip with an UNREADABLE date conservatively as possibly-superseding", () => {
    const book = loaded([ladder("2026-08-01")], [], [unknown(undefined)]);
    // It could be the superseding line; we cannot prove it isn't.
    expect(pickPlanAsOf(book, POS, "2026-09-15").status).toBe("unreadable");
  });

  it("does NOT let another position's skip poison this position's answer", () => {
    const book = loaded([ladder("2026-08-01", POS)], [unknown("2026-09-01", OTHER)]);
    expect(pickPlanAsOf(book, POS, "2026-09-15").status).toBe("active");
  });

  it("does NOT smear an UNATTRIBUTABLE skip across every position", () => {
    // A corrupt line with no readable positionId belongs to no row. Attributing it
    // to everyone would turn one broken line into a fund-wide blackout.
    const orphan: SkippedPlanLine = { reason: "invalid", line: 1, detail: "not valid JSON" };
    const book = loaded([ladder("2026-08-01", POS)], [], [orphan]);
    expect(pickPlanAsOf(book, POS, "2026-09-15").status).toBe("active");
  });

  it("distinguishes an `invalid` skip from an `unknownKind` one in what it carries", () => {
    const book = loaded(
      [],
      [unknown("2026-06-01")],
      [{ reason: "invalid", line: 2, positionId: POS, detail: "malformed body" }],
    );
    const result = pickPlanAsOf(book, POS, "2026-07-01");
    expect(result.status).toBe("unreadable");
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(["invalid", "unknownKind"]);
  });
});

describe("listPlansAsOf — every position the sidecar knows about", () => {
  it("resolves each position independently and sorts by positionId", () => {
    const book = loaded([
      ladder("2026-06-01", OTHER),
      ladder("2026-06-01", POS),
      noPlan("2026-07-01", POS),
    ]);

    const { positions } = listPlansAsOf(book, "2026-07-15");
    expect(positions.map((p) => p.positionId)).toEqual([POS, OTHER]);
    expect(positions.map((p) => p.lookup.status)).toEqual(["ended", "active"]);
  });

  it("INCLUDES a position whose only line was skipped, reporting `unreadable`", () => {
    const book = loaded(
      [ladder("2026-06-01", POS)],
      [
        {
          reason: "unknownKind",
          line: 2,
          kind: "dcaFromTheFuture",
          positionId: OTHER,
          effectiveAt: "2026-06-02",
          detail: "no reader",
        },
      ],
    );

    const { positions } = listPlansAsOf(book, "2026-07-01");
    // Dropping this row would be exactly the silent skip `S6` forbids.
    expect(positions).toHaveLength(2);
    expect(positions.find((p) => p.positionId === OTHER)?.lookup.status).toBe("unreadable");
  });

  it("surfaces unattributable skips separately rather than dropping them", () => {
    const book = loaded(
      [ladder("2026-06-01")],
      [],
      [{ reason: "invalid", line: 3, detail: "not valid JSON" }],
    );

    const { positions, unattributable } = listPlansAsOf(book, "2026-07-01");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.lookup.status).toBe("active");
    expect(unattributable).toHaveLength(1);
    expect(unattributable[0]!.line).toBe(3);
  });

  it("returns nothing for an empty sidecar", () => {
    expect(listPlansAsOf(loaded([]), "2026-07-01")).toEqual({
      positions: [],
      unattributable: [],
    });
  });

  it("time-travels the whole list, not just one row", () => {
    const book = loaded([ladder("2026-06-01", POS), ladder("2026-07-01", OTHER)]);

    const june = listPlansAsOf(book, "2026-06-15");
    expect(june.positions.map((p) => p.lookup.status)).toEqual(["active", "none"]);

    const july = listPlansAsOf(book, "2026-07-15");
    expect(july.positions.map((p) => p.lookup.status)).toEqual(["active", "active"]);
  });
});

describe("the tier ordering rides on the plan (S1)", () => {
  it("inherits the plan's effectiveAt — re-ordering tiers is just a new plan line", () => {
    const book = loaded([
      { ...ladder("2026-06-01"), tierOrder: ["c1", "c2"] },
      { ...ladder("2026-07-01"), tierOrder: ["c2", "c1"] },
    ]);

    // Mode 3 of the time machine: replaying a PAST projection sees the ordering that
    // was declared then, with no second artifact and no second contract.
    const june = pickPlanAsOf(book, POS, "2026-06-15");
    expect(june.status === "active" && june.plan.tierOrder).toEqual(["c1", "c2"]);
    const july = pickPlanAsOf(book, POS, "2026-07-15");
    expect(july.status === "active" && july.plan.tierOrder).toEqual(["c2", "c1"]);
  });
});
