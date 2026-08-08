/**
 * Event-sourcing spine — the ONE pending-inbox walk (audit finding 9).
 *
 * The shape both ingest paths need: fold an ordered batch of untrusted candidates
 * onto a known world — `parseEvent` each, dedup-skip by stable `id` BEFORE the
 * guard, `crossReferenceEvent` the rest, and `applyEventToReference` the accepted
 * ones so the reference ADVANCES (a Position opened earlier in the batch can be
 * cited by a later event).
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
import { applyEventToReference, crossReferenceEvent, type EventReference } from "./crossref.js";
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

/** What the walk found, as data. The reference itself was advanced in place. */
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
 * Walk a pending batch onto `reference`, in order.
 *
 * `reference` is ADVANCED IN PLACE by each accepted event (the
 * {@link applyEventToReference} contract) and left untouched by a duplicate, a
 * rejection, or an invalid candidate — so what the caller holds afterwards is
 * exactly the known world the next event would be judged against.
 */
export function walkPendingInbox(
  candidates: readonly unknown[],
  reference: EventReference,
  options: IngestWalkOptions = {},
): IngestWalkResult {
  const seenIds = new Set(options.seenIds ?? []);
  const accepted: PortfolioEvent[] = [];
  const rejected: IngestWalkRejection[] = [];
  let duplicateCount = 0;

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
        return { accepted, duplicateCount, rejected, seenIds };
      }
      // Do NOT advance the reference with an event the spine would refuse to apply.
      continue;
    }
    applyEventToReference(reference, event);
    accepted.push(event);
  }

  return { accepted, duplicateCount, rejected, seenIds };
}
