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
 * fetch is the only place a scheduled run can notice. We therefore run each
 * just-emitted mark through the SAME engine guard the spine uses
 * (`crossReferenceEvent`) against a reference built from the real genesis + log,
 * and report any that WOULD be rejected — attributably, and distinctly from a
 * provider failure (different triage paths). This is a pre-flight ADVISORY: it
 * changes no engine or tui code (C1); `pnpm spine` stays the one authoritative
 * guard and the permanent manual fallback stays the operator's path (C5).
 *
 * ADR-001: reading genesis + log off disk is IO and lives here in the shell;
 * building the reference and evaluating the guard are the engine's pure functions,
 * consumed unchanged.
 */
import { readFile } from "node:fs/promises";
import {
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
}

/**
 * Reconstruct the spine's known world (genesis + durable log) so a fetched mark
 * can be checked against the exact reference `ingestInbox` would build. Returns
 * `undefined` when there is no genesis to check against — a pre-check needs a
 * reference, so its absence is surfaced as "could not pre-check", never a false
 * all-clear. Throws (fail-loud, like the spine) if genesis or a log line is
 * unreadable; the caller treats a throw as a non-fatal "pre-check unavailable"
 * so a corrupt log never masks an otherwise-successful fetch.
 */
export async function loadSpineReference(
  paths: SpineReferencePaths,
): Promise<EventReference | undefined> {
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

  return buildEventReference(genesis.value, priorEvents);
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
      rejections.push({
        id: mark.id,
        instrumentId: mark.instrumentId,
        asOf: mark.asOf,
        price: mark.price,
        path: result.path,
        reason: result.message,
      });
    }
  }
  return rejections;
}

/**
 * The marks a fetch run queued for the spine this run: none before the mark time.
 * Uses the run's OWN constructed marks (`result.marks`) rather than re-deriving
 * from quotes — a `*-mxn` mark is `USD × FIX`, not `markFromQuote`, so re-deriving
 * would pre-check the wrong (raw-USD) value against the guard.
 */
export function marksFromRun(result: FetchRunResult): PriceMarkedEvent[] {
  return result.markEmitted ? [...result.marks] : [];
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
 * The fetch-time pre-check the CLI runs: rebuild the spine's world, derive this
 * run's marks, and report which would be rejected. Any failure to build the
 * reference is swallowed into `unavailableReason` (never thrown) so a doomed
 * pre-check cannot turn a successful fetch+store into a crash — the authoritative
 * guard remains `pnpm spine`.
 */
export async function scanFetchedMarks(
  result: FetchRunResult,
  paths: SpineReferencePaths,
  options?: { magnitudeThreshold?: number },
): Promise<RejectionScan> {
  const marks = marksFromRun(result);
  if (marks.length === 0) {
    return { rejections: [], skipped: false };
  }
  let reference: EventReference | undefined;
  try {
    reference = await loadSpineReference(paths);
  } catch (error) {
    return {
      rejections: [],
      skipped: true,
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
  if (reference === undefined) {
    return { rejections: [], skipped: true };
  }
  return { rejections: findMarkRejections(marks, reference, options), skipped: false };
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
