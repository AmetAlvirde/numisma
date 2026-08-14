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
 * `loadFoldedReview`, a pure read. See the write-on-read invariant in
 * `packages/event-store/README.md`. Re-asserted across all anchors in
 * `backfill-core.test.ts`.
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
 * the replay reads and nothing else: every anchor date, the `glance` block verbatim,
 * the Reserve row's `percentOfFund`, the day-over-day NAV percentage, the `dca`
 * branch's states and counts — `source`, every `state` and `kind`, the rung COUNT per
 * position, the `unattributable` count — and the full structural shape down to which
 * rows genuinely lack a cost basis. INCLUDING every row id and row label, which are
 * load-bearing shape and stay verbatim (repo policy, `docs/local-data.md`: code
 * identifiers keep their literal names). What does not
 * survive is every magnitude — NAV is re-anchored at a round fictional 100000, each
 * row's `usdValue` / `costBasisUsd` / `unrealizedPnlUsd` / `percentOfFund` is invented
 * from documented parameters, and every rung `priceUsd` is invented on a synthetic
 * descending ladder (a declared entry level is a magnitude, and ADR-006 notes it is
 * the same shape as a stop level) — plus the fund's own IDENTITY: `fundName` becomes
 * "Sanitized Exploratory Fund" (#149) and `fundId` is re-derived as that name's slug
 * rather than carried over, so the real `fund_id` no longer rides on every anchor in
 * the committed file. Plan `positionId`s go the same way, to
 * `synthetic-position-N`: the repo's literal-names policy covers identifiers THIS
 * REPOSITORY authors, and a `positionId` is a string read out of the private sidecar
 * that names a live position's venue, instrument and strategy. It was kept verbatim
 * when the `dca` branch landed and shipped once (PR #282) before the rule was moved
 * into code. That is the whole list: the file is sanitized, not
 * de-identified.
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
import type { CompositionReport, LoadedPreferences } from "@numisma/engine";
import {
  loadEventLog,
  loadGenesis,
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";
import { unattendedPreferencesVerdict } from "@numisma/preferences";
import {
  ANCHOR_FIXTURE_PATH,
  serializeAnchorFixture,
} from "./anchor-fixture.ts";
import { synthesizeAnchors } from "./fixture-synthesis.ts";
import type { DcaBlock, SnapshotAnchor } from "../projection/contract.ts";
import {
  buildDcaForAnchor,
  buildGlanceForAnchor,
  deriveSnapshot,
  loadCurrentFold,
  upsertSnapshot,
  PREFERENCES_DIAGNOSTIC_KIND,
  type AnchorGlance,
  type SnapshotDerivation,
} from "./push-core.ts";
import type { RunReport } from "./unattended-report.ts";

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
 * Fewer calendar days from genesis are anchored than have elapsed — 28 of 34 when this
 * was written, a dated observation rather than a contract, and the gaps are all in that
 * first stretch. Five of the six were
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
 * mode it prevents is a mid-run throw on anchor 3 of N that reads as a mystery.
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
  /**
   * Called once per anchor, AFTER that anchor has been written, with the preferences
   * envelope its glance was derived from — spec #320 seam D. The ordering is part of
   * the contract, not an accident of the loop's shape: a callback that throws must not
   * be able to withhold a row, and this one is invoked where it cannot.
   *
   * PER ANCHOR, BECAUSE THAT IS THE TRUTH: the sidecar is re-read on every anchor (see
   * this loop's docstring), so this loop genuinely rediscovers the same discards N
   * times and saying so once is a fact about the run, not about the loop. Collapsing
   * them to once per RUN is the CALLER's job and belongs there — `RunReport` dedups
   * within a kind, so the shell files all N and the channel keeps one. Deduping here
   * instead would bake one consumer's rendering policy into the replay loop.
   *
   * THE LOOP STILL DECIDES NOTHING. It hands the envelope over and reads no exit code
   * back: a discarded policy line must never stop a backfill mid-history, which would
   * leave the projection with a partial replay for a sidecar problem.
   */
  onPreferencesLoad?: ((loaded: LoadedPreferences) => void) | undefined;
}

/**
 * Fold ONE anchor and build its glance — the unit the loop repeats. Returns the
 * WIDE report alongside the block, because `upsertSnapshot` takes exactly those two
 * and narrows internally: the command therefore drives the EXACT upsert path
 * `push.ts` drives, rather than a copy of it that could narrow differently.
 *
 * The `asOf` guard is not defensive decoration. `deriveSnapshot` takes the row key
 * from `report.dashboard.summary.asOf`, so if the fold ever answered a different
 * question than the one asked, this loop would silently write every row onto the
 * wrong keys — and every one of them would look well-formed. Assert the fold landed
 * on the requested date, once, here.
 */
export async function foldAnchor(asOf: string): Promise<{
  report: CompositionReport;
  glance: AnchorGlance;
  dca: DcaBlock;
}> {
  const fold = await loadCurrentFold(asOf);
  const folded = fold.report.dashboard.summary.asOf;
  if (folded !== asOf) {
    throw new Error(
      `backfill: fold as-of ${asOf} returned a report dated ${folded}; refusing to ` +
        `write a row keyed to a date that was not requested.`,
    );
  }
  return {
    report: fold.report,
    // The BLOCK plus the envelopes it was read from. Only `glance.glance` reaches the
    // upsert; the envelopes go to the command's operator channel and no further.
    glance: await buildGlanceForAnchor(fold),
    // As-of, per anchor, exactly like the floor beside it: an anchor that predates a
    // plan's `effectiveAt` resolves `none` and lands an honestly empty branch. No
    // special-casing, and no historical row claiming a strategy that did not exist yet.
    dca: await buildDcaForAnchor(fold),
  };
}

/**
 * Replay every anchored date. Returns one entry per anchor, in ascending date
 * order, whether or not a pool was supplied.
 *
 * Each anchor re-reads genesis + the log from disk through `loadCurrentFold`. That
 * is deliberate over folding once in memory: it keeps `loadFoldedReview`'s
 * FAIL-LOUD-ON-A-PARTIAL-LOG contract on every single anchor, at the cost of one
 * re-read of a small local file per anchor. A backfill that quietly degraded on a corrupt line
 * would write a full history of plausible-but-wrong NAVs in one command.
 */
export async function runBackfill(
  options: BackfillOptions = {},
): Promise<BackfilledAnchor[]> {
  const anchors = await enumerateAnchors(options.paths);
  const results: BackfilledAnchor[] = [];
  for (const [index, asOf] of anchors.entries()) {
    const { report, glance, dca } = await foldAnchor(asOf);
    // One derivation either way: with a pool `upsertSnapshot` derives and writes
    // and hands the derivation back; without one `deriveSnapshot` is that same
    // pure call with the write removed. The payload captured in `results` — and
    // therefore in the fixture — is byte-for-byte what a write would have stored.
    const derived = options.pool
      ? await upsertSnapshot(options.pool, report, glance.glance, dca)
      : deriveSnapshot(report, glance.glance, dca);
    const anchor: BackfilledAnchor = { ...derived, written: !!options.pool };
    results.push(anchor);
    // AFTER this anchor's write and BESIDE `onAnchor`, never before either: the
    // callback is told what this anchor's read discarded and CANNOT stop the anchor
    // from being written. Structurally, not by inspection of today's caller — the
    // option's own name invites a caller to emit in it, and an emit onto a stderr the
    // launchd watchdog has already closed raises EPIPE. Called before the upsert, that
    // throw abandons the entire replay over a sidecar line. Pinned in
    // `discard-channel.test.ts`; same guarantee `pushAnchorAndReport` gives the push.
    options.onPreferencesLoad?.(glance.preferences);
    options.onAnchor?.(anchor, index, anchors.length);
  }
  return results;
}

/** What one reported backfill run produced, and how it should end. */
export interface BackfillRun {
  results: BackfilledAnchor[];
  /**
   * THE PREFERENCES KIND's verdict, folded across every anchor — reported, never
   * exited on (see below). Kept because the policy stays a value a test can assert
   * (spec #320 §4) and because a future caller with a different consequence composes
   * from it; this run's process code is the field beside it.
   */
  preferencesExitCode: number;
  /**
   * THE PROCESS'S exit code. Zero for a preferences discard, and that is the
   * DELIBERATE DIVERGENCE from {@link pushAnchorAndReport} — read the note below
   * before "fixing" it back.
   */
  exitCode: number;
}

/** Everything a reported backfill needs beyond the replay's own options. */
export interface BackfillAndReportInput extends Omit<BackfillOptions, "onPreferencesLoad"> {
  /** The run's shared operator channel. Other kinds may already have filed into it. */
  channel: RunReport;
  /** Where the channel is written. Injected so the ORDERING below is assertable. */
  emit?: ((line: string) => void) | undefined;
  /**
   * The run's OWN output — the fixture write and the summary line. Runs after every
   * anchor and BEFORE the channel, because the diagnostic is the last thing a run says.
   */
  onComplete?: ((results: readonly BackfilledAnchor[]) => void | Promise<void>) | undefined;
}

/**
 * REPLAY FIRST, REPORT AFTER — the backfill's half of spec #320 seam C/D, and the
 * reason this function exists rather than five lines inside `backfill.ts`'s `main()`.
 * `backfill.ts` is a self-executing script no test may import, so the ordering lives
 * here where `discard-channel.test.ts` can drive it with a pool and an emitter sharing
 * one sequence log: "after" is OBSERVED rather than read off the shell's line order.
 *
 * ONE REPORT PER RUN, NOT PER ANCHOR. The sidecar is re-read on every anchor, so the
 * replay genuinely rediscovers the same discards N times. {@link RunReport} dedups
 * within a kind, so all N are filed and one line is emitted — and it is emitted once,
 * at the end, because a discard reported mid-replay is a discard positioned to abort
 * one.
 *
 * ── IT EXITS ZERO ON A DISCARD, AND THE PUSH DOES NOT. DELIBERATE. ─────────────────
 * `push.ts` keeps its non-zero exit: a launchd job's stderr goes to an unread log, so
 * an exit code is the only checked value, and nothing folds the push's code into a
 * shared health signal.
 *
 * This command's exit code has a LIVE CONSUMER with a different meaning.
 * `ops/price-feed/run-daily-fetch.sh` runs `pnpm backfill` under `set -euo pipefail`,
 * so a non-zero return aborts the script before it stamps `complete` and the heartbeat
 * records `exitCode: 1, lastStep: "backfill"` — which the TUI renders on EVERY startup
 * as "the daily price job FAILED". A malformed policy line is a STANDING FACT, not an
 * errand: it does not extinguish on its own, so that channel would stay red from the
 * night the typo landed until someone edited the sidecar, and would be retired for the
 * next REAL failure. `gap-report-core.ts` settled the identical trade-off the same way
 * — *a lost day is reported; a broken job is failed*, because a permanently red job is
 * one nobody reads.
 *
 * So the VERDICT keeps its exit code (`preferencesExitCode`, still asserted) and this
 * SHELL declines to fold it into the process's. A failed replay still exits non-zero:
 * it throws, and `backfill.ts` catches. The report is what changes hands here, not the
 * severity of a crash.
 */
export async function runBackfillAndReport(
  input: BackfillAndReportInput,
): Promise<BackfillRun> {
  let preferencesExitCode = 0;
  const results = await runBackfill({
    pool: input.pool,
    paths: input.paths,
    onAnchor: input.onAnchor,
    // The co-tenancy seam, deliberately not collapsed into a helper: derive one kind's
    // verdict, file its PROSE under its own kind, accumulate its EXIT CODE separately.
    // A second kind is three more lines in the same shape, with its own exit policy.
    onPreferencesLoad: (loaded) => {
      const verdict = unattendedPreferencesVerdict(loaded);
      input.channel.add(PREFERENCES_DIAGNOSTIC_KIND, verdict.messages);
      preferencesExitCode = Math.max(preferencesExitCode, verdict.exitCode);
    },
  });

  await input.onComplete?.(results);
  input.channel.emit(input.emit ?? ((line) => console.error(line)));
  return { results, preferencesExitCode, exitCode: 0 };
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
