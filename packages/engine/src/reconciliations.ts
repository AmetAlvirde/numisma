/**
 * The `reconciliations.jsonl` RECORD CONTRACT — the pure half of the plan
 * reconciliation trail (E2, #321).
 *
 * A trail line is THE RECORD THAT THE OPERATOR WAS TOLD: at a named moment a reader
 * compared one fill against the `plans.jsonl` declaration in force and showed the
 * operator the result. `plans.jsonl` stays authoritative, always; a line here never
 * overrides it, corrects it, or is read in preference to it. The file's full header
 * — authority, durability, the never-folded rule — lives on the IO module in
 * `@numisma/preferences`, which is what documents the FILE (S6a).
 *
 * This module is PURE (ADR-001): the closed mismatch vocabulary, the record and
 * read-side shapes, the verdict function, the CLEAN/WARNED/INDETERMINATE rule, and
 * the canonical serializer. All file IO — resolve, load, append — lives in
 * `@numisma/preferences` (`reconciliations.ts`), mirroring the `plans.ts` split
 * exactly.
 *
 * WHY EVERY TYPE IS DECLARED HERE, INCLUDING THE READ-SIDE ONES. The spec sketches
 * {@link LoadedReconciliations} under a `packages/preferences/…` comment while giving
 * `pickReconciliationAsOf(loaded: LoadedReconciliations, …)` as an ENGINE function.
 * Those cannot both hold: under ADR-001 the dependency runs one way only —
 * `preferences → engine` — and `packages/engine/package.json` declares no
 * dependencies at all, so an engine selector could never see a preferences-declared
 * type. `LoadedPlans`, `LoadedPlanRecord` and `SkippedPlanLine` are all declared in
 * the engine's `plans.ts` and merely IMPLEMENTED by the preferences loader; this
 * mirrors that. Moving these declarations "back" to the IO module would not compile.
 */
import type { CapitalTier } from "./contracts.js";
import type { IsoDate, PlanLookup } from "./plans.js";

/**
 * D3's mismatch vocabulary, CLOSED at two members. It does not grow without a
 * decision.
 *
 * Declared ONCE, here, and {@link ReconciliationMismatch} is derived from it rather
 * than written out again, so the two cannot drift — the same single-source rule
 * `PLAN_KINDS` states. The loader in `@numisma/preferences` consumes this list and
 * never re-declares its own copy.
 *
 * A cadence mismatch for `dcaTime` plans ("a fill arrived off the anchor grid") is
 * deliberately UNDECIDED and is not a member; the array shape of
 * {@link ReconciliationRecord.mismatches} is what leaves room for it.
 */
export const RECONCILIATION_MISMATCHES = ["tierNotInPlan", "noPlanInForce"] as const;

/** One kind of disagreement between a fill and the plan in force. */
export type ReconciliationMismatch = (typeof RECONCILIATION_MISMATCHES)[number];

/**
 * D5's copy: the declared values AS SHOWN, with arms mirroring {@link PlanLookup}'s
 * one for one.
 *
 * REQUIRED on every line — never optional, never omitted, never null. This is the
 * clause most likely to be "simplified" away later, on the entirely
 * reasonable-sounding grounds that the declared values are already in
 * `plans.jsonl`. THEY ARE NOT — not as they stood on the day the operator was told.
 * Plan supersession is APPEND and `pickPlanAsOf` selects the latest
 * `effectiveAt <= asOf`, so a line appended later but DATED EARLIER retroactively
 * changes what re-derivation returns for a fill already recorded. That is what makes
 * this file durable, non-re-derivable truth under ADR-006's membership test, and it
 * is the whole of its right to sit in `TRACKED_FILES`. **Any change that drops
 * `declared` from a trail line also drops the file's right to be tracked.**
 *
 * WHAT THE COPY DELIBERATELY EXCLUDES: `rungs`. The copy carries `kind`,
 * `effectiveAt`, `tierOrder` and the ladder's `planId` — exactly the values the
 * verdict was computed from — and nothing else. Rungs carry `priceUsd` and
 * `sizeUsd`, which are the fund's figures; `plans.ts` calls its never-quote-the-line
 * rule "a security property and not a style rule" on precisely that ground. THE
 * TRAIL CARRIES NO FIGURES — no price, no size, no amount, no balance, in the record
 * or in any diagnostic this module emits.
 */
export type DeclaredAsShown =
  | {
      status: "active" | "pending";
      kind: "dcaLadder" | "dcaTime";
      effectiveAt: IsoDate;
      tierOrder: CapitalTier[];
      /** The ladder's own durable id. Absent on `dcaTime`, which declares none. */
      planId?: string;
    }
  | { status: "ended"; effectiveAt: IsoDate }
  | { status: "none" }
  | { status: "unreadable" };

/** The two fill events that can open or grow a position — D7's "one line per fill". */
export type ReconciliationFillKind = "PositionOpened" | "PositionAddedTo";

/**
 * One line of `reconciliations.jsonl`, as WRITTEN.
 *
 * Why each field, and why nothing else:
 *
 *   - `positionId` is D2's join and the only key the report needs. It is held to
 *     `isRenderableId`'s rule — see {@link isRenderableRecordId}.
 *   - `eventId` is what makes D7 checkable: `BaseEvent.id` is the stable,
 *     client-provided dedup identity, so "one line per fill" has an executable
 *     meaning and a re-recorded fill is recognizable rather than a second silent
 *     line.
 *   - `asOf` is both the fill's date and the date `pickPlanAsOf` selected on.
 *     Recording it is what makes the §6 divergence detectable: without it a later
 *     reader does not know which date to re-derive at.
 *   - `toldAt` is the audit fact the file exists for — WHEN THE OPERATOR WAS TOLD.
 *     It is deliberately NOT an ordering key: ordering is by `(asOf, line)`, because
 *     a fill for the 4th recorded on the 6th must not outrank a fill for the 5th
 *     recorded on the 5th.
 *   - `mismatches` is a bare closed vocabulary because both kinds are fully
 *     explained by fields already on the line. At most ONE element is reachable
 *     today — with no plan in force there is no `tierOrder` to test membership
 *     against — so ordering within the array is moot; the array shape is kept so a
 *     future kind needs no shape change.
 */
export interface ReconciliationRecord {
  /** D2's join key. Held to {@link isRenderableRecordId}'s rule. */
  positionId: string;
  /** `BaseEvent.id` of the fill. D7's "one line per fill" is one line per event id. */
  eventId: string;
  fillKind: ReconciliationFillKind;
  /** The fill's own `asOf`, and the date `pickPlanAsOf` selected on. Strict ISO. */
  asOf: IsoDate;
  /** THE TELLING — when the operator was shown this. Instant, explicit offset. */
  toldAt: string;
  /** The observed side of D3's membership test. */
  lotTier: CapitalTier;
  declared: DeclaredAsShown;
  /** Empty is a NECESSARY but not SUFFICIENT condition for clean — see below. */
  mismatches: ReconciliationMismatch[];
}

/**
 * One line of `reconciliations.jsonl`, as READ.
 *
 * The `line` is stamped by the loader and is READ-SIDE ONLY. D8 scopes its mark to
 * the LATEST FILL per position, and the comparison is the pair `(asOf, line)`,
 * lexicographic with `asOf` primary — `isLater`'s exact comparison, reused rather
 * than re-derived. Without the stamp, two fills sharing a date have no order and
 * "a later clean fill clears the mark" is undefined for the case it most needs to
 * cover. Written down, though, the line number becomes a second, immediately-stale
 * identity for a record whose identity is `eventId`, which is why
 * {@link serializeReconciliationRecord} can never emit it.
 */
export type LoadedReconciliationRecord = ReconciliationRecord & { line: number };

/**
 * Why a line was skipped, split by the INSTRUCTION it carries — the same taxonomy
 * `PlanSkipReason` states, and it earns its place differently here.
 *
 *   - `unsupported` — "your checkout is older than your data; pull." Nothing outside
 *     this repo writes this file, so there is no third-party author to be ahead of —
 *     but a NEWER CHECKOUT of this repo could add a mismatch kind, and an older
 *     checkout reading that line must not silently drop the member it cannot name.
 *     Decisively: **an `unsupported` line renders unknown, never clean**, because the
 *     thing this checkout cannot name might be a warning.
 *   - `invalid` — the line is corrupt. This file is MACHINE-WRITTEN, so a skip here
 *     is not an operator typo; it is a torn write or corruption, and therefore a
 *     genuine incident.
 */
export type ReconciliationSkipReason = "unsupported" | "invalid";

/**
 * One line the loader could not turn into a record, REPORTED rather than swallowed.
 *
 * `detail` is PROSE-ONLY and never quotes the line, and never carries a figure.
 */
export interface SkippedReconciliationLine {
  /** 1-based line number, so the operator can go look at it. */
  line: number;
  reason: ReconciliationSkipReason;
  /** Scraped from the envelope where readable — the reason the parse is envelope-first. */
  positionId?: string;
  /** Scraped from the envelope where readable AND strictly valid. */
  asOf?: IsoDate;
  /** Fixed prose. Never interpolates file content, never names a figure. */
  detail: string;
}

/**
 * The loader's TOTAL outcome — implemented in `@numisma/preferences`, declared here.
 *
 * THREE `load` arms where `loadPlans` has two, and the third is not a stylistic
 * departure. `loadPlans` folds `ENOENT` into `loaded` because a hand-authored file's
 * absence means the operator has not written a line yet, and reporting that as an
 * error would cry wolf on every fresh checkout. This file is MACHINE-WRITTEN: its
 * absence means the writer has never succeeded — which is D6's own failure mode, and
 * the one fact the operator most needs. Different fact, different instruction,
 * therefore a different bucket. `absent` is NOT an error and keeps exit code 0;
 * `load-failed` and any skip exit 1.
 */
export interface LoadedReconciliations {
  load:
    | { status: "absent"; sourcePath: string }
    | { status: "loaded"; sourcePath: string }
    | { status: "load-failed"; sourcePath: string; message: string };
  reconciliations: LoadedReconciliationRecord[];
  skipped: SkippedReconciliationLine[];
}

/**
 * What the trail says about ONE position at ONE date — declared here, SELECTED by
 * `pickReconciliationAsOf` in a later slice.
 *
 * The four unknown reasons never collapse into one, because each carries its own
 * operator instruction: `no-trail` (check the data dir, and whether this build has
 * the trail at all), `no-line` (the fill predates the trail, or the best-effort
 * write failed — look for the stderr warn), `trail-unreadable` (repair or supersede
 * the line), `plans-were-unreadable` (the PLANS sidecar was broken at fill time;
 * re-run the check).
 */
export type ReconciliationVerdict =
  | { status: "clean"; record: LoadedReconciliationRecord }
  | {
      status: "warned";
      record: LoadedReconciliationRecord;
      mismatches: ReconciliationMismatch[];
    }
  | {
      status: "unknown";
      reason: "no-trail" | "no-line" | "trail-unreadable" | "plans-were-unreadable";
      record?: LoadedReconciliationRecord;
      skipped: SkippedReconciliationLine[];
    };

/** The two computed fields of a {@link ReconciliationRecord} — S2's whole output. */
export interface PlanReconciliation {
  declared: DeclaredAsShown;
  mismatches: ReconciliationMismatch[];
}

/** What one trail line SAYS, derived from two fields together — see {@link classifyReconciliation}. */
export type ReconciliationClass = "clean" | "warned" | "indeterminate";

const POSITION_ID_MAX_LENGTH = 64;

/**
 * `positionId`'s rule, restated here rather than shared, for `isRenderableId`'s own
 * stated reason: this id travels onto the plans report page, and an id holding a
 * newline forges a fabricated row on the exact page the runbook tells the operator
 * to check against. The bound is the same argument once more — an unbounded id is
 * not just a long string, it sets the id column width for EVERY row on the page.
 *
 * Restated rather than imported because `isRenderableId` is private to
 * `@numisma/preferences`, and the engine cannot import that package (ADR-001). It is
 * exported as a PREDICATE, not only enforced inside the serializer, so a caller on
 * the fill path can check without catching: D6 forbids a throw there.
 */
export function isRenderableRecordId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= POSITION_ID_MAX_LENGTH &&
    // C0 controls plus DEL. `\n` and `\r` are the forging pair; the rest join them
    // because none of them belongs in an identifier and every one moves a cursor.
    // eslint-disable-next-line no-control-regex -- matching control chars is the point
    !/[\u0000-\u001F\u007F]/.test(value)
  );
}

/**
 * S2 + S2a — THE VERDICT FUNCTION. Pure, IO-free, and TOTAL over
 * {@link PlanLookup}'s five arms.
 *
 * | lookup       | declared                                    | mismatches                          |
 * | ------------ | ------------------------------------------- | ----------------------------------- |
 * | `active`     | `{status, kind, effectiveAt, tierOrder, …}`  | `["tierNotInPlan"]` iff not a member |
 * | `pending`    | same                                        | same membership test                |
 * | `ended`      | `{status, effectiveAt}`                     | `["noPlanInForce"]`                 |
 * | `none`       | `{status}`                                  | `["noPlanInForce"]`                 |
 * | `unreadable` | `{status}`                                  | `[]` — **and this is not clean**    |
 *
 * THE TIER CHECK IS MEMBERSHIP, NEVER DRAWDOWN ORDER (D3). Asking "is this the
 * correct NEXT tier" would pull available-capital machinery into the fill path,
 * which cuts against D1's advisory-and-never-fails discipline.
 *
 * `unreadable` MINTS NO MISMATCH. A plans-read failure is not a plan disagreement;
 * it is carried by `declared.status` and made indeterminate by
 * {@link classifyReconciliation}.
 *
 * `pending` IS REACHABLE AND CORRECT. The reconcile is passed the PRE-FILL
 * existing-position set, so a `PositionOpened` fill records the plan as it stood at
 * the moment of the telling: still pending. That is the truthful account — the line
 * is the record of the loop closing.
 *
 * The switch is exhaustive by construction: adding a sixth arm to `PlanLookup` fails
 * the typecheck at the `never` assignment rather than falling through to a default.
 */
export function reconcileAgainstPlan(input: {
  lookup: PlanLookup;
  lotTier: CapitalTier;
}): PlanReconciliation {
  const { lookup, lotTier } = input;
  switch (lookup.status) {
    case "active":
    case "pending": {
      const { plan } = lookup;
      const declared: DeclaredAsShown = {
        status: lookup.status,
        kind: plan.kind,
        effectiveAt: plan.effectiveAt,
        tierOrder: [...plan.tierOrder],
        // Only a ladder declares an id; `dcaTime` has none to copy.
        ...(plan.kind === "dcaLadder" ? { planId: plan.id } : {}),
      };
      return {
        declared,
        mismatches: plan.tierOrder.includes(lotTier) ? [] : ["tierNotInPlan"],
      };
    }
    case "ended":
      return {
        declared: { status: "ended", effectiveAt: lookup.endedBy.effectiveAt },
        mismatches: ["noPlanInForce"],
      };
    case "none":
      return { declared: { status: "none" }, mismatches: ["noPlanInForce"] };
    case "unreadable":
      return { declared: { status: "unreadable" }, mismatches: [] };
    default: {
      const unreachable: never = lookup;
      return unreachable;
    }
  }
}

/**
 * F1's ruling: **an empty `mismatches` is not clean by itself.**
 *
 * A line is CLEAN iff `mismatches` is empty AND `declared.status` is `active` or
 * `pending`. A line is WARNED iff `mismatches` is non-empty. A line whose
 * `declared.status` is `unreadable` is INDETERMINATE — it renders unknown, never
 * clean.
 *
 * The reconcile is total over a `loadPlans` that can return `load-failed`, so a fill
 * recorded while `plans.jsonl` was unreadable would otherwise write `mismatches: []`
 * and the plans report would show an unqualified clean `active` — false assurance
 * produced by a plans-read failure. `none` and `ended` are indeterminate here only
 * in the vacuous sense: both always carry `noPlanInForce`, so they are WARNED.
 */
export function classifyReconciliation(record: PlanReconciliation): ReconciliationClass {
  if (record.mismatches.length > 0) {
    return "warned";
  }
  return record.declared.status === "active" || record.declared.status === "pending"
    ? "clean"
    : "indeterminate";
}

/**
 * The CANONICAL write shape of one record: exactly the declared fields, in a fixed
 * order, and NOTHING else.
 *
 * Field-by-field rather than `JSON.stringify(record)` for `serializePlanRecord`'s own
 * reason. The read shape is `ReconciliationRecord & { line }`, and a
 * {@link LoadedReconciliationRecord} is structurally a {@link ReconciliationRecord} —
 * so a caller round-tripping a loaded record would type-check perfectly and persist a
 * LINE NUMBER into an append-only file.
 *
 * It REFUSES an unrenderable `positionId` rather than letting one reach a page. The
 * refusal is a throw, matching `appendPlan`'s round-trip invariant, and it is the
 * caller's job on the fill path to stay outside it: D6 makes the trail write
 * best-effort and outside the act, and {@link isRenderableRecordId} is exported so
 * the check can be made without catching.
 */
export function serializeReconciliationRecord(record: ReconciliationRecord): string {
  if (!isRenderableRecordId(record.positionId)) {
    // Never interpolates the offending value: it is the thing that may hold a
    // control character, and this message travels to stderr and CI output.
    throw new Error(
      "serializeReconciliationRecord: positionId must be non-empty, at most 64 characters, and free of control characters",
    );
  }
  return JSON.stringify({
    positionId: record.positionId,
    eventId: record.eventId,
    fillKind: record.fillKind,
    asOf: record.asOf,
    toldAt: record.toldAt,
    lotTier: record.lotTier,
    declared: serializeDeclared(record.declared),
    mismatches: [...record.mismatches],
  });
}

/** `declared`'s own fixed field order, per arm — and never `rungs`. */
function serializeDeclared(declared: DeclaredAsShown): Record<string, unknown> {
  switch (declared.status) {
    case "active":
    case "pending":
      return {
        status: declared.status,
        kind: declared.kind,
        ...(declared.planId === undefined ? {} : { planId: declared.planId }),
        effectiveAt: declared.effectiveAt,
        tierOrder: [...declared.tierOrder],
      };
    case "ended":
      return { status: declared.status, effectiveAt: declared.effectiveAt };
    case "none":
    case "unreadable":
      return { status: declared.status };
  }
}
