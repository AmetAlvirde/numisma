/**
 * Event-sourcing spine — the ONE pending-inbox walk (audit finding 9).
 *
 * The shape both ingest paths need: fold an ordered batch of untrusted candidates
 * onto a known world — `parseEvent` each, dedup-skip by stable `id` BEFORE the
 * guard, `crossReferenceEvent` the rest, and REBUILD the reference from genesis plus
 * the accepted prefix so the world ADVANCES (a Position opened earlier in the batch
 * can be cited by a later event).
 *
 * ADR-015 put that rebuild here. The walk used to advance an incrementally-maintained
 * shadow in place; now each accept re-derives the gate's view from
 * `foldEvents(genesis, [...priorEvents, ...accepted])`, so what the next candidate is
 * judged against is the book the fold will actually produce. That is n+1 folds for an
 * n-event batch — ≈3 ms for the price-feed's 13-mark batch at today's log length, and
 * ≈284 ms at a 50k-event log; see {@link buildEventReference} for the standing budget
 * and ADR-015 for the mark-heavy table it comes from.
 *
 * Two callers walk it, and the second one's ENTIRE value is byte-fidelity to the
 * first:
 *
 *   - `apps/tui`'s `ingestInbox` — the authoritative spine ingest. All-or-nothing:
 *     it halts on the first invalid or rejected event and throws, leaving the
 *     durable log byte-for-byte unchanged (`haltOnRejection: true`).
 *   - `apps/price-feed`'s fetch-time rejection pre-check — an advisory that reports
 *     which marks the spine WOULD reject. It collects every rejection rather than
 *     halting, so one doomed mark queued by a prior run does not hide another.
 *
 * The error POLICY is exactly where the two deliberately differ, so it stays with
 * each caller (each phrases its own message about its own file); the WALK is what
 * must not drift, so it lives here, once. `apps/price-feed` cannot import
 * `apps/tui`, which is why a shared copy in the engine — the one package both
 * already depend on — is the only thing that can hold them together.
 *
 * ADR-001: IO-free. Reading genesis, the log, and the inbox off disk is the shells'
 * job; this takes the already-read candidates as data and returns the verdicts as
 * data. Nothing here touches the filesystem.
 */
import type { FundReviewData, SkippedFoldEvent } from "../contracts.js";
import { buildEventReference, crossReferenceEvent, type EventReference } from "./crossref.js";
import { dedupeFoldSkips } from "./fold.js";
import { parseEvent } from "./parse.js";
import type { PortfolioEvent } from "./types.js";

/**
 * A candidate that failed `parseEvent` — the FIRST gate. Structurally invalid input
 * dooms both callers (the spine refuses the batch; the pre-check reports itself
 * unavailable), so the walk always HALTS here and reports at most one, with the
 * engine's own `path` / `message` so neither caller invents a second wording of the
 * same rule. `index` is the candidate's position in the batch as handed in.
 */
export interface IngestWalkInvalid {
  index: number;
  path: string;
  message: string;
}

/**
 * A structurally-sound event the cross-reference gate refused: an unknown or
 * colliding id, an insufficient debit, an implausible magnitude. Carries the engine
 * guard's own `path` / `message` verbatim, so a surfaced reason is byte-identical to
 * what `pnpm spine` would print.
 */
export interface IngestWalkRejection {
  index: number;
  event: PortfolioEvent;
  path: string;
  message: string;
}

/**
 * The world a walk starts from: the immutable genesis seed plus the events already
 * accepted before this batch (typically the durable log's). Handed in as INPUTS rather
 * than as a pre-built reference, because under ADR-015 the walk must be able to
 * re-fold — the gate's view is derived per accept, never advanced.
 */
export interface IngestWalkWorld {
  genesis: FundReviewData;
  /** Events already committed. Copied, never mutated. */
  priorEvents?: readonly PortfolioEvent[];
}

/** What the walk found, as data — including the world it ended in. */
export interface IngestWalkResult {
  /** The events the batch actually introduces, in order — what a caller appends. */
  accepted: PortfolioEvent[];
  /** Candidates dedup-skipped because their id was already seen (log or batch). */
  duplicateCount: number;
  /**
   * Every event the guard refused, in order. At most one when `haltOnRejection`,
   * since the walk stops there.
   */
  rejected: IngestWalkRejection[];
  /** Present only when a candidate failed to parse; the walk stopped at it. */
  invalid?: IngestWalkInvalid;
  /**
   * Every id the walk now considers seen: the ids it was handed plus every event it
   * reached the guard with — accepted OR rejected. A rejected id counts because the
   * spine's dedup runs BEFORE the guard: a later duplicate of a doomed event is one
   * the spine silently skips, never guards, so it must not be judged twice.
   */
  seenIds: Set<string>;
  /**
   * The known world AFTER the walk — `genesis + priorEvents + accepted`, projected off
   * the fold. RETURNED rather than mutated into a caller's reference: under ADR-015 the
   * reference is a projection, so there is nothing to advance in place. It is what the
   * next candidate would be judged against, which is exactly what the price-feed
   * pre-check needs in order to judge this run's fresh marks.
   */
  reference: EventReference;
  /**
   * Every event the walk's OWN FOLDS read and could not apply — the union over every
   * reference this walk built, DEDUPED on (`eventId`, `reason`) (ADR-020; PRD #323 R5).
   * Empty on a complete log.
   *
   * THE DEDUP IS STRUCTURAL, NOT A TIDINESS. This walk re-derives the reference on every
   * accept (ADR-015), so an n-event batch folds the log n+1 times and one dropped prior
   * is reported by every one of those folds — the price-feed's 13-mark batch would hand
   * its consumer 14 copies of one finding. 14 is a fact about this loop, not about the
   * log, and an operator reading it as damage would be reading the loop.
   *
   * It is a REPORT AND NOTHING ELSE. Nothing here rejects, halts or changes a verdict on
   * account of a drop: `priorEvents` is the append-only durable log, so a drop in it can
   * never be repaired, and refusing would brick every future ingest permanently (R2).
   * The consumer is the TUI's `ingestInbox`, where a human is at the keyboard — and it
   * is deliberately a HANDOFF rather than a second print: `apps/tui`'s startup channel
   * already enumerates this same log's discards once (`fold-lines.ts`, slice E), and one
   * finding printed twice on one channel is how a channel stops being read.
   */
  skipped: SkippedFoldEvent[];
}

export interface IngestWalkOptions {
  /**
   * Ids already committed (typically the durable log's). A candidate whose id is in
   * here is dedup-skipped BEFORE the guard — never cross-referenced, never advancing
   * the reference. Copied, never mutated.
   */
  seenIds?: ReadonlySet<string>;
  /** Passed straight through to `crossReferenceEvent`; unset keeps the engine default. */
  magnitudeThreshold?: number;
  /**
   * Stop at the first rejection instead of collecting them (the spine's
   * all-or-nothing ingest: nothing after the failure is meaningful, because nothing
   * will be written).
   */
  haltOnRejection?: boolean;
}

/**
 * Walk a pending batch onto `world`, in order.
 *
 * Each ACCEPTED event re-derives the gate's view from genesis plus the accepted prefix
 * (ADR-015), so the next candidate is judged against the book the fold will produce. A
 * duplicate, a rejection, or an invalid candidate leaves the world untouched — a
 * rejected event is one the spine would refuse to apply, so it must not be allowed to
 * inform the judgment of the next one. `result.reference` is the world the walk ended
 * in, and `result.skipped` is what every fold along the way read and could not apply —
 * lifted, deduped, and acted on by no rule here (ADR-020).
 */
export function walkPendingInbox(
  candidates: readonly unknown[],
  world: IngestWalkWorld,
  options: IngestWalkOptions = {},
): IngestWalkResult {
  const seenIds = new Set(options.seenIds ?? []);
  const priorEvents = world.priorEvents ?? [];
  const accepted: PortfolioEvent[] = [];
  const rejected: IngestWalkRejection[] = [];
  let duplicateCount = 0;
  // The union of what EVERY reference below reported dropped, collected as each one is
  // built and deduped only on the way out — so no fold's answer can be lost by a later
  // one replacing the reference that carried it. Deduping here instead of at the end of
  // the loop would be wrong for the same reason: the walk can return from three places.
  const foldSkips: SkippedFoldEvent[] = [];
  const carrying = (next: EventReference): EventReference => {
    foldSkips.push(...next.skipped);
    return next;
  };
  // Re-derived on every accept below; built once here so a batch that accepts nothing
  // (all duplicates, or empty) still costs exactly one fold.
  let reference = carrying(buildEventReference(world.genesis, priorEvents));

  // Only pass the magnitude dial when the caller set it, so the engine keeps its own
  // ±50% default (exactOptionalPropertyTypes forbids an explicit `undefined`).
  const guardOptions =
    options.magnitudeThreshold === undefined
      ? undefined
      : { magnitudeThreshold: options.magnitudeThreshold };

  for (const [index, candidate] of candidates.entries()) {
    const parsed = parseEvent(candidate);
    if (parsed.kind !== "ok") {
      return {
        accepted,
        duplicateCount,
        rejected,
        invalid: { index, path: parsed.path, message: parsed.message },
        seenIds,
        reference,
        skipped: dedupeFoldSkips(foldSkips),
      };
    }
    const event = parsed.value;
    if (seenIds.has(event.id)) {
      duplicateCount += 1;
      continue;
    }
    // Seen from here on: the dedup above runs BEFORE the guard, so a repeat of this
    // id is skipped whether or not the guard accepts this one.
    seenIds.add(event.id);
    const crossRef = crossReferenceEvent(event, reference, guardOptions);
    if (crossRef.kind !== "ok") {
      rejected.push({ index, event, path: crossRef.path, message: crossRef.message });
      if (options.haltOnRejection) {
        return {
          accepted,
          duplicateCount,
          rejected,
          seenIds,
          reference,
          skipped: dedupeFoldSkips(foldSkips),
        };
      }
      // Do NOT advance the world with an event the spine would refuse to apply.
      continue;
    }
    accepted.push(event);
    // The accept IS the advance: re-fold genesis + everything committed + everything
    // this batch has taken so far. One fold per accepted event, deliberately (ADR-015)
    // — and the n+1th look at the same standing drop, which is what `skipped` dedups.
    reference = carrying(buildEventReference(world.genesis, [...priorEvents, ...accepted]));
  }

  return {
    accepted,
    duplicateCount,
    rejected,
    seenIds,
    reference,
    skipped: dedupeFoldSkips(foldSkips),
  };
}
