// Two pure derivations for the durable event log's git-backed shell: a compact
// Head Digest of a folded read model (so a reader can trust a head without
// replaying the whole log), and a deterministic ingest commit message. Both are
// pure — no IO, no clock — so the IO/git shell that persists them can be tested
// against a fixed input.
import type { FoldedReview } from "./contracts.js";
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
 *
 * **v2 — `discardedEventCount` (the Discard Channel, ADR-020).** The fold may drop an
 * event whose target it cannot find. Without a marker here, that damage is laundered:
 * `fundValueUsd` and the counts come out wrong in the one artifact whose premise is
 * that nobody replays the log to re-check them. So the digest carries the count of
 * events the capture fold discarded — `0` on a clean fold, always present.
 *
 * A COUNT, NOT THE LIST. The skip records (`SkippedFoldEvent`, with their locators) go
 * to surfaces where a reader can act on them; a digest nothing folds back is not such a
 * surface. The count alone is what ADR-006's membership test admits, on exactly the
 * trust-without-replay ground that admits `fundValueUsd`: a reader opening
 * `head-digest.json` must be able to see a QUALIFIED head. The digest therefore carries
 * no skip list, no event ids, and no locators.
 *
 * The 1 → 2 bump is cheap because there is no reader to migrate — see this type's own
 * "no engine reader" note above and ADR-003's Head Digest amendment (no
 * `parseHeadDigest`, no code path that trusts it). Forward-only: v1 digests standing in
 * existing accumulus commits are not repaired.
 */
export interface HeadDigest {
  schemaVersion: 2;
  asOf: string;
  fundValueUsd: number;
  /**
   * Count of ALL logged open positions (incl. non-live / unsupported), i.e.
   * `folded.positions.length`. NOT the valued population — see the D1 divergence
   * note on {@link HeadDigest}; `fundValueUsd` excludes non-live positions.
   */
  openPositionCount: number;
  closedPositionCount: number;
  /**
   * How many events the capture fold read and then discarded — `folded.skipped.length`.
   * `0` on a clean fold, and present on every digest so a nonzero count is a positive
   * signal rather than a missing key. A COUNT ONLY: the records themselves (ids,
   * indices, reasons) live on the surfaces a reader can act from — see {@link HeadDigest}.
   */
  discardedEventCount: number;
  headEventId: string | null;
  appVersion: string;
}

/**
 * Derive a {@link HeadDigest} from the fold's ENVELOPE. `fundValueUsd` is taken from
 * `buildCompositionReport(folded.data)` — the ONE canonical fund-value computation —
 * rather than re-summing positions by hand, so the Head Digest and the composition
 * report can never drift (the named ADR-003 anti-drift invariant). `headEventId` is the
 * id of the last event folded in (or `null` for the genesis-only state).
 *
 * It takes the whole `FoldedReview`, never a bare `FundReviewData`, so a caller
 * STRUCTURALLY cannot derive a digest that omits the discard count: unwrapping the
 * envelope before the digest is exactly the laundering ADR-020 exists to stop.
 */
export function deriveHeadDigest(
  folded: FoldedReview,
  headEventId: string | null,
  appVersion: string,
): HeadDigest {
  const { data, skipped } = folded;
  const { fundValueUsd } = buildCompositionReport(data).totals;
  return {
    schemaVersion: 2,
    asOf: data.review.asOf,
    fundValueUsd,
    openPositionCount: data.positions.length,
    closedPositionCount: (data.closedPositions ?? []).length,
    discardedEventCount: skipped.length,
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
