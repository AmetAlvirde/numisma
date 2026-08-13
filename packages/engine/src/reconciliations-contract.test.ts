/**
 * The PURE half of the `reconciliations.jsonl` contract: the closed mismatch
 * vocabulary, the verdict function total over `PlanLookup`'s five arms, the
 * two-field CLEAN/WARNED/INDETERMINATE rule, and the canonical write shape.
 *
 * Every id, date, tier and figure below is SYNTHETIC and invented for these tests.
 * The fund's real fills, plans and figures must never enter this repository
 * (ADR-007); these tests assert PROPERTIES of the format, never a real value.
 */
import { describe, expect, it } from "vitest";
import {
  RECONCILIATION_MISMATCHES,
  classifyReconciliation,
  isRecordEventId,
  isRenderableRecordId,
  reconcileAgainstPlan,
  serializeReconciliationRecord,
  type PlanReconciliation,
  type ReconciliationRecord,
} from "./reconciliations.js";
import type { ActivePlan, LoadedNoPlanRecord, PlanLookup } from "./plans.js";

const LADDER_ID = "9f1c2b64-0000-4000-8000-de5060000001";

/** A synthetic two-tier ladder. The rungs exist precisely so the copy can drop them. */
const ladder: ActivePlan = {
  kind: "dcaLadder",
  id: LADDER_ID,
  positionId: "ladder-demo-01",
  effectiveAt: "2026-08-15",
  tierOrder: ["c1", "c2"],
  rungs: [
    { id: "r1", priceUsd: 41000, sizeUsd: 250 },
    { id: "r2", priceUsd: 39000, sizeUsd: 250 },
  ],
  line: 3,
};

/** A synthetic time plan — no `id`, hence no `planId` in the copy. */
const timePlan: ActivePlan = {
  kind: "dcaTime",
  positionId: "time-demo-01",
  effectiveAt: "2026-08-01",
  cadence: "weekly",
  anchorAt: "2026-08-03",
  amountUsd: 100,
  tierOrder: ["c2"],
  line: 4,
};

const terminator: LoadedNoPlanRecord = {
  kind: "noPlan",
  positionId: "ladder-demo-02",
  effectiveAt: "2026-09-01",
  reason: "synthetic terminator",
  line: 5,
};

const noneLookup: PlanLookup = { status: "none", unattributable: [] };
const endedLookup: PlanLookup = {
  status: "ended",
  endedBy: terminator,
  skipped: [],
  unattributable: [],
};
const unreadableLookup: PlanLookup = {
  status: "unreadable",
  skipped: [],
  unattributable: [],
};
const activeLadder: PlanLookup = {
  status: "active",
  plan: ladder,
  skipped: [],
  unattributable: [],
};
const pendingLadder: PlanLookup = {
  status: "pending",
  plan: ladder,
  skipped: [],
  unattributable: [],
};

/**
 * Every NUMBER reachable in a serialized line, by path. The trail carries no
 * figures, so this must always be empty — a name-based grep would miss a figure
 * under an innocent key, and the `line` stamp is itself a number.
 */
function numericLeaves(value: unknown, path = "$"): string[] {
  if (typeof value === "number") {
    return [path];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => numericLeaves(entry, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) =>
      numericLeaves(entry, `${path}.${key}`),
    );
  }
  return [];
}

/** A record built around one reconciliation, so the write shape can be asserted. */
function recordFrom(
  reconciled: PlanReconciliation,
  overrides: Partial<ReconciliationRecord> = {},
): ReconciliationRecord {
  return {
    positionId: "ladder-demo-01",
    eventId: "evt-demo-0007",
    fillKind: "PositionAddedTo",
    asOf: "2026-09-04",
    toldAt: "2026-09-04T18:12:07-06:00",
    lotTier: "c3",
    declared: reconciled.declared,
    mismatches: reconciled.mismatches,
    ...overrides,
  };
}

describe("the mismatch vocabulary is CLOSED at two members", () => {
  it("declares exactly `tierNotInPlan` and `noPlanInForce`", () => {
    // A third member is a spec change, not a build decision. `dcaTime` cadence is
    // named in the spec as deliberately undecided and is NOT here.
    expect(RECONCILIATION_MISMATCHES).toEqual(["tierNotInPlan", "noPlanInForce"]);
    expect(RECONCILIATION_MISMATCHES).toHaveLength(2);
  });
});

describe("the verdict function is TOTAL over `PlanLookup`'s five arms", () => {
  it("active: a lot tier IN `tierOrder` yields no mismatch", () => {
    const reconciled = reconcileAgainstPlan({ lookup: activeLadder, lotTier: "c2" });
    expect(reconciled.declared).toEqual({
      status: "active",
      kind: "dcaLadder",
      planId: LADDER_ID,
      effectiveAt: "2026-08-15",
      tierOrder: ["c1", "c2"],
    });
    expect(reconciled.mismatches).toEqual([]);
    expect(classifyReconciliation(reconciled)).toBe("clean");
  });

  it("active: a lot tier ABSENT from `tierOrder` yields exactly `tierNotInPlan`", () => {
    // The check is MEMBERSHIP, never drawdown order: `c1` is first in the order and
    // `c2` is a later rung, yet a `c2` fill is clean because `c2` is declared.
    const reconciled = reconcileAgainstPlan({ lookup: activeLadder, lotTier: "c3" });
    expect(reconciled.mismatches).toEqual(["tierNotInPlan"]);
    expect(classifyReconciliation(reconciled)).toBe("warned");
  });

  it("pending: reachable, correct, and running the SAME membership test", () => {
    // The reconcile is passed the PRE-FILL existing-position set, so a
    // `PositionOpened` fill records the plan as it stood at the telling: still
    // pending. That is the truthful account of the loop closing.
    const clean = reconcileAgainstPlan({ lookup: pendingLadder, lotTier: "c1" });
    expect(clean.declared).toMatchObject({ status: "pending", kind: "dcaLadder" });
    expect(clean.mismatches).toEqual([]);
    expect(classifyReconciliation(clean)).toBe("clean");

    const warned = reconcileAgainstPlan({ lookup: pendingLadder, lotTier: "c3" });
    expect(warned.mismatches).toEqual(["tierNotInPlan"]);
  });

  it("ended: exactly `noPlanInForce`, carrying only `effectiveAt` beside its status", () => {
    const reconciled = reconcileAgainstPlan({ lookup: endedLookup, lotTier: "c1" });
    expect(reconciled.declared).toEqual({ status: "ended", effectiveAt: "2026-09-01" });
    // The terminator's `reason` is the operator's free prose and is not copied.
    expect(reconciled.declared).not.toHaveProperty("reason");
    expect(reconciled.mismatches).toEqual(["noPlanInForce"]);
    expect(classifyReconciliation(reconciled)).toBe("warned");
  });

  it("none: exactly `noPlanInForce`, and the copy carries nothing but the status", () => {
    const reconciled = reconcileAgainstPlan({ lookup: noneLookup, lotTier: "c1" });
    expect(reconciled.declared).toEqual({ status: "none" });
    expect(reconciled.mismatches).toEqual(["noPlanInForce"]);
    expect(classifyReconciliation(reconciled)).toBe("warned");
  });

  it("unreadable: mints NO mismatch and yields NO clean verdict", () => {
    // A plans-read failure is not a plan disagreement (D3 is closed), so it must not
    // mint a third mismatch kind. It rides on `declared.status` instead.
    const reconciled = reconcileAgainstPlan({ lookup: unreadableLookup, lotTier: "c2" });
    expect(reconciled.declared).toEqual({ status: "unreadable" });
    expect(reconciled.mismatches).toEqual([]);
    expect(classifyReconciliation(reconciled)).toBe("indeterminate");
    expect(classifyReconciliation(reconciled)).not.toBe("clean");
  });

  it("a `dcaTime` plan copies no `planId`, because it declares none", () => {
    const activeTime: PlanLookup = {
      status: "active",
      plan: timePlan,
      skipped: [],
      unattributable: [],
    };
    const reconciled = reconcileAgainstPlan({ lookup: activeTime, lotTier: "c2" });
    expect(reconciled.declared).toEqual({
      status: "active",
      kind: "dcaTime",
      effectiveAt: "2026-08-01",
      tierOrder: ["c2"],
    });
    expect(reconciled.declared).not.toHaveProperty("planId");
  });
});

describe("an empty `mismatches` is NECESSARY but not SUFFICIENT for clean", () => {
  it("calls the only clean shape clean, and every other empty-mismatch shape not", () => {
    // The whole of F1's ruling: a fill recorded while `plans.jsonl` was unreadable
    // would otherwise write `mismatches: []` and the report would show an
    // unqualified clean `active` — false assurance produced by a plans-read failure.
    expect(
      classifyReconciliation({ declared: { status: "active", kind: "dcaLadder", effectiveAt: "2026-08-15", tierOrder: ["c1"] }, mismatches: [] }),
    ).toBe("clean");
    expect(
      classifyReconciliation({ declared: { status: "pending", kind: "dcaTime", effectiveAt: "2026-08-01", tierOrder: ["c1"] }, mismatches: [] }),
    ).toBe("clean");
    expect(classifyReconciliation({ declared: { status: "unreadable" }, mismatches: [] })).toBe(
      "indeterminate",
    );
    expect(classifyReconciliation({ declared: { status: "none" }, mismatches: [] })).toBe(
      "indeterminate",
    );
    expect(
      classifyReconciliation({ declared: { status: "ended", effectiveAt: "2026-09-01" }, mismatches: [] }),
    ).toBe("indeterminate");
  });

  it("a non-empty `mismatches` warns whatever the declared status says", () => {
    expect(
      classifyReconciliation({
        declared: { status: "active", kind: "dcaLadder", effectiveAt: "2026-08-15", tierOrder: ["c1"] },
        mismatches: ["tierNotInPlan"],
      }),
    ).toBe("warned");
  });
});

describe("the write shape: a fixed field order, and NO figures", () => {
  const fixtures: ReconciliationRecord[] = [
    recordFrom(reconcileAgainstPlan({ lookup: activeLadder, lotTier: "c3" })),
    recordFrom(reconcileAgainstPlan({ lookup: activeLadder, lotTier: "c2" }), {
      eventId: "evt-demo-0008",
      asOf: "2026-09-11",
      toldAt: "2026-09-11T18:03:44-06:00",
      lotTier: "c2",
    }),
    recordFrom(reconcileAgainstPlan({ lookup: pendingLadder, lotTier: "c1" }), {
      eventId: "evt-demo-0009",
      fillKind: "PositionOpened",
      lotTier: "c1",
    }),
    recordFrom(reconcileAgainstPlan({ lookup: endedLookup, lotTier: "c1" }), {
      positionId: "ladder-demo-02",
      eventId: "evt-demo-0010",
      fillKind: "PositionOpened",
      lotTier: "c1",
    }),
    recordFrom(reconcileAgainstPlan({ lookup: noneLookup, lotTier: "c1" }), {
      positionId: "ladder-demo-02",
      eventId: "evt-demo-0011",
      fillKind: "PositionOpened",
      asOf: "2026-09-12",
      toldAt: "2026-09-12T18:01:19-06:00",
      lotTier: "c1",
    }),
    recordFrom(reconcileAgainstPlan({ lookup: unreadableLookup, lotTier: "c2" }), {
      positionId: "ladder-demo-03",
      eventId: "evt-demo-0012",
      fillKind: "PositionOpened",
      asOf: "2026-09-13",
      toldAt: "2026-09-13T18:00:52-06:00",
      lotTier: "c2",
    }),
  ];

  it("emits the declared fields in a fixed order", () => {
    const serialized = serializeReconciliationRecord(fixtures[0]!);
    expect(Object.keys(JSON.parse(serialized) as object)).toEqual([
      "positionId",
      "eventId",
      "fillKind",
      "asOf",
      "toldAt",
      "lotTier",
      "declared",
      "mismatches",
    ]);
    expect(Object.keys((JSON.parse(serialized) as { declared: object }).declared)).toEqual([
      "status",
      "kind",
      "planId",
      "effectiveAt",
      "tierOrder",
    ]);
  });

  it("emits no `line` key, even for an input that structurally is a loaded record", () => {
    // A `LoadedReconciliationRecord` is structurally a `ReconciliationRecord`, so a
    // caller round-tripping a loaded line would type-check perfectly — and persist a
    // second, immediately-stale identity into an append-only file.
    const serialized = serializeReconciliationRecord({ ...fixtures[0]!, line: 7 } as never);
    expect(serialized).not.toContain("line");
    expect(JSON.parse(serialized)).not.toHaveProperty("line");
  });

  it("carries no `rungs`, no `priceUsd`, no `sizeUsd` and no figure at all", () => {
    // The trail carries NO FIGURES — no price, no size, no amount, no balance. The
    // ladder fixture above genuinely holds rungs and the time plan an `amountUsd`,
    // so this grep is over a copy that had figures available to leak.
    for (const record of fixtures) {
      const serialized = serializeReconciliationRecord(record);
      expect(serialized).not.toContain("rungs");
      expect(serialized).not.toContain("priceUsd");
      expect(serialized).not.toContain("sizeUsd");
      expect(serialized).not.toContain("amountUsd");
      // And no NUMBER anywhere: every leaf on the line is a string, so a numeric
      // leaf is a figure that escaped, whatever it happens to be called.
      expect(numericLeaves(JSON.parse(serialized))).toEqual([]);
    }

    const timeSerialized = serializeReconciliationRecord(
      recordFrom(
        reconcileAgainstPlan({
          lookup: { status: "active", plan: timePlan, skipped: [], unattributable: [] },
          lotTier: "c2",
        }),
        { positionId: "time-demo-01", eventId: "evt-demo-0013", lotTier: "c2" },
      ),
    );
    expect(timeSerialized).not.toContain("amountUsd");
    expect(timeSerialized).not.toContain("anchorAt");
    expect(numericLeaves(JSON.parse(timeSerialized))).toEqual([]);
  });
});

describe("`positionId` is held to the renderable-id rule", () => {
  it("accepts an ordinary id and refuses the three unsafe shapes", () => {
    expect(isRenderableRecordId("ladder-demo-01")).toBe(true);
    expect(isRenderableRecordId("")).toBe(false);
    expect(isRenderableRecordId("x".repeat(64))).toBe(true);
    expect(isRenderableRecordId("x".repeat(65))).toBe(false);
    // The forging pair: an id holding a newline fabricates a row on the exact page
    // the runbook tells the operator to check against.
    expect(isRenderableRecordId("ladder\ndemo")).toBe(false);
    expect(isRenderableRecordId("ladder\rdemo")).toBe(false);
    expect(isRenderableRecordId("ladder\u007fdemo")).toBe(false);
    expect(isRenderableRecordId(undefined)).toBe(false);
  });

  it("is refused by the record contract's own guard rather than reaching a page", () => {
    const clean = reconcileAgainstPlan({ lookup: activeLadder, lotTier: "c2" });
    for (const positionId of ["", "x".repeat(65), "ladder\ndemo-01"]) {
      expect(() => serializeReconciliationRecord(recordFrom(clean, { positionId }))).toThrow(
        /positionId/,
      );
    }
    // The refusal never interpolates the offending value: it is the thing that may
    // hold a control character, and the message travels to stderr and CI output.
    expect(() =>
      serializeReconciliationRecord(recordFrom(clean, { positionId: "ladder\ndemo-01" })),
    ).not.toThrow(/ladder/);
  });
});

describe("`eventId` is held to the SAME rule minus the length bound", () => {
  it("accepts an id past 64 characters — the only shape a real fill produces", () => {
    // The bound protects the plans report page's id column, and `eventId` is not on
    // that page. Keeping it here refused every id the fill path can compose.
    expect(isRecordEventId("x".repeat(65))).toBe(true);
    expect(isRecordEventId("x".repeat(4096))).toBe(true);
  });

  it("still refuses empty and control characters — identity, and it reaches stderr", () => {
    expect(isRecordEventId("evt-demo-0007")).toBe(true);
    expect(isRecordEventId("")).toBe(false);
    expect(isRecordEventId("fill:demo\nfill:other")).toBe(false);
    expect(isRecordEventId("fill:demo\rfill:other")).toBe(false);
    expect(isRecordEventId("fill:demo\u007ffill:other")).toBe(false);
    expect(isRecordEventId(undefined)).toBe(false);
  });

  it("differs from the renderable rule on LENGTH and on nothing else", () => {
    for (const value of ["", "x", "a\nb", "a\u0000b", "x".repeat(64), undefined, 7]) {
      expect(isRecordEventId(value)).toBe(isRenderableRecordId(value));
    }
  });
});
