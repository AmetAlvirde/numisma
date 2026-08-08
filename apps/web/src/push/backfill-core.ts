/**
 * Backfill core (PRD #146 seam D, slice #149) — the IMPORTABLE half of the
 * `backfill` command, split from the self-executing `backfill.ts` for exactly the
 * reason `push-core.ts` is split from `push.ts`: importing a
 * `main().then(..., process.exit)` script runs it.
 *
 * WHAT THIS IS. The projection is a SAMPLED view of the durable log whose sampling
 * rate is "whenever you remember to push". Measured live it held `as_of` 07-24 and
 * 07-26 with SATURDAY MISSING — not because the market was quiet (a quiet day
 * *updates* the prior row, and crypto marks land on weekends) but because no push
 * ran. A delta computed against "the previous row" would have compared Sunday to
 * Friday and called it a day. This command creates the anchors D4's named reference
 * needs, by replaying the log.
 *
 * THE ENGINE WORK IS ZERO (C1). `foldEvents(genesis, events, asOf?)` already
 * filters `event.asOf <= asOf`, applies the latest mark <= D per instrument, and
 * returns `review.asOf = asOf` — which IS the row key. `pickPolicyAsOf` already
 * time-travels, so each backfilled row gets the floor in force on its OWN date for
 * free. This file is a loop plus the existing `upsertSnapshot`.
 *
 * V4 — THIS IS A SEPARATE COMMAND, AND THAT IS THE POINT. The daily push stays
 * zero-argument. A date flag on the command launchd runs nightly is how a cron job
 * eventually writes the wrong date. Do not merge the two.
 *
 * R6 — IDEMPOTENT AND RE-RUNNABLE. The upsert is `ON CONFLICT (fund_id, as_of) DO
 * UPDATE`, so a missed daily push punches no permanent hole: the next backfill
 * refolds the complete log and fills it. The delta architecture is self-healing,
 * which is why push automation stays a strong want and does not gate D4.
 *
 * R7 — IT NEVER MUTATES THE DURABLE LOG. Every fold goes through
 * `loadFoldedReview`, a pure read; the only file that moves on the read path is the
 * quarantine sidecar BESIDE the log, and only when the log does not read clean (in
 * which case the fold throws before anything is written). Re-asserted across all
 * anchors in `backfill-core.test.ts`.
 *
 * ── ANCHOR FIXTURE EXPOSURE — read before regenerating ──────────────────────────
 * `--fixture` writes the replayed anchors to a COMMITTED file so slice 4's replay
 * runs with no Postgres and no private log. What it writes is NOT what it derived.
 *
 * The derived payload is exactly `toProjectionReport`'s output, i.e. by construction
 * publishable under D8/ADR-007 — but D8 governs what may leave the machine for the
 * AUTH-GATED projection DB, and THIS REPOSITORY IS PUBLIC. Those are different bars.
 * The committed `composition-report.fixture.json` beside it has always held the
 * public-bar answer: a "Sanitized Exploratory Fund" with invented round-number
 * positions, precisely because real magnitudes are not committed here.
 *
 * So {@link writeAnchorFixture} SYNTHESIZES before it writes ({@link
 * synthesizeAnchors}), and that is the only path to the file. What survives is what
 * slice 4 reads and nothing else: every anchor date, the `glance` block verbatim, the
 * Reserve row's `percentOfFund`, the day-over-day NAV percentage, and the full
 * structural shape down to which rows genuinely lack a cost basis — INCLUDING every
 * row id and row label, which are load-bearing shape and stay verbatim (repo policy,
 * `docs/local-data.md`: code identifiers keep their literal names). What does not
 * survive is every magnitude — NAV is re-anchored at a round fictional 100000 and each
 * row's `usdValue` / `costBasisUsd` / `unrealizedPnlUsd` / `percentOfFund` is invented
 * from documented parameters — plus the fund's own IDENTITY: `fundName` becomes
 * "Sanitized Exploratory Fund" (#149) and `fundId` is re-derived as that name's slug
 * rather than carried over, so the real `fund_id` no longer rides on all 28 anchors.
 * That is the whole list: the file is sanitized, not de-identified.
 *
 * A uniform SCALE of the real payload was the cheap alternative and it is rejected,
 * because it is reversible: issues #146 and #149 already publish three real NAVs, so
 * dividing recovers the constant and unscales composition, cost basis and P&L for
 * every anchor. Synthesis severs that — recovering a NAV factor recovers nothing
 * about the rows. There is deliberately NO real-magnitude output variant, not even a
 * gitignored one: the generator has exactly one output and it is sanitized.
 * ───────────────────────────────────────────────────────────────────────────────
 */
import { writeFile } from "node:fs/promises";
import type { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";
import {
  loadEventLog,
  loadGenesis,
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";
import {
  ANCHOR_FIXTURE_PATH,
  serializeAnchorFixture,
} from "./anchor-fixture.ts";
import { synthesizeAnchors } from "./fixture-synthesis.ts";
import type { GlanceBlock, SnapshotAnchor } from "../projection/contract.ts";
import {
  buildGlanceForAnchor,
  deriveSnapshot,
  loadCurrentFold,
  upsertSnapshot,
  type SnapshotDerivation,
} from "./push-core.ts";

/** What the backfill shell's two flags decide, once argv has been read. */
export interface BackfillArgs {
  /** Rewrite the replay fixture. Set by `--fixture` AND by `--fixture-only`. */
  writeFixture: boolean;
  /**
   * Fold and write the fixture with NO database and NO credential. This is the flag
   * that decides whether `PROJECTION_WRITE_DATABASE_URL` is required at all.
   */
  fixtureOnly: boolean;
}

/**
 * Parse the backfill shell's argv. Lives here, not in `backfill.ts`, for the reason
 * `parsePushArgs` lives in `push-core.ts`: the shell is a self-executing script, so
 * an importable parser is the only way a test reaches this half.
 *
 * EXACT-MATCH, so `--fixture-only` never also trips `--fixture` by substring, and
 * `--fixture` never trips `fixtureOnly`. The second direction is the one with teeth:
 * `--fixture-only` is what makes regenerating the fixture work with no write
 * credential, so fusing the two would either demand production write access for a
 * local file rewrite, or send a run the operator asked to keep local to the database.
 *
 * Permissive about unknown tokens on the same grounds as `parsePushArgs` — both
 * flags are booleans whose absence is the safe default, and it lets the literal `--`
 * pnpm forwards for `pnpm backfill -- --fixture` fall through unremarked.
 */
export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  const fixtureOnly = argv.includes("--fixture-only");
  return { writeFixture: fixtureOnly || argv.includes("--fixture"), fixtureOnly };
}

/**
 * V3 — THE LOG'S OWN DISTINCT ANCHORED DATES, ASCENDING. NOT calendar days.
 *
 * Of the 34 calendar days from genesis, 28 are anchored. Five of the six gaps are
 * PRE-LAUNCHD WEEKDAYS: folding them would produce rows on which all thirteen
 * instruments were expected and none arrived, so `feedGap` fires, all three header
 * keys suppress, and NAV is PERMANENTLY BLANK on five historical rows that no later
 * run can repair — the log holds no marks for those days and never will. A
 * calendar-dense backfill manufactures its own graveyard. Reader-side resolution to
 * the nearest anchor <= target (slice 4) is what covers the gaps, and it always
 * renders the date it landed on: never claim a date you don't have; always name the
 * one you used.
 *
 * GENESIS IS THE FLOOR, ENFORCED HERE. `foldEvents` THROWS for an `asOf` strictly
 * before the genesis seed's date. Enumerating from the log's own anchors is safe by
 * construction — an event predating t0 could not have been folded into the current
 * state either — but the filter is explicit rather than implied, because the failure
 * mode it prevents is a mid-run throw on anchor 3 of 28 that reads as a mystery.
 *
 * The genesis DATE ITSELF is deliberately not added as an anchor: it is t0 state, not
 * an observation, and it happens not to appear in the log (measured: 28 distinct
 * event dates, genesis 2026-06-23 not among them). Slice 4's "genesis suppresses
 * Change" is about the FIRST anchor having no earlier anchor, which holds either way.
 */
export async function enumerateAnchors(
  paths: EventStorePaths = resolveEventStorePaths(),
): Promise<string[]> {
  const genesis = await loadGenesis(paths.genesis);
  const load = await loadEventLog(paths.log);
  const dates = new Set<string>();
  for (const event of load.events) {
    if (event.asOf >= genesis.review.asOf) {
      dates.add(event.asOf);
    }
  }
  // Plain string sort is safe and stays safe: these are strict zero-padded ISO
  // dates straight off validated log events (`parseEvent`), not free-form input.
  // The projection's own ordering uses the typed `asOfSortKey` because `as_of` is
  // a TEXT COLUMN that a lexical sort could mis-order; this set never goes through
  // SQL.
  return [...dates].sort();
}

/** One anchor's outcome: what was derived, and whether it reached the database. */
export interface BackfilledAnchor extends SnapshotDerivation {
  /** True when a pool was supplied and the row was upserted. */
  written: boolean;
}

export interface BackfillOptions {
  /**
   * The WRITE pool. Omit to derive without writing — which is what
   * `--fixture-only` uses, and what lets the whole loop be tested with no database
   * at all.
   */
  pool?: Pool | undefined;
  /** Override the event-store paths (tests point this at a throwaway store). */
  paths?: EventStorePaths | undefined;
  /** Called after each anchor, for the command's progress output. */
  onAnchor?:
    | ((anchor: BackfilledAnchor, index: number, total: number) => void)
    | undefined;
}

/**
 * Fold ONE anchor and build its glance — the unit the loop repeats. Returns the
 * WIDE report alongside the block, because `upsertSnapshot` takes exactly those two
 * and narrows internally: the command therefore drives the EXACT upsert path
 * `push.ts` drives, rather than a copy of it that could narrow differently.
 *
 * The `asOf` guard is not defensive decoration. `deriveSnapshot` takes the row key
 * from `report.dashboard.summary.asOf`, so if the fold ever answered a different
 * question than the one asked, this loop would silently write 28 rows onto the
 * wrong keys — and every one of them would look well-formed. Assert the fold landed
 * on the requested date, once, here.
 */
export async function foldAnchor(asOf: string): Promise<{
  report: CompositionReport;
  glance: GlanceBlock;
}> {
  const fold = await loadCurrentFold(asOf);
  const folded = fold.report.dashboard.summary.asOf;
  if (folded !== asOf) {
    throw new Error(
      `backfill: fold as-of ${asOf} returned a report dated ${folded}; refusing to ` +
        `write a row keyed to a date that was not requested.`,
    );
  }
  return { report: fold.report, glance: await buildGlanceForAnchor(fold) };
}

/**
 * Replay every anchored date. Returns one entry per anchor, in ascending date
 * order, whether or not a pool was supplied.
 *
 * Each anchor re-reads genesis + the log from disk through `loadCurrentFold`. That
 * is deliberate over folding once in memory: it keeps `loadFoldedReview`'s
 * FAIL-LOUD-ON-A-PARTIAL-LOG contract on every single anchor, at the cost of ~28
 * reads of a small local file. A backfill that quietly degraded on a corrupt line
 * would write 28 plausible-but-wrong NAVs in one command.
 */
export async function runBackfill(
  options: BackfillOptions = {},
): Promise<BackfilledAnchor[]> {
  const anchors = await enumerateAnchors(options.paths);
  const results: BackfilledAnchor[] = [];
  for (const [index, asOf] of anchors.entries()) {
    const { report, glance } = await foldAnchor(asOf);
    // One derivation either way: with a pool `upsertSnapshot` derives and writes
    // and hands the derivation back; without one `deriveSnapshot` is that same
    // pure call with the write removed. The payload captured in `results` — and
    // therefore in the fixture — is byte-for-byte what a write would have stored.
    const derived = options.pool
      ? await upsertSnapshot(options.pool, report, glance)
      : deriveSnapshot(report, glance);
    const anchor: BackfilledAnchor = { ...derived, written: !!options.pool };
    results.push(anchor);
    options.onAnchor?.(anchor, index, anchors.length);
  }
  return results;
}

/** Project derived anchors into the `SnapshotAnchor` shape the reader returns. */
export function toSnapshotAnchors(
  results: readonly SnapshotDerivation[],
): SnapshotAnchor[] {
  return results.map(({ fundId, asOf, report }) => ({ fundId, asOf, report }));
}

/**
 * Write the committed replay fixture — SANITIZED. Returns the path written, so the
 * command can say what it touched.
 *
 * {@link synthesizeAnchors} is not optional and takes no flag. This function is the
 * only writer of the committed file, so routing it through synthesis here is what
 * makes "no real magnitude reaches a tracked path" a property of the code rather than
 * a habit. See this module's ANCHOR FIXTURE EXPOSURE header.
 */
export async function writeAnchorFixture(
  results: readonly SnapshotDerivation[],
  path: string = ANCHOR_FIXTURE_PATH,
): Promise<string> {
  const sanitized = synthesizeAnchors(toSnapshotAnchors(results));
  await writeFile(path, serializeAnchorFixture(sanitized), "utf8");
  return path;
}
