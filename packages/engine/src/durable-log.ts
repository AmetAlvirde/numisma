// Two pure derivations for the durable event log's git-backed shell: a compact
// `Checkpoint` snapshot of a folded read model (so a reader can trust a head
// without replaying the whole log), and a deterministic ingest commit message.
// Both are pure — no IO, no clock — so the IO/git shell that persists them can be
// tested against a fixed input.
import type { FundReviewData } from "./contracts.js";
import { buildCompositionReport } from "./compose/report.js";

/**
 * A compact, durable summary of a folded read model at a point in the log. Written
 * alongside the event log so a reader can trust the head's shape (value, open/closed
 * counts, the event it was folded through) without replaying every event. `asOf`,
 * the counts, and `fundValueUsd` all come straight from the canonical fold — never a
 * side calculation — so a checkpoint can never disagree with a full recompute.
 */
export interface Checkpoint {
  schemaVersion: 1;
  asOf: string;
  fundValueUsd: number;
  openPositionCount: number;
  closedPositionCount: number;
  headEventId: string | null;
  appVersion: string;
}

/**
 * Derive a {@link Checkpoint} from a folded read model. `fundValueUsd` is taken from
 * `buildCompositionReport(folded)` — the ONE canonical fund-value computation — rather
 * than re-summing positions by hand, so the checkpoint and the composition report can
 * never drift. `headEventId` is the id of the last event folded in (or `null` for the
 * genesis-only state).
 */
export function deriveCheckpoint(
  folded: FundReviewData,
  headEventId: string | null,
  appVersion: string,
): Checkpoint {
  const { fundValueUsd } = buildCompositionReport(folded).totals;
  return {
    schemaVersion: 1,
    asOf: folded.review.asOf,
    fundValueUsd,
    openPositionCount: folded.positions.length,
    closedPositionCount: (folded.closedPositions ?? []).length,
    headEventId,
    appVersion,
  };
}

export interface IngestCommitInput {
  /** Count of each event verb ingested in this batch, keyed by verb name. */
  verbs: Record<string, number>;
  totalCount: number;
  asOf: string;
  appVersion: string;
  /** Available for a future trailer; the message stays deterministic without it. */
  timestamp: string;
}

/**
 * Format a deterministic git commit message for one ingest batch. Verb keys are
 * sorted so the same batch always yields byte-identical output regardless of the
 * input object's key order. Shape:
 *
 *   data: ingest <totalCount> event(s) — <sorted verb summary>
 *
 *   <one "<Verb>×<n>" line per verb, sorted>
 *   asOf: <asOf>
 *   numisma-version: <appVersion>
 */
export function formatIngestCommitMessage(input: IngestCommitInput): string {
  const sortedVerbs = Object.keys(input.verbs)
    .sort()
    .map((verb) => ({ verb, count: input.verbs[verb] ?? 0 }));

  const summary = sortedVerbs.map(({ verb, count }) => `${verb}×${count}`).join(", ");
  const subject = `data: ingest ${input.totalCount} event(s) — ${summary}`;
  const body = sortedVerbs.map(({ verb, count }) => `${verb}×${count}`).join("\n");

  return [
    subject,
    "",
    body,
    `asOf: ${input.asOf}`,
    `numisma-version: ${input.appVersion}`,
  ].join("\n");
}
