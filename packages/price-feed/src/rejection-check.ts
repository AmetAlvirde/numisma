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
 * FAITHFUL TO `ingestInbox` (tui/src/event-store.ts): the real spine ingest folds
 * genesis + log, then walks the inbox IN ORDER — dedup-skipping any id already
 * committed in the log BEFORE the guard, `crossReferenceEvent`-ing each remaining
 * event against a reference that ADVANCES with every accepted one, all-or-nothing.
 * The pre-check mirrors that exactly, so it (a) does NOT false-positive on a
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
import { readFile } from "node:fs/promises";
import {
  applyEventToReference,
  buildEventReference,
  crossReferenceEvent,
  parseEvent,
  parseFundReview,
  type EventReference,
  type PortfolioEvent,
  type PriceMarkedEvent,
} from "@numisma/engine";
import type { FetchRunResult } from "./fetch-prices.js";

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
   * The ids spine dedup-skips BEFORE the magnitude guard (event-store.ts:259):
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
 * Returns `undefined` when there is no genesis to check against — a pre-check needs
 * a reference, so its absence is surfaced as "could not pre-check", never a false
 * all-clear. Throws (fail-loud, like the spine) if genesis, a log line, or the
 * inbox is unreadable; the caller treats a throw as a non-fatal "pre-check
 * unavailable" so a corrupt file never masks an otherwise-successful fetch.
 */
export async function loadSpineReference(
  paths: SpineReferencePaths,
  options?: { freshlyQueuedCount?: number },
): Promise<SpineWorld | undefined> {
  const genesisRaw = await readOptional(paths.genesis);
  if (genesisRaw === undefined) {
    return undefined;
  }
  const genesis = parseFundReview(genesisRaw);
  if (genesis.kind !== "ok") {
    throw new Error(`Genesis seed failed validation (${genesis.kind}) at ${paths.genesis}.`);
  }

  const logRaw = await readOptional(paths.log);
  const priorEvents: PortfolioEvent[] = [];
  if (logRaw !== undefined) {
    for (const [index, line] of logRaw.split("\n").entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch {
        throw new Error(`Log ${paths.log} line ${index + 1} is not valid JSON.`);
      }
      const parsed = parseEvent(json);
      if (parsed.kind !== "ok") {
        throw new Error(
          `Log ${paths.log} line ${index + 1} failed to parse (${parsed.path}: ${parsed.message}).`,
        );
      }
      priorEvents.push(parsed.value);
    }
  }

  // The known world is genesis + the durable log; accepted pending inbox events
  // extend it in order, exactly as `ingestInbox`. `seen` starts as the log ids —
  // the ids the spine dedup-skips before the guard even runs (event-store.ts:245).
  const reference = buildEventReference(genesis.value, priorEvents);
  const seenIds = new Set(priorEvents.map((event) => event.id));

  // Fold in the PRE-EXISTING inbox: everything on disk except the tail this run just
  // appended (which are the marks being JUDGED, not batch context — folding them
  // would double-count them against themselves).
  const inboxRecords = await readInboxArray(paths.inbox);
  const freshlyQueuedCount = options?.freshlyQueuedCount ?? 0;
  const pendingCount = Math.max(0, inboxRecords.length - freshlyQueuedCount);
  const pending = inboxRecords.slice(0, pendingCount);

  const pendingRejections: MarkRejection[] = [];
  for (const [index, candidate] of pending.entries()) {
    const parsed = parseEvent(candidate);
    if (parsed.kind !== "ok") {
      // A structurally invalid pending event dooms the whole spine ingest too; the
      // caller swallows this throw into "pre-check unavailable" (non-fatal).
      throw new Error(
        `Inbox ${paths.inbox} pending event [${index}] failed to parse (${parsed.path}: ${parsed.message}).`,
      );
    }
    const event = parsed.value;
    if (seenIds.has(event.id)) {
      // Already committed in the log: spine dedup-skips it (event-store.ts:259)
      // BEFORE the guard, so it neither guards nor advances the reference. Skip it.
      continue;
    }
    // Record the id as pending-seen so a fresh mark that duplicates it is excluded
    // from the judged set — spine would dedup-skip that fresh mark the same way.
    seenIds.add(event.id);
    const crossRef = crossReferenceEvent(event, reference);
    if (crossRef.kind !== "ok") {
      // Finding 4b: a doomed-but-queued mark from a PRIOR run. Spine rejects the
      // whole all-or-nothing batch on it, so surface it now. Do NOT advance the
      // reference with an event the spine itself would refuse to apply.
      pendingRejections.push(toMarkRejection(event, crossRef.path, crossRef.message));
      continue;
    }
    applyEventToReference(reference, event);
  }

  return { reference, seenIds, pendingRejections };
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
 * already pending, and the spine skips one already in the log (event-store.ts:259),
 * so guarding either would falsely halt the wrapper on a mark spine never guards
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
  let world: SpineWorld | undefined;
  try {
    world = await loadSpineReference(paths, { freshlyQueuedCount: result.emittedCount });
  } catch (error) {
    return {
      rejections: [],
      skipped: true,
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
  if (world === undefined) {
    return { rejections: [], skipped: true };
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

/**
 * Read the inbox as the JSON array of transactions spine expects, mirroring
 * `ingestInbox`'s parse. A missing inbox is the normal case (returns `[]`); invalid
 * JSON or a non-array throws (the caller treats it as pre-check unavailable).
 */
async function readInboxArray(inboxPath: string): Promise<unknown[]> {
  const raw = await readOptional(inboxPath);
  if (raw === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Inbox ${inboxPath} is not valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Inbox ${inboxPath} must be a JSON array of transactions.`);
  }
  return parsed;
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
