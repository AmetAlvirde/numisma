/**
 * `pickReconciliationAsOf` — the trail's answer for ONE position at ONE date, and the
 * place D8's ⚠️ is enforced: **a missing or unreadable trail is UNKNOWN, never
 * clean.** The reader skips; this selector decides.
 *
 * Two properties carry the weight, and both are the kind a later simplification
 * quietly collapses:
 *
 *   1. **The ordering key is the pair `(asOf, line)`, `asOf` primary** — the fill,
 *      not the telling. A test below differs ONLY in `toldAt` and pins that
 *      `toldAt` cannot move the winner. Without the `line` half, two fills on the
 *      same day have no order and "a later clean fill clears the mark" is undefined
 *      for exactly the case it most needs to cover.
 *   2. **An unattributable skip is not a blackout.** It belongs to no position;
 *      attaching it to one would turn a single broken line into a fund-wide blackout.
 *
 * Every id, date, tier and event id below is SYNTHETIC and authored for these tests
 * (ADR-007).
 */
import { describe, expect, it } from "vitest";
import { pickReconciliationAsOf } from "./reconciliations.js";
import type {
  DeclaredAsShown,
  LoadedReconciliationRecord,
  LoadedReconciliations,
  SkippedReconciliationLine,
} from "./reconciliations.js";

const AS_OF = "2026-09-20";
const TRAIL = "/tmp/synthetic/reconciliations.jsonl";
const POSITION = "ladder-demo-01";

const DECLARED_ACTIVE: DeclaredAsShown = {
  status: "active",
  kind: "dcaLadder",
  planId: "9f1c2b64-0000-4000-8000-de5060000001",
  effectiveAt: "2026-08-15",
  tierOrder: ["c1", "c2"],
};

function line(
  overrides: Partial<LoadedReconciliationRecord> & { line: number },
): LoadedReconciliationRecord {
  return {
    positionId: POSITION,
    eventId: `evt-demo-${String(overrides.line).padStart(4, "0")}`,
    fillKind: "PositionAddedTo",
    asOf: "2026-09-04",
    toldAt: "2026-09-04T18:12:07-06:00",
    lotTier: "c1",
    declared: DECLARED_ACTIVE,
    mismatches: [],
    ...overrides,
  };
}

function loaded(
  reconciliations: LoadedReconciliationRecord[],
  skipped: SkippedReconciliationLine[] = [],
): LoadedReconciliations {
  return { load: { status: "loaded", sourcePath: TRAIL }, reconciliations, skipped };
}

describe("the selector is TOTAL, and every gap is a NAMED unknown", () => {
  it("absent: `no-trail` — the file is not there, which is not the same as naming nobody", () => {
    const verdict = pickReconciliationAsOf(
      { load: { status: "absent", sourcePath: TRAIL }, reconciliations: [], skipped: [] },
      POSITION,
      AS_OF,
    );
    expect(verdict).toEqual({ status: "unknown", reason: "no-trail", skipped: [] });
  });

  it("load-failed: `trail-unreadable` for EVERY position, including ones with lines", () => {
    const failed: LoadedReconciliations = {
      load: { status: "load-failed", sourcePath: TRAIL, message: "EACCES" },
      // A partial read must not let a surviving line assert a fact about the fund.
      reconciliations: [line({ line: 1 })],
      skipped: [],
    };
    for (const positionId of [POSITION, "never-mentioned-01"]) {
      const verdict = pickReconciliationAsOf(failed, positionId, AS_OF);
      expect(verdict.status).toBe("unknown");
      expect(verdict.status === "unknown" && verdict.reason).toBe("trail-unreadable");
    }
  });

  it("loaded but silent about this position: `no-line`", () => {
    const verdict = pickReconciliationAsOf(loaded([line({ line: 1 })]), "other-demo-02", AS_OF);
    expect(verdict).toEqual({ status: "unknown", reason: "no-line", skipped: [] });
  });

  it("a winner recording `declared.status: \"unreadable\"`: `plans-were-unreadable`, never clean", () => {
    // Empty `mismatches` and NOT clean — the two-field rule. A plans-read failure at
    // fill time is not a plan agreement.
    const record = line({ line: 1, declared: { status: "unreadable" } });
    const verdict = pickReconciliationAsOf(loaded([record]), POSITION, AS_OF);
    expect(verdict.status).toBe("unknown");
    expect(verdict.status === "unknown" && verdict.reason).toBe("plans-were-unreadable");
    expect(verdict.status === "unknown" && verdict.record).toEqual(record);
  });

  it("a clean winner is clean, and a warned winner carries its mismatches", () => {
    expect(pickReconciliationAsOf(loaded([line({ line: 1 })]), POSITION, AS_OF).status).toBe(
      "clean",
    );
    const warned = pickReconciliationAsOf(
      loaded([line({ line: 1, lotTier: "c3", mismatches: ["tierNotInPlan"] })]),
      POSITION,
      AS_OF,
    );
    expect(warned.status).toBe("warned");
    expect(warned.status === "warned" && warned.mismatches).toEqual(["tierNotInPlan"]);
  });

  it("refuses a lax query date rather than sorting wrong against it", () => {
    expect(() => pickReconciliationAsOf(loaded([]), POSITION, "09/20/2026")).toThrow(
      /calendar date/,
    );
  });
});

describe("the ordering key is `(asOf, line)` — the FILL, never the telling", () => {
  it("takes the later DATE, whatever file order says", () => {
    const verdict = pickReconciliationAsOf(
      loaded([
        line({ line: 1, asOf: "2026-09-11" }),
        line({ line: 2, asOf: "2026-09-04", lotTier: "c3", mismatches: ["tierNotInPlan"] }),
      ]),
      POSITION,
      AS_OF,
    );
    expect(verdict.status).toBe("clean");
  });

  it("breaks a same-date tie by `line`, so the last line written wins", () => {
    const verdict = pickReconciliationAsOf(
      loaded([
        line({ line: 1, asOf: "2026-09-04", lotTier: "c3", mismatches: ["tierNotInPlan"] }),
        line({ line: 2, asOf: "2026-09-04" }),
      ]),
      POSITION,
      AS_OF,
    );
    expect(verdict.status).toBe("clean");
    expect(verdict.status === "clean" && verdict.record.line).toBe(2);
  });

  it("does NOT let a later-TOLD but earlier-DATED fill win — the only difference is `toldAt`", () => {
    // A fill for the 4th recorded on the 6th must not outrank a fill for the 5th
    // recorded on the 5th. Ordering by `toldAt` would silently convert D8 into "the
    // most recent thing the operator was told", which is a different rule.
    const records = [
      line({
        line: 1,
        asOf: "2026-09-04",
        toldAt: "2026-09-06T18:00:00-06:00",
        lotTier: "c3",
        mismatches: ["tierNotInPlan"],
      }),
      line({ line: 2, asOf: "2026-09-05", toldAt: "2026-09-05T18:00:00-06:00" }),
    ];
    expect(pickReconciliationAsOf(loaded(records), POSITION, AS_OF).status).toBe("clean");

    // And the mirror: same two lines, `toldAt` swapped so the WARNED one is now the
    // most recently told. The answer must not move.
    const swapped = [
      line({ line: 1, asOf: "2026-09-04", lotTier: "c3", mismatches: ["tierNotInPlan"] }),
      line({ line: 2, asOf: "2026-09-05", toldAt: "2026-09-01T18:00:00-06:00" }),
    ];
    expect(pickReconciliationAsOf(loaded(swapped), POSITION, AS_OF).status).toBe("clean");
  });

  it("ignores lines dated AFTER the query date — the report replays a prior day honestly", () => {
    const verdict = pickReconciliationAsOf(
      loaded([
        line({ line: 1, asOf: "2026-09-04", lotTier: "c3", mismatches: ["tierNotInPlan"] }),
        line({ line: 2, asOf: "2026-09-25" }),
      ]),
      POSITION,
      "2026-09-20",
    );
    expect(verdict.status).toBe("warned");
  });
});

describe("an ATTRIBUTABLE skip that is the newest in-window line blacks out its position", () => {
  it("supersedes a readable winner when it is strictly later by the pair", () => {
    const verdict = pickReconciliationAsOf(
      loaded(
        [line({ line: 1, asOf: "2026-09-04" })],
        [
          {
            line: 2,
            reason: "invalid",
            positionId: POSITION,
            asOf: "2026-09-11",
            detail: "line is not a JSON object",
          },
        ],
      ),
      POSITION,
      AS_OF,
    );
    expect(verdict.status).toBe("unknown");
    expect(verdict.status === "unknown" && verdict.reason).toBe("trail-unreadable");
  });

  it("treats an UNDATED skip as in-window — the date it would have carried is what broke", () => {
    const undated: SkippedReconciliationLine = {
      line: 2,
      reason: "invalid",
      positionId: POSITION,
      detail: "line is not a JSON object",
    };
    const verdict = pickReconciliationAsOf(
      loaded([line({ line: 1, asOf: "2026-09-04" })], [undated]),
      POSITION,
      AS_OF,
    );
    expect(verdict.status === "unknown" && verdict.reason).toBe("trail-unreadable");

    // With no readable winner at all, the same skip is still the newest thing known.
    const alone = pickReconciliationAsOf(loaded([], [undated]), POSITION, AS_OF);
    expect(alone.status === "unknown" && alone.reason).toBe("trail-unreadable");
  });

  it("does NOT supersede a winner that is later than the skip", () => {
    const verdict = pickReconciliationAsOf(
      loaded(
        [line({ line: 3, asOf: "2026-09-11" })],
        [
          {
            line: 2,
            reason: "invalid",
            positionId: POSITION,
            asOf: "2026-09-04",
            detail: "line is not a JSON object",
          },
        ],
      ),
      POSITION,
      AS_OF,
    );
    expect(verdict.status).toBe("clean");
  });

  it("an `unsupported` skip renders unknown too — the member it could not name may be a warning", () => {
    const verdict = pickReconciliationAsOf(
      loaded(
        [line({ line: 1 })],
        [
          {
            line: 2,
            reason: "unsupported",
            positionId: POSITION,
            asOf: "2026-09-11",
            detail: "this line names a mismatch this build does not know; pull and retry",
          },
        ],
      ),
      POSITION,
      AS_OF,
    );
    expect(verdict.status === "unknown" && verdict.reason).toBe("trail-unreadable");
  });
});

describe("an UNATTRIBUTABLE skip is not a blackout", () => {
  it("leaves every position's verdict exactly as it was", () => {
    const broken: SkippedReconciliationLine = {
      line: 9,
      reason: "invalid",
      detail: "line is not JSON",
    };
    const withBreak = loaded([line({ line: 1 })], [broken]);
    const withoutBreak = loaded([line({ line: 1 })]);

    expect(pickReconciliationAsOf(withBreak, POSITION, AS_OF)).toEqual(
      pickReconciliationAsOf(withoutBreak, POSITION, AS_OF),
    );
    // Including for a position the file never names: still `no-line`, not a blackout.
    expect(pickReconciliationAsOf(withBreak, "other-demo-02", AS_OF)).toEqual({
      status: "unknown",
      reason: "no-line",
      skipped: [],
    });
  });
});
