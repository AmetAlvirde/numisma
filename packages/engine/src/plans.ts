/**
 * The `plans.jsonl` RECORD CONTRACT — the pure half of the DCA plan sidecar.
 *
 * A `Plan` is the operator's DECLARATION OF INTENT for one position: "this position
 * is a four-rung ladder", "this position buys $10 weekly", "this position is done".
 * It is the THIRD member of ADR-004's sidecar class — durable, append-only,
 * git-versioned, beside the event log and NEVER folded. `parseEvent` never sees a
 * plan line, `foldEvents` never reads one, and nothing declared here can move NAV.
 *
 * This module is PURE (ADR-001): types, the strict date predicate, the two closed
 * vocabularies (`PLAN_KINDS`, `DCA_CADENCES`), and the as-of SELECTORS
 * ({@link pickPlanAsOf}, {@link listPlansAsOf}), which are IO-free. All file IO —
 * resolve, load, append — lives in `@numisma/preferences` (`plans.ts`). The selectors
 * sit beside these declarations at the engine's TOP LEVEL rather than under
 * `compose/`: every `compose/*` module imports `FundReviewData` and this one never
 * does, and filing it there would imply a dependency every future reader must defend.
 *
 * THE FILE'S OWN VOCABULARY, stated once here because the file is append-only:
 *
 *   - **Identity is `positionId` + `effectiveAt`.** A line's NUMBER is read-side
 *     only ({@link LoadedPlanRecord}), stamped by the loader and never written.
 *   - **Supersession is the entire editing mechanism.** There is no edit and no
 *     delete: a later `effectiveAt` for the same `positionId` replaces the earlier
 *     one, and {@link NoPlanRecord} is the explicit terminator. Pause and end are
 *     the same act — resumption is simply a later plan line.
 *   - **A plan naming an UNBORN position is LEGAL.** Nothing here validates a
 *     `positionId` against the fold. Naming the position a ladder is meant to
 *     become is precisely the fact being authored. (Contrast `orders.jsonl`, which
 *     refuses a `positionId` because an Order is an observation of a venue row and
 *     the venue has never heard of a Position.)
 *   - **Open at the wire, closed at the reader.** `kind` and `cadence` are both
 *     strings on disk; a value this build does not recognize is an `unsupported`
 *     skip — "your checkout is older than your data, pull" — never a corruption
 *     claim. `tierOrder`, by contrast, is CLOSED: it is consumed to route capital,
 *     so an unrecognized tier is unusable, not merely unreadable.
 */
import type { CapitalTier, LoadOutcome } from "./contracts.js";

/**
 * The plan vocabulary — TWO kinds plus a terminator, declared ONCE, here.
 *
 * This array is the single source: the loader in `@numisma/preferences` consumes it
 * and never re-declares its own copy, so the reader cannot lawfully recognize fewer
 * kinds than the engine declares. {@link PlanKind} is derived from it rather than
 * written out again, so the two cannot drift.
 */
export const PLAN_KINDS = ["dcaLadder", "dcaTime", "noPlan"] as const;

/** `kind` on the wire. Open at the wire, closed here — see the module header. */
export type PlanKind = (typeof PLAN_KINDS)[number];

/**
 * The cadences a `dcaTime` plan may declare, declared ONCE, here — the same
 * single-source rule as {@link PLAN_KINDS}, for the same reason.
 */
export const DCA_CADENCES = ["daily", "weekly", "monthly"] as const;

/** `cadence` on a {@link DcaTimePlanRecord}. */
export type DcaCadence = (typeof DCA_CADENCES)[number];

/**
 * A strict ISO calendar date, `YYYY-MM-DD`.
 *
 * An alias rather than a brand: the value arrives as an untrusted string off a file
 * the operator hand-authors, and {@link isIsoCalendarDate} is the gate every reader
 * runs it through. The alias names the intent at every use site.
 */
export type IsoDate = string;

const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `YYYY-MM-DD` **and a real calendar date** — the file format's own rule, not a
 * stylistic one, and the reason it is strict is durable:
 *
 *   - **Selection is STRING COMPARISON.** The as-of selector picks the latest
 *     `effectiveAt ≤ asOf` by comparing strings, so a `Date.parse`-able but non-ISO
 *     stamp (`"08/10/2026"`) sorts under `"0"` and silently selects the wrong plan.
 *     Shape alone catches that.
 *   - **An overflow date makes lexicographic order diverge from chronological
 *     order.** `Date.parse("2026-02-30")` succeeds — it rolls over to March 2 — so a
 *     shape check alone accepts a string that sorts as February and means March.
 *     The ROUND TRIP is what rejects it: the date is re-rendered and compared back
 *     to the input.
 *
 * A legitimate end-of-month date (`"2026-01-31"`) round-trips exactly and passes;
 * `"2026-02-30"` does not. UTC is used deliberately — the check must not depend on
 * the machine's timezone.
 */
export function isIsoCalendarDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE_SHAPE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * The ENVELOPE — required on every line, and read BEFORE `kind` is dispatched on.
 *
 * That order is the whole reason an unreadable line can still be attributed to a
 * position: a loader that dispatched first would have nothing to say about a line
 * whose body it could not parse.
 */
interface PlanRecordBase {
  kind: PlanKind;
  /**
   * The plan's key. NOT validated against the fold — a plan naming a position that
   * does not exist yet is the normal way a ladder is declared before it is opened.
   */
  positionId: string;
  /** When this plan takes effect. Strict ISO — see {@link isIsoCalendarDate}. */
  effectiveAt: IsoDate;
}

/**
 * One rung of a ladder.
 *
 * **PROVISIONAL** — parked on piece B (the fills export). `id` exists solely as the
 * join key a later fill will match on, and the venue's export carries no order id,
 * so deciding the join before the fill shape exists is deciding it blind. Genuinely
 * inexpressible in this shape and named rather than hidden: percent-of-tier sizing
 * and a non-USD quote. A BTC-authored ladder is NOT on that list —
 * `qty = sizeUsd / priceUsd` recovers it losslessly. If piece B changes the body,
 * the repair path is the file's own mechanism: the operator supersedes with a new
 * line.
 */
export interface DcaRung {
  id: string;
  priceUsd: number;
  sizeUsd: number;
}

/**
 * A ladder of resting rungs declared as ONE plan — the fact `OrderPlacedRecord`
 * deliberately cannot carry, since it holds no `positionId` and no ladder id.
 *
 * **The body is PROVISIONAL** (see {@link DcaRung}); the ENVELOPE is not.
 */
export interface DcaLadderPlanRecord extends PlanRecordBase {
  kind: "dcaLadder";
  /**
   * The order capital is drawn down in. CLOSED and strict: `tierOrder` is consumed
   * to route capital, so an unrecognized tier is unusable rather than merely
   * unreadable, and a repeated tier makes consumption order ambiguous at the repeat.
   */
  tierOrder: CapitalTier[];
  rungs: DcaRung[];
}

/**
 * A time-based accumulation plan: buy `amountUsd` every `cadence`.
 *
 * **The body is PROVISIONAL** — parked on piece B alongside {@link DcaRung}. Named
 * rather than hidden: a base-denominated `dcaTime` plan is inexpressible here (there
 * is no price to divide by), as is the `monthly` anchor on the 29th/30th/31st, whose
 * clamp-or-skip rule is tangled with the calendar-date validation above.
 */
export interface DcaTimePlanRecord extends PlanRecordBase {
  kind: "dcaTime";
  cadence: DcaCadence;
  /**
   * The CADENCE ANCHOR — not a first-buy date. `cadence: "weekly"` alone does not
   * say which weekday; this fixes the phase. NO relation to `effectiveAt` is
   * enforced: an anchor in the past is the normal case after the first supersession.
   */
  anchorAt: IsoDate;
  amountUsd: number;
  /** Same closed, strict contract as {@link DcaLadderPlanRecord.tierOrder}. */
  tierOrder: CapitalTier[];
}

/**
 * The explicit TERMINATOR. Selection is "latest `effectiveAt ≤ asOf`", so without
 * one the last plan line stays in force forever — which is why ending a plan is an
 * act the file can state rather than an absence a reader must infer.
 *
 * Pause and end are the same act: resumption is a later plan line.
 */
export interface NoPlanRecord extends PlanRecordBase {
  kind: "noPlan";
  /** Free prose for the operator's own record. Never parsed, never rendered as fact. */
  reason?: string;
}

/** One line of `plans.jsonl`, as WRITTEN. */
export type PlanRecord = DcaLadderPlanRecord | DcaTimePlanRecord | NoPlanRecord;

/**
 * One line of `plans.jsonl`, as READ.
 *
 * The `line` is stamped by the loader and is the tie-break the selector needs when
 * two records share an `effectiveAt` (last-in-file wins). It is READ-SIDE ONLY:
 * `appendPlan` serializes a {@link PlanRecord}, so a line number can never be
 * persisted into the file it describes.
 */
export type LoadedPlanRecord = PlanRecord & { line: number };

/**
 * Why a line was skipped, split by the INSTRUCTION it carries rather than by where
 * in the parse it failed:
 *
 *   - `unsupported` — "your checkout is older than your data; pull." An unrecognized
 *     `kind` or `cadence`. The FILE is fine; this build is behind.
 *   - `invalid` — "the line is corrupt." Bad JSON, a non-object, a missing or
 *     non-calendar `effectiveAt`, an unrecognized `tierOrder` entry, a malformed
 *     body. The FILE needs a corrected line appended.
 *
 * Deliberately NOT the prototype's `unknownKind`, which would now hold lines whose
 * kind is perfectly known. And deliberately NOT `Warning`/`WarningCode`: joining a
 * closed, exhaustively-mapped union taxes every consumer of it, while deleting this
 * module must stay `rm plans.ts` plus one re-export block.
 */
export type PlanSkipReason = "unsupported" | "invalid";

/**
 * One line the loader could not turn into a record, REPORTED rather than swallowed.
 *
 * `detail` is PROSE-ONLY and never quotes the line. Plan bodies carry figures, and
 * echoing a line launders them into logs, terminals and CI output. Where a
 * diagnostic genuinely needs to name an unrecognized `kind`, the raw value rides in
 * {@link SkippedPlanLine.kindToken} — sanitized and length-capped — never
 * interpolated into the prose.
 */
export interface SkippedPlanLine {
  /** 1-based line number, so the operator can go look at it. */
  line: number;
  reason: PlanSkipReason;
  /** Scraped from the envelope where readable — the reason the parse is envelope-first. */
  positionId?: string;
  /** Scraped from the envelope where readable AND strictly valid. */
  effectiveAt?: IsoDate;
  /** Fixed prose. Never interpolates file content. */
  detail: string;
  /**
   * The unrecognized `kind`, reduced to `[A-Za-z0-9_-]` and capped. A bounded,
   * typed field — so a caller that wants to name the kind can, and no caller can
   * accidentally splice unbounded file content into a log line.
   */
  kindToken?: string;
}

/**
 * The loader's TOTAL outcome.
 *
 * `load` reuses the engine's existing two-arm {@link LoadOutcome}, and the rule
 * behind that reuse is recorded so it is not re-litigated: **reuse when joining is
 * free; refuse when joining widens a closed exhaustive union.** `LoadOutcome` costs
 * every consumer nothing and deleting this module leaves it untouched;
 * `WarningCode` would have taxed every exhaustive switch in the workspace.
 *
 * A missing file is `loaded` with empty buckets — the NORMAL STARTING STATE, not a
 * failure. Any other read error is `load-failed` with empty buckets, and the
 * distinction matters downstream: empty buckets WITHOUT the outcome would assert
 * "this position has no plan" when the truth is "the file could not be read."
 */
export interface LoadedPlans {
  load: LoadOutcome;
  plans: LoadedPlanRecord[];
  skipped: SkippedPlanLine[];
}

/**
 * The winning line when it is a PLAN rather than the terminator — the only shape
 * {@link PlanLookup}'s `pending` and `active` arms expose.
 *
 * `noPlan` is deliberately excluded: a caller holding an `ActivePlan` is holding a
 * declaration of intent it can render, never an ending it must special-case.
 */
export type ActivePlan = (DcaLadderPlanRecord | DcaTimePlanRecord) & { line: number };

/** The winning line when it is the terminator — what `ended` carries. */
export type LoadedNoPlanRecord = NoPlanRecord & { line: number };

/**
 * What the sidecar says about ONE position at ONE date — a FIVE-ARM DISCRIMINATED
 * UNION, a type rather than a convention: a caller cannot reach `plan` without first
 * naming the status, and there is no shape in which a missing plan and an unreadable
 * one look alike.
 *
 * The arms:
 *
 *   - **`none`** — the sidecar names no in-window line for this position at all. The
 *     honest "there is nothing here", and the ONLY arm that can say it.
 *   - **`pending`** — a plan is in force and names a position that does not exist
 *     yet: DECLARED, NOT YET REALIZED. Day zero renders `pending`, never `$0` — zero
 *     is a measurement, pending is the absence of one. Born-ness is supplied by the
 *     caller (`existingPositionIds`), so the selector stays pure and fold-type-free.
 *     **`pending` replaces `active` ONLY** — `ended` and `unreadable` are unchanged
 *     by born-ness.
 *   - **`active`** — a plan is **IN FORCE**. *In force, NOT accumulating.* A ladder
 *     effective months ago whose rungs sit far below spot is `active` with zero
 *     fills, possibly forever; a `dcaTime` plan whose anchor grid has not yet
 *     produced a buy is likewise `active`. The word names the POLICY in effect at
 *     that date (ADR-004), never activity in the account.
 *   - **`ended`** — the winning line is the explicit terminator, carried as
 *     `endedBy` so the caller can name the date and the operator's reason.
 *   - **`unreadable`** — the newest in-window line for this position was SKIPPED, or
 *     the whole file failed to load. Never collapsed into `none`: "the file could not
 *     be read" is a different fact from "this position has no plan."
 *
 * `skipped` carries the position's own in-window skips — the ones that were INPUTS
 * to this selection, in FILE ORDER. `unattributable` is FILE-GLOBAL: see
 * {@link pickPlanAsOf}.
 */
export type PlanLookup =
  | { status: "none"; unattributable: SkippedPlanLine[] }
  | {
      status: "pending";
      plan: ActivePlan;
      skipped: SkippedPlanLine[];
      unattributable: SkippedPlanLine[];
    }
  | {
      status: "active";
      plan: ActivePlan;
      skipped: SkippedPlanLine[];
      unattributable: SkippedPlanLine[];
    }
  | {
      status: "ended";
      endedBy: LoadedNoPlanRecord;
      skipped: SkippedPlanLine[];
      unattributable: SkippedPlanLine[];
    }
  | { status: "unreadable"; skipped: SkippedPlanLine[]; unattributable: SkippedPlanLine[] };

/** One row of {@link PlansAsOf} — a position the sidecar names, and its lookup. */
export interface PlanRow {
  positionId: string;
  lookup: PlanLookup;
}

/**
 * Every position the SIDECAR names, at one date.
 *
 * `unattributable` is repeated at the top level on purpose: a file whose only corrupt
 * lines are unattributable yields `positions: []`, so the top level is the SOLE
 * channel for them. The duplication is structural, not stylistic.
 */
export interface PlansAsOf {
  positions: PlanRow[];
  unattributable: SkippedPlanLine[];
}

/**
 * `asOf` is REQUIRED and validated by the SAME predicate `effectiveAt` goes through.
 *
 * Both operands of every comparison in this module are strings compared with `<` and
 * `>`, so a lax `asOf` (`"2026-7-1"`, `"08/10/2026"`) does not merely look wrong — it
 * SORTS wrong and silently selects a different plan. Refusing is the only honest
 * answer; there is no fallback that is not a guess.
 */
function requireAsOf(asOf: IsoDate, caller: string): void {
  if (!isIsoCalendarDate(asOf)) {
    throw new Error(`${caller}: ${JSON.stringify(asOf)} is not a calendar date`);
  }
}

/**
 * The supersession comparison: the pair `(effectiveAt, line)`, lexicographic, with
 * **`effectiveAt` PRIMARY**.
 *
 * Inverting the keys breaks as-of replay outright: a back-dated correction appended
 * today would beat a plan appended last month, and every historical query would
 * answer with a policy that was not yet in effect.
 */
function isLater(
  a: { effectiveAt: IsoDate; line: number },
  b: { effectiveAt: IsoDate; line: number },
): boolean {
  return a.effectiveAt === b.effectiveAt ? a.line > b.line : a.effectiveAt > b.effectiveAt;
}

/** File order — the operator's own reading order, and the only order a diagnostic list may take. */
function byLine<T extends { line: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => a.line - b.line);
}

/**
 * The sidecar's answer for ONE position at ONE date.
 *
 * **It takes the WHOLE {@link LoadedPlans}, and that is the point.** "Not readable"
 * is knowable only from the skips, so the skips are an **INPUT TO SELECTION**, not a
 * warning channel riding alongside the answer. A selector handed only the plans
 * computes a confident wrong answer whenever the newest line failed to parse.
 *
 * The rule:
 *
 *   1. `load-failed` → `unreadable` for EVERY position, never `none`. No new status:
 *      a whole-file failure is `unreadable`'s limiting case.
 *   2. The winner is the latest in-window (`effectiveAt ≤ asOf`) plan for the
 *      position by the pair `(effectiveAt, line)` — last-in-file wins a tie.
 *   3. A skip attributed to the position supersedes the winner iff it is in-window
 *      AND strictly later by the same pair. A DATED skip is in-window by its scraped
 *      `effectiveAt`; an UNDATED skip is CONSERVATIVELY in-window and compares by
 *      `line` alone. A superseding skip yields `unreadable` — `P3`: a strictly-newer
 *      skipped line never resolves to the plan the fund had already replaced.
 *   4. Otherwise the winner decides: the terminator → `ended`; a plan → `active`, or
 *      `pending` when `existingPositionIds` does not name the position.
 *
 * **`unattributable` is FILE-GLOBAL.** It is identical on every lookup derived from
 * the same `LoadedPlans` — *not this position's damage*. A skip whose envelope was
 * too broken to yield a `positionId` belongs to NO row; smearing it across the rows
 * would turn one broken line into a fund-wide blackout.
 *
 * **STATED LIMIT (the `P4` residual, deliberate — not a defect to fix):** an UNDATED
 * skip with NO readable winner blacks out its position at EVERY date, including dates
 * before the position's first plan existed, until the file is superseded. An undated
 * skip could carry any date, including a back-dated one, so with no winner the honest
 * answer stays `unreadable`. Flooring the blackout at `min(effectiveAt)` is unsound —
 * back-dated corrections are legal, so the floor floors nothing. The repair is the
 * file's own mechanism: append a corrected line.
 */
export function pickPlanAsOf(
  loaded: LoadedPlans,
  positionId: string,
  asOf: IsoDate,
  existingPositionIds: ReadonlySet<string>,
): PlanLookup {
  requireAsOf(asOf, "pickPlanAsOf");

  const unattributable = byLine(loaded.skipped.filter((entry) => entry.positionId === undefined));

  const skipped = byLine(
    loaded.skipped.filter(
      (entry) =>
        entry.positionId === positionId &&
        // Undated skips are conservatively in-window: the date they would have
        // carried is exactly what could not be read.
        (entry.effectiveAt === undefined || entry.effectiveAt <= asOf),
    ),
  );

  if (loaded.load.status === "load-failed") {
    return { status: "unreadable", skipped, unattributable };
  }

  let winner: LoadedPlanRecord | undefined;
  for (const plan of loaded.plans) {
    if (plan.positionId !== positionId || plan.effectiveAt > asOf) continue;
    if (winner === undefined || isLater(plan, winner)) winner = plan;
  }

  if (winner === undefined) {
    // No readable winner: any in-window skip is the newest thing known about this
    // position, and the honest answer is `unreadable` — the stated `P4` residual.
    return skipped.length > 0
      ? { status: "unreadable", skipped, unattributable }
      : { status: "none", unattributable };
  }

  const carrier = winner;
  const superseded = skipped.some((entry) =>
    entry.effectiveAt === undefined
      ? entry.line > carrier.line
      : isLater({ effectiveAt: entry.effectiveAt, line: entry.line }, carrier),
  );
  if (superseded) {
    return { status: "unreadable", skipped, unattributable };
  }

  if (winner.kind === "noPlan") {
    return { status: "ended", endedBy: winner, skipped, unattributable };
  }
  return {
    status: existingPositionIds.has(positionId) ? "active" : "pending",
    plan: winner,
    skipped,
    unattributable,
  };
}

/**
 * Every position the SIDECAR names, at one date — the roster surface.
 *
 * A row exists for a position that any plan line or any ATTRIBUTABLE skip names,
 * whatever its date; rows are in first-mention file order. Positions with no sidecar
 * line are OMITTED — {@link pickPlanAsOf} is the single-position surface, and it is
 * the one that answers `none` for them.
 *
 * A position can therefore appear solely because of a FUTURE-DATED skip, as a `none`
 * row: a deliberate leak of "the sidecar knows this id", never of any figure.
 *
 * COST, priced rather than hidden, because this module prices its costs everywhere
 * else. This delegates per row, and {@link pickPlanAsOf} re-filters `loaded.skipped`
 * twice and re-scans `loaded.plans` on each call: `O(P·(S+N))` for `P` positions, `S`
 * skips and `N` plan lines, plus `P` identical `unattributable` arrays allocated and
 * thrown away. It is NOT optimized, deliberately. Hoisting the shared work means
 * either an internal `pickPlanAsOf` variant taking pre-filtered inputs or a second
 * selection path, and a second path through the supersession comparison is the one
 * piece of this module where a divergence would be a silently wrong ladder rather
 * than a slow one. At operator scale — a fund with a few dozen positions and a
 * hand-authored file — the whole roster is microseconds. Revisit if `P·S` ever
 * reaches a size a desk command can feel; delegating to ONE comparison is worth
 * more than the constant factor until then.
 */
export function listPlansAsOf(
  loaded: LoadedPlans,
  asOf: IsoDate,
  existingPositionIds: ReadonlySet<string>,
): PlansAsOf {
  requireAsOf(asOf, "listPlansAsOf");

  const unattributable = byLine(loaded.skipped.filter((entry) => entry.positionId === undefined));
  if (loaded.load.status === "load-failed") {
    return { positions: [], unattributable };
  }

  const named: { line: number; positionId: string }[] = [
    ...loaded.plans.map((plan) => ({ line: plan.line, positionId: plan.positionId })),
    ...loaded.skipped.flatMap((entry) =>
      entry.positionId === undefined ? [] : [{ line: entry.line, positionId: entry.positionId }],
    ),
  ];

  const seen = new Set<string>();
  const positions: PlanRow[] = [];
  for (const mention of byLine(named)) {
    if (seen.has(mention.positionId)) continue;
    seen.add(mention.positionId);
    positions.push({
      positionId: mention.positionId,
      lookup: pickPlanAsOf(loaded, mention.positionId, asOf, existingPositionIds),
    });
  }
  return { positions, unattributable };
}
