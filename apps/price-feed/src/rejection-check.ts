/**
 * Spine-rejection surfacing (slice #108, resolves PRD #105 open question 2).
 *
 * A legitimate big move or a long gap since the last mark can push a freshly
 * fetched `PriceMarked` past the spine's ±50% magnitude guard. Left alone that
 * mark sits in the inbox and is only rejected LATER, when `pnpm spine` runs — and
 * the scheduled fetch that queued it has already exited 0, so the operator never
 * learns the mark is doomed. That is the "silently missing mark" this module
 * eliminates.
 *
 * DECISION (open question 2): warn at FETCH TIME rather than surface only as a
 * spine rejection. The scheduler runs `prices:fetch`, not `pnpm spine`, so the
 * fetch is the only place a scheduled run can notice. We therefore run each mark
 * spine WOULD guard through the SAME engine guard the spine uses
 * (`crossReferenceEvent`) against the EXACT reference `ingestInbox` builds —
 * genesis + durable log, then ADVANCED by the currently-pending inbox events in
 * order — and report any that WOULD be rejected, attributably and distinctly from
 * a provider failure (different triage paths). This is a pre-flight ADVISORY: it
 * changes no engine or tui code (C1); `pnpm spine` stays the one authoritative
 * guard and the permanent manual fallback stays the operator's path (C5).
 *
 * FAITHFUL TO `ingestInbox` (tui/src/event-store.ts) BY CONSTRUCTION: the real spine
 * ingest folds genesis + log, then walks the inbox IN ORDER — dedup-skipping any id
 * already committed in the log BEFORE the guard, `crossReferenceEvent`-ing each
 * remaining event against a reference that ADVANCES with every accepted one,
 * all-or-nothing. That walk is no longer mirrored here: both paths call the engine's
 * ONE `walkPendingInbox` (audit finding 9), so it cannot drift. Only the ERROR POLICY
 * differs — the spine halts and throws, this advisory collects. Hence it (a) does NOT
 * false-positive on a
 * hand-authored corrective mark that the spine would fold in first (that mark
 * advances the reference before this run's fresh mark is judged), (b) DOES surface
 * a doomed mark left queued by a PRIOR run (spine rejects the whole batch on it,
 * so a later run must not exit 0), and (c) does NOT guard a mark spine will
 * silently dedup-skip because its id is already committed or already pending.
 *
 * ADR-001: reading genesis + log + inbox off disk is IO and lives here in the
 * shell; building the reference and evaluating the guard are the engine's pure
 * functions, consumed unchanged.
 */
import {
  buildEventReference,
  crossReferenceEvent,
  walkPendingInbox,
  type EventReference,
  type PortfolioEvent,
  type PriceMarkedEvent,
} from "@numisma/engine";
import { assertLogFullyLoaded, loadEventLog, loadGenesis } from "@numisma/event-store";
import type { FetchRunResult } from "./fetch-prices.js";
import { readInboxArray } from "./inbox.js";

/**
 * One fetched mark the spine guard would reject, carried with the engine guard's
 * OWN path and message so the surfaced reason is byte-identical to what `pnpm
 * spine` would print — no second, drifting explanation of the same rule.
 */
export interface MarkRejection {
  id: string;
  instrumentId: string;
  asOf: string;
  price: number;
  /** The engine guard's field path (e.g. `price`, `instrumentId`). */
  path: string;
  /** The engine guard's rejection message, verbatim. */
  reason: string;
}

/** On-disk locations the pre-check reads to reconstruct the spine's known world. */
export interface SpineReferencePaths {
  /** `data/genesis.json` — the immutable t0 seed. */
  genesis: string;
  /** `data/events.jsonl` — the append-only log (may not exist yet). */
  log: string;
  /**
   * The shared inbox `pnpm spine` consumes. Read (not written) so the pre-check
   * can fold the currently-pending events into the reference exactly as
   * `ingestInbox` will — the missing half that made the pre-check diverge from the
   * real spine. `PriceFeedPaths` already carries this, so callers pass it unchanged.
   */
  inbox: string;
}

/**
 * The spine's known world as `ingestInbox` will see it when it reaches THIS run's
 * fresh marks: the advanced reference, the set of ids spine dedup-skips before the
 * guard, and any already-pending mark that ALREADY trips the guard.
 */
export interface SpineWorld {
  /** genesis + durable log, ADVANCED by every accepted pending inbox event in order. */
  reference: EventReference;
  /**
   * The ids spine dedup-skips BEFORE the magnitude guard (the dedup step inside the
   * engine's `walkPendingInbox`, which `ingestInbox` and this module both call):
   * every durable-log event id plus every currently-pending inbox event id. A
   * fetched mark whose id is in here is one spine would silently skip, never guard.
   */
  seenIds: Set<string>;
  /**
   * Pending inbox marks that ALREADY fail the guard — a doomed-but-queued mark from
   * a PRIOR run. Spine rejects the whole all-or-nothing batch on these, so they are
   * surfaced by every subsequent run until the operator fixes them (Finding 4b).
   */
  pendingRejections: MarkRejection[];
}

/**
 * Reconstruct the spine's known world the way `ingestInbox` does: genesis + the
 * durable log, THEN fold in the currently-pending inbox events in order (parse
 * each, dedup-skip any id already in the log, `crossReferenceEvent` the rest and
 * `applyEventToReference` the accepted ones so the reference ADVANCES). This is the
 * exact reference the spine judges this run's fresh marks against — without it a
 * hand-authored corrective mark sitting in the inbox would make the pre-check
 * falsely report a rejection the spine would never raise.
 *
 * `options.freshlyQueuedCount` is how many records THIS run just appended to the
 * tail of the inbox (`result.emittedCount`). `mergeInbox` always appends fresh
 * marks after the pre-existing ones, so dropping that many trailing records yields
 * the PRE-EXISTING inbox state — the batch context spine folds before this run's
 * marks — and guarantees we never double-count this run's marks as both reference
 * context AND judged subjects.
 *
 * Genesis + the log are read through `@numisma/event-store` — the same
 * `loadGenesis` / `loadEventLog` + `assertLogFullyLoaded` pair `ingestInbox` and the
 * TUI's own fold use, so the pre-check cannot drift from the spine it advises on
 * (#141). Throws (fail-loud, like the spine) if genesis is MISSING or invalid, if
 * any log line will not load, or if the inbox is unreadable; the caller swallows
 * every throw into a non-fatal "pre-check unavailable" so a corrupt or unseeded
 * data dir never masks an otherwise-successful fetch. A missing genesis therefore
 * surfaces as an ENOENT note rather than silence — a pre-check needs a reference,
 * so its absence is reported as "could not pre-check", never a false all-clear.
 *
 * Reading the log refreshes `events.jsonl.quarantine` (the derived side lane), which
 * is deliberate and shared with every other reader; the log and genesis themselves
 * are never written here (R6).
 */
export async function loadSpineReference(
  paths: SpineReferencePaths,
  options?: { freshlyQueuedCount?: number },
): Promise<SpineWorld> {
  const genesis = await loadGenesis(paths.genesis);

  const load = await loadEventLog(paths.log);
  assertLogFullyLoaded(load, paths.log);
  const priorEvents: PortfolioEvent[] = load.events;

  // The known world is genesis + the durable log; accepted pending inbox events
  // extend it in order, exactly as `ingestInbox` — because it is the same walk.
  // The seed set is the log ids: the ids `walkPendingInbox` dedup-skips before the
  // guard even runs.
  const reference = buildEventReference(genesis, priorEvents);

  // Fold in the PRE-EXISTING inbox: everything on disk except the tail this run just
  // appended (which are the marks being JUDGED, not batch context — folding them
  // would double-count them against themselves).
  const inboxRecords = await readInboxArray(paths.inbox);
  const freshlyQueuedCount = options?.freshlyQueuedCount ?? 0;
  const pendingCount = Math.max(0, inboxRecords.length - freshlyQueuedCount);
  const pending = inboxRecords.slice(0, pendingCount);

  // THE SAME WALK THE SPINE RUNS (`walkPendingInbox`), differing only in error
  // policy: `ingestInbox` halts on the first refusal and throws; this advisory
  // collects every refusal, because a doomed mark queued by a prior run must not
  // hide a second one. The walk advances `reference` in place on each accepted
  // event and never on a rejected one — the spine's behavior, not a copy of it.
  const walk = walkPendingInbox(pending, reference, {
    seenIds: new Set(priorEvents.map((event) => event.id)),
  });
  if (walk.invalid) {
    // A structurally invalid pending event dooms the whole spine ingest too; the
    // caller swallows this throw into "pre-check unavailable" (non-fatal).
    throw new Error(
      `Inbox ${paths.inbox} pending event [${walk.invalid.index}] failed to parse ` +
        `(${walk.invalid.path}: ${walk.invalid.message}).`,
    );
  }
  // Finding 4b: doomed-but-queued marks from a PRIOR run. Spine rejects the whole
  // all-or-nothing batch on them, so surface them now.
  const pendingRejections: MarkRejection[] = walk.rejected.map((rejection) =>
    toMarkRejection(rejection.event, rejection.path, rejection.message),
  );

  return { reference, seenIds: walk.seenIds, pendingRejections };
}

/**
 * Run each mark through the spine's own `crossReferenceEvent` guard and return the
 * ones it would reject. Pure: it reads `reference` and never mutates it, so a
 * later mark in the same list is judged against the same known world the spine's
 * first-rejection-aborts ingest would see. `options.magnitudeThreshold` is passed
 * straight through so the pre-check always tracks the live ±50% dial.
 */
export function findMarkRejections(
  marks: readonly PriceMarkedEvent[],
  reference: EventReference,
  options?: { magnitudeThreshold?: number },
): MarkRejection[] {
  const rejections: MarkRejection[] = [];
  // Only pass the dial when the caller set it, so the engine keeps its own default
  // (exactOptionalPropertyTypes forbids handing it an explicit `undefined`).
  const guardOptions =
    options?.magnitudeThreshold === undefined
      ? undefined
      : { magnitudeThreshold: options.magnitudeThreshold };
  for (const mark of marks) {
    const result = crossReferenceEvent(mark, reference, guardOptions);
    if (result.kind !== "ok") {
      rejections.push(toMarkRejection(mark, result.path, result.message));
    }
  }
  return rejections;
}

/**
 * The marks a fetch run queued that spine will ACTUALLY guard. Uses the run's OWN
 * constructed marks (`result.marks`) rather than re-deriving from quotes — a
 * `*-mxn` mark is `USD × FIX`, not `markFromQuote`, so re-deriving would pre-check
 * the wrong (raw-USD) value against the guard.
 *
 * `seenIds` are the ids spine dedup-skips BEFORE the guard (log + pending inbox).
 * Marks whose id is in that set are dropped: `mergeInbox` dedup-skipped a mark
 * already pending, and the spine skips one already in the log (the dedup step in
 * `walkPendingInbox`, which `ingestInbox` runs), so guarding either would falsely
 * halt the wrapper on a mark spine never guards
 * (Finding 5). Only marks genuinely NEW to the batch are returned. Nothing before
 * the mark time (no marks emitted this run).
 */
export function marksFromRun(
  result: FetchRunResult,
  seenIds?: ReadonlySet<string>,
): PriceMarkedEvent[] {
  if (!result.markEmitted) {
    return [];
  }
  const seen = seenIds ?? new Set<string>();
  return result.marks.filter((mark) => !seen.has(mark.id));
}

/** Whether a rejection was found, or the pre-check could not run (no reference). */
export interface RejectionScan {
  rejections: MarkRejection[];
  /** True when no genesis reference was available, so nothing could be checked. */
  skipped: boolean;
  /** Present when the pre-check itself failed (e.g. unreadable log); non-fatal. */
  unavailableReason?: string;
}

/**
 * The fetch-time pre-check the CLI runs: rebuild the spine's world (genesis + log +
 * the pending inbox events folded in order), then report which marks spine would
 * reject — both a doomed mark already queued by a prior run and any of THIS run's
 * fresh marks that spine will actually guard. Any failure to build the reference is
 * swallowed into `unavailableReason` (never thrown) so a doomed pre-check cannot
 * turn a successful fetch+store into a crash — the authoritative guard remains
 * `pnpm spine`.
 *
 * By the time this runs the CLI has already merged this run's fresh marks into the
 * inbox, so `result.emittedCount` (how many were appended to the tail) tells
 * `loadSpineReference` how many trailing records to treat as JUDGED subjects rather
 * than PRE-EXISTING batch context — the two halves stay disjoint, no double-count.
 */
export async function scanFetchedMarks(
  result: FetchRunResult,
  paths: SpineReferencePaths,
  options?: { magnitudeThreshold?: number },
): Promise<RejectionScan> {
  // Before the mark time nothing is queued and the inbox is untouched — no pre-check.
  if (!result.markEmitted) {
    return { rejections: [], skipped: false };
  }
  let world: SpineWorld;
  try {
    world = await loadSpineReference(paths, { freshlyQueuedCount: result.emittedCount });
  } catch (error) {
    // Includes a MISSING genesis (ENOENT from `loadGenesis`): unseeded or damaged,
    // it is surfaced as one Note rather than an unexplained silent skip.
    return {
      rejections: [],
      skipped: true,
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
  // Judge only the marks spine will actually guard (new to the batch), in spine's
  // order: any already-doomed pending mark first, then this run's fresh marks
  // against the reference those pending events have advanced.
  const judged = marksFromRun(result, world.seenIds);
  return {
    rejections: [
      ...world.pendingRejections,
      ...findMarkRejections(judged, world.reference, options),
    ],
    skipped: false,
  };
}

/**
 * Project any batch event that failed the guard into a {@link MarkRejection}. A
 * `PriceMarked` carries its instrument + price; a non-mark corrective event (rare,
 * but possible in the hand-authored fallback) surfaces its id and asOf so the
 * rejection is still attributable.
 */
function toMarkRejection(event: PortfolioEvent, path: string, reason: string): MarkRejection {
  const isMark = event.type === "PriceMarked";
  return {
    id: event.id,
    instrumentId: isMark ? event.instrumentId : event.id,
    asOf: event.asOf,
    price: isMark ? event.price : Number.NaN,
    path,
    reason,
  };
}
