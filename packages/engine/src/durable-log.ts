// Two pure derivations for the durable event log's git-backed shell: a compact
// Head Digest of a folded read model (so a reader can trust a head without
// replaying the whole log), and a deterministic ingest commit message. Both are
// pure — no IO, no clock — so the IO/git shell that persists them can be tested
// against a fixed input.
import type { FundReviewData } from "./contracts.js";
import { buildCompositionReport } from "./compose/report.js";

/**
 * A derived, versioned summary of a folded read model at a point in the log — the
 * Head Digest (persisted as `head-digest.json`). Written alongside the event log so a
 * reader can trust the head's shape (value, open/closed counts, the event it was
 * folded through) without replaying every event. `asOf`, the counts, and
 * `fundValueUsd` all come straight from the canonical fold — never a side calculation
 * — so the Head Digest can never disagree with a full recompute. It has no engine
 * reader (nothing folds it back), so it can never become a shadow source of truth.
 *
 * Divergence note (D1): `openPositionCount` counts ALL logged open positions
 * (`folded.positions.length`), including non-live / unsupported ones, whereas
 * `fundValueUsd` (from `buildCompositionReport`) values only the live, supported
 * population. The two intentionally diverge when a non-live position is logged — the
 * count is "positions on the book", not "positions contributing to the fund value".
 */
export interface HeadDigest {
  schemaVersion: 1;
  asOf: string;
  fundValueUsd: number;
  /**
   * Count of ALL logged open positions (incl. non-live / unsupported), i.e.
   * `folded.positions.length`. NOT the valued population — see the D1 divergence
   * note on {@link HeadDigest}; `fundValueUsd` excludes non-live positions.
   */
  openPositionCount: number;
  closedPositionCount: number;
  headEventId: string | null;
  appVersion: string;
}

/**
 * Derive a {@link HeadDigest} from a folded read model. `fundValueUsd` is taken from
 * `buildCompositionReport(folded)` — the ONE canonical fund-value computation — rather
 * than re-summing positions by hand, so the Head Digest and the composition report can
 * never drift (the named ADR-003 anti-drift invariant). `headEventId` is the id of the
 * last event folded in (or `null` for the genesis-only state).
 */
export function deriveHeadDigest(
  folded: FundReviewData,
  headEventId: string | null,
  appVersion: string,
): HeadDigest {
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
