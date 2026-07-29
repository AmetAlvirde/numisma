/**
 * PROTOTYPE (`prototype/plans-sidecar`) — the pure half of the DCA plan sidecar.
 * Implements `S1`–`S7` of the sidecar-door grill (2026-07-28). Per the standing
 * prototype rule this is a SPECIMEN and does not merge; the real increment reuses
 * whatever `audit` clears.
 *
 * The plan sidecar (`plans.jsonl`, read by `@numisma/preferences`) is the second
 * append-only sidecar, alongside `preferences.jsonl`. This module is its SELECTOR
 * half only: ADR-004's split says the pure as-of selector lives in the engine and
 * "no engine code touches a file", so every function here is pure and takes the
 * already-loaded result.
 *
 * WHY THIS SITS AT THE ENGINE'S TOP LEVEL, not in `compose/` (grill open question 3):
 * `compose/` holds read-time DERIVATIONS over the folded book — `report.ts`,
 * `canonical.ts`, `detail.ts`, `row-dependencies.ts`. A plan is not derived from
 * the fold and never touches it; it is a standalone durable stream, selected by
 * date. That makes this module a sibling of `data-dir.ts` and `price-journey.ts`,
 * not of the compose layer. `pickPolicyAsOf` lives in `compose/profit-split.ts`
 * only because the policy it selects is consumed by the split derivation defined
 * in the same file; a plan has no such consumer today.
 *
 * DESCRIPTIVE-ONLY, and this is a hard lock (`S9`): nothing here is ever folded and
 * nothing here touches NAV. A plan describes an intention about the future; letting
 * it reach the fund's actual value would leak a hypothetical into a real number.
 */

/**
 * The envelope common to EVERY plan line, including `noPlan`.
 *
 * Parsing this BEFORE dispatching on `kind` is load-bearing (`S5`/`S6`): it is what
 * lets a line with an unreadable BODY still be attributed to a position and a date,
 * which is the whole reason a skip can warn instead of vanishing. Per `S5` this
 * envelope is the emerging shared abstraction — DISCOVERED by the loader's needs
 * rather than designed up front — and no further abstraction over the kinds is to
 * be built until strategy #3.
 *
 * `kind`, not `type`: `type` is the EVENT envelope's discriminator, and a plan is
 * not an event (ADR-004 / map 4.1). Reusing the word would blur that line.
 */
export interface PlanEnvelope {
  kind: string;
  positionId: string;
  /** Strict ISO `YYYY-MM-DD` — see `PLAN_ISO_DATE`. */
  effectiveAt: string;
}

/**
 * One rung of a ladder.
 *
 * INVENTED BY THIS PROTOTYPE — `S5` fixed the envelope and the discriminator and
 * DELIBERATELY left the bodies to `spec` (grill "Parked": rung representation and
 * size units are open). Treat this shape as a plausible placeholder, NOT as a
 * decided contract. Two properties of it are load-bearing regardless of the final
 * shape, though:
 *
 *   - `priceUsd` is an ABSOLUTE price, never a date. `S9`: rungs sit on a PRICE
 *     axis, so "if all 8 fill" has an exact quantity and average cost with no
 *     price forecast. A date axis would smuggle in a forecast the fund has no
 *     basis for.
 *   - `id` is stable per rung, so a later fill can be joined back to the rung it
 *     filled. That join key is `D7`'s still-open residual (the Bitget export
 *     carries no order id); this field is where the answer will land.
 */
export interface DcaRung {
  id: string;
  priceUsd: number;
  sizeUsd: number;
}

/** Fields shared by the two ACTIVE plan kinds (not by `noPlan`). */
interface ActivePlanBase extends PlanEnvelope {
  /**
   * The tier-consumption ordering — a FIELD on the plan, not a peer artifact
   * (`S1`). It inherits the plan's `effectiveAt` for free, which is exactly the
   * versioning that "replay a past projection" (grill mode 3) needs and no more.
   */
  tierOrder: string[];
}

/** A ladder of absolute-price rungs. Body shape is INVENTED — see `DcaRung`. */
export interface DcaLadderPlan extends ActivePlanBase {
  kind: "dcaLadder";
  rungs: DcaRung[];
}

/** A cadence-based accumulation. Body shape is INVENTED — see `DcaRung`. */
export interface DcaTimePlan extends ActivePlanBase {
  kind: "dcaTime";
  cadence: "daily" | "weekly" | "monthly";
  amountUsd: number;
  /** Strict ISO `YYYY-MM-DD`. */
  startsAt: string;
}

/**
 * The TERMINATOR (`S7`). Under latest-`effectiveAt`-wins selection a plan otherwise
 * never ends — the last line stays in effect forever. `pickPolicyAsOf` never needed
 * this because the fund always HAS a profit policy; a plan genuinely stops.
 *
 * Pause and end are the SAME ACT: resumption is just a later plan line. The
 * distinction between them is intent, so it lives in `reason` and never in the
 * schema. (Rejected: a `status: active|paused|ended` field on every kind, which
 * would force re-appending an entire ladder just to pause it.)
 */
export interface NoPlanRecord extends PlanEnvelope {
  kind: "noPlan";
  reason?: string;
}

/** A plan that actually prescribes something. */
export type ActivePlan = DcaLadderPlan | DcaTimePlan;

/** Every well-formed line the loader can return, terminator included. */
export type PlanRecord = ActivePlan | NoPlanRecord;

/** The kinds THIS build understands. A line outside this set is `unknownKind`. */
export const KNOWN_PLAN_KINDS = ["dcaLadder", "dcaTime", "noPlan"] as const;

/**
 * Why a line was skipped (`S6`). These are DIFFERENT INSTRUCTIONS to the reader and
 * conflating them is a lie:
 *
 *   - `unknownKind` — "your checkout is older than your data; pull." The line is
 *     well-formed and fully attributable; this build simply has no reader for it.
 *     This is the forward-compat cliff that scheduled #153, handled by skipping
 *     instead of throwing because a plan is descriptive-only and never touches NAV.
 *   - `invalid` — "the line is corrupt." Bad JSON, or a broken envelope/body.
 */
export type PlanSkipReason = "unknownKind" | "invalid";

/**
 * A line the loader could not return as a plan, carrying whatever of the envelope
 * survived so the skip can be ATTRIBUTED. `positionId`/`effectiveAt`/`kind` are
 * optional precisely because a corrupt line may not have them — but an
 * `unknownKind` skip ALWAYS has all three, which is what makes `S6`'s per-position
 * "not readable" surface rule implementable.
 */
export interface SkippedPlanLine {
  reason: PlanSkipReason;
  /** 1-based line number in the sidecar, so a human can go find it. */
  line: number;
  kind?: string;
  positionId?: string;
  effectiveAt?: string;
  /** Human-readable detail — never the raw line, which may carry figures. */
  detail: string;
}

/**
 * What the loader hands back: the readable plans PLUS the skips, split by cause.
 *
 * The skips ride in the RETURN VALUE, never stderr alone (`S6`). The push runs
 * headless at 18:00 and the TUI is interactive; a warning printed to a stream
 * nobody reads is a silent skip with extra steps. Silent dropping is already ruled
 * a defect in this repo by name (finding M1).
 *
 * Deliberately NOT reusing the engine's `Warning`/`WarningCode` (grill open
 * question 4): `WarningCode` is a closed union with an exhaustive
 * `validationSeverityByCode` record, so adding plan codes would make every consumer
 * of the FOLD's warning vocabulary carry plan concerns, and deleting the DCA
 * feature would mean un-unioning a shared type. That is precisely the cost `S3`
 * rejected Door A for. The shape is mirrored (code + message + attribution); the
 * type is not shared.
 */
export interface LoadedPlans {
  plans: PlanRecord[];
  unknownKind: SkippedPlanLine[];
  invalid: SkippedPlanLine[];
}

/**
 * Strict ISO calendar date (`YYYY-MM-DD`, no time component). Selection orders and
 * filters by STRING comparison, so `effectiveAt` must be lexicographically
 * sortable-as-chronological. A `Date.parse`-able but non-ISO stamp (`01/02/2026`)
 * or a date-time (`...T00:00:00Z`) would sort wrong and silently select the wrong
 * plan, so those are quarantined. Same rule, same reason, as `preferences.ts`.
 */
export const PLAN_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isPlanIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    PLAN_ISO_DATE.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/**
 * The outcome of asking "what plan governed this position on this date?".
 *
 * `S7`/Key fact 6 name THREE outcomes a surface must never conflate, and this type
 * makes conflating them impossible — the caller cannot get at a plan without first
 * naming which case it is in:
 *
 *   - `none`       — this position never had a plan as of that date.
 *   - `active`     — a plan was in force.
 *   - `ended`      — a `noPlan` terminator was in force; the plan STOPPED.
 *   - `unreadable` — a line that bears on this answer was skipped, so the honest
 *                    answer is "not readable", never "no plan". Those are opposite
 *                    facts (`S6`'s surface rule).
 *
 * `skipped` is present on EVERY variant, not just `unreadable`: a position can have
 * a perfectly readable current plan and ALSO an unreadable line elsewhere in its
 * history, and a surface replaying an earlier date deserves to know.
 */
export type PlanLookup =
  | { status: "none"; skipped: SkippedPlanLine[] }
  | { status: "active"; plan: ActivePlan; skipped: SkippedPlanLine[] }
  | { status: "ended"; plan: NoPlanRecord; skipped: SkippedPlanLine[] }
  | { status: "unreadable"; skipped: SkippedPlanLine[] };

/** Ascending by `effectiveAt`; ties keep the file's append order (stable sort). */
function byEffectiveAt<T extends { effectiveAt: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : 0,
  );
}

/**
 * Skips that bear on THIS position, whether or not they name a date.
 *
 * A skip with no readable `positionId` (a corrupt line) cannot be attributed, so it
 * is deliberately NOT folded into any single position's answer — it would smear one
 * broken line across every position's view. It is still returned by the loader in
 * `invalid`, and `listPlansAsOf` surfaces it separately.
 */
function skipsForPosition(
  loaded: LoadedPlans,
  positionId: string,
): SkippedPlanLine[] {
  return [...loaded.unknownKind, ...loaded.invalid].filter(
    (skip) => skip.positionId === positionId,
  );
}

/**
 * PURE selector: which plan governed `positionId` on `asOf`?
 *
 * Selection is the same latest-`effectiveAt ≤ asOf` rule as `pickPolicyAsOf`
 * (`profit-split.ts:63-66`), with one structural difference `S1`/ground-truth-1
 * forced: `pickPolicyAsOf` is SINGULAR because one profit policy governs the whole
 * fund, whereas plans are per-position and several positions live at once — so this
 * takes a `positionId` and there is a plural `listPlansAsOf` beside it.
 *
 * It takes the whole `LoadedPlans` rather than a `PlanRecord[]` BECAUSE the three
 * outcomes cannot be distinguished from the readable plans alone — "not readable"
 * is knowable only from the skips. Handing this function just the plans would make
 * it structurally incapable of telling the truth.
 *
 * THE STALENESS RULE, and it is the subtle one. A skipped line does not merely mean
 * "something is missing" — if the skipped line is NEWER than the plan we would
 * otherwise return (and still within the as-of window), then it SUPERSEDES that
 * plan, and returning the older plan would be actively WRONG rather than merely
 * incomplete. Consider: a ladder readable at 08-01, a superseding ladder at 09-01
 * whose kind this build doesn't know, asked as-of 09-15. The true answer is the
 * 09-01 ladder. Returning the 08-01 one would state a plan the fund had already
 * replaced. So a skip at-or-after the winner's date, within the window, yields
 * `unreadable`.
 *
 * A skip whose `effectiveAt` is itself unreadable is treated CONSERVATIVELY as
 * possibly-eligible: it could be the superseding line, and we cannot prove it isn't.
 */
export function pickPlanAsOf(
  loaded: LoadedPlans,
  positionId: string,
  asOf?: string,
): PlanLookup {
  const skipped = skipsForPosition(loaded, positionId);

  const eligible = byEffectiveAt(
    loaded.plans.filter(
      (plan) =>
        plan.positionId === positionId &&
        (asOf === undefined || plan.effectiveAt <= asOf),
    ),
  );
  const winner = eligible.at(-1);

  // Does a skipped line bear on this answer? In-window, and not older than the
  // plan we would return. An undated skip is conservatively in-window.
  const supersedingSkip = skipped.some((skip) => {
    if (skip.effectiveAt === undefined) {
      return true;
    }
    const inWindow = asOf === undefined || skip.effectiveAt <= asOf;
    if (!inWindow) {
      return false;
    }
    return winner === undefined || skip.effectiveAt >= winner.effectiveAt;
  });

  if (supersedingSkip) {
    return { status: "unreadable", skipped };
  }
  if (winner === undefined) {
    return { status: "none", skipped };
  }
  if (winner.kind === "noPlan") {
    return { status: "ended", plan: winner, skipped };
  }
  return { status: "active", plan: winner, skipped };
}

/**
 * PURE selector, plural: every position the sidecar knows about, resolved as-of.
 *
 * "Knows about" spans the SKIPS as well as the plans — a position whose only line
 * was skipped must still appear, reporting `unreadable`. A position absent from the
 * sidecar entirely is absent here too (it is `S2`'s plan-less position, which takes
 * an interactive tier at import and is not this module's business).
 *
 * Shaped as a list keyed by `positionId` per `S8`'s multi-tenancy constraint: no
 * fund-specific constants, so a later multi-tenant pass is a config change rather
 * than a schema migration.
 *
 * `unattributable` carries skips too broken to name a position — they belong to no
 * row, and dropping them here would be the silent skip `S6` forbids.
 */
export function listPlansAsOf(
  loaded: LoadedPlans,
  asOf?: string,
): {
  positions: Array<{ positionId: string; lookup: PlanLookup }>;
  unattributable: SkippedPlanLine[];
} {
  const positionIds = new Set<string>();
  for (const plan of loaded.plans) {
    positionIds.add(plan.positionId);
  }
  for (const skip of [...loaded.unknownKind, ...loaded.invalid]) {
    if (skip.positionId !== undefined) {
      positionIds.add(skip.positionId);
    }
  }

  const positions = [...positionIds]
    .sort()
    .map((positionId) => ({
      positionId,
      lookup: pickPlanAsOf(loaded, positionId, asOf),
    }));

  const unattributable = [...loaded.unknownKind, ...loaded.invalid].filter(
    (skip) => skip.positionId === undefined,
  );

  return { positions, unattributable };
}
