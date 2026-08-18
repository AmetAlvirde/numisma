/**
 * WRITE half of the event-sourcing spine — the inbox ingest, dedup persistence,
 * atomic append, archival, and the one-shot legacy migration. The pure fold +
 * event validation live in the engine (`foldEvents` / `parseEvent`), as does the
 * pending-inbox walk this ingest folds with (`walkPendingInbox`, shared verbatim
 * with the price-feed's fetch-time rejection pre-check); the durable
 * log's READ path — path resolution, genesis load, log load, quarantine, the
 * folded review — has moved to `@numisma/event-store`, shared with the web push,
 * and is imported back here (`loadGenesis`, `loadEventLog`, `readOptional`,
 * `assertLogFullyLoaded`, `EventStorePaths`).
 *
 * Durable truth on disk (paths resolved by `@numisma/event-store`):
 *   - data/genesis.json          immutable t0 seed (a FundReviewData shape)
 *   - data/events.jsonl          append-only log, one JSON event per line
 *   - data/inbox/transactions.json  disposable write channel (array of events)
 *   - data/ingested/<wall-clock>.json  archive of a consumed inbox
 *   - data/events.jsonl.quarantine  the lane for surfaced corrupt log lines
 *
 * DURABILITY (ADR-003):
 *   - Archives are stamped with the wall-clock ingest moment and refuse to clobber
 *     a prior archive; a zero-new re-drop archives nothing.
 *   - A corrupt log line is quarantined to a side lane and surfaced; the read path
 *     then refuses to fold a partial log.
 *   - Append is atomic (write a full next image to a sibling temp file, then
 *     rename over the log) so an interrupted write cannot truncate a line.
 *
 * The spine's argv/env operator knobs (`--as-of`, `--magnitude-threshold` /
 * `SPINE_MAGNITUDE_THRESHOLD`) are NOT here: they are pure CLI parsing with no
 * durable-log stake, and live in `./spine-args.ts` (audit finding 35).
 */
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { captureIngestCommit, readAppVersion, resolveWorkspaceRoot } from "./ingest-commit.js";
import {
  buildEventReference,
  crossReferenceEvent,
  dedupeFoldSkips,
  EVENT_SCHEMA_VERSION,
  foldEvents,
  migrateLegacyEvent,
  parseEvent,
  walkPendingInbox,
  type PortfolioEvent,
  type SkippedFoldEvent,
  type SuppliedCashLeg,
} from "@numisma/engine";
import {
  assertLogFullyLoaded,
  loadEventLog,
  loadGenesis,
  readOptional,
  type EventStorePaths,
} from "@numisma/event-store";

export interface IngestReport {
  newCount: number;
  duplicateCount: number;
  archivedTo?: string;
}

/**
 * Ingest the inbox if present: structurally validate (`parseEvent`) and
 * cross-reference (`crossReferenceEvent`) each transaction against the loaded
 * genesis ids and the existing log, dedup by stable `id`, append the new ones,
 * then archive the consumed inbox. Returns the new/duplicate counts the TUI
 * surfaces ("Success, N new, M duplicate"). A missing inbox is the normal case
 * and reports zero.
 *
 * Fail-loud, all-or-nothing: any structural, cross-reference, or magnitude
 * rejection throws BEFORE the single append/archive at the tail, so the durable
 * log is left byte-for-byte unchanged and the inbox stays in place for the user
 * to fix. Per ADR-001 this orchestration (loading the genesis seed off disk,
 * driving the loop) lives here; the validation logic it calls lives in the engine.
 *
 * MAGNITUDE OVERRIDE (`options.magnitudeThreshold`). A `PriceMarked` deviating
 * beyond the engine's ±50% guard (`PRICE_MARK_MAGNITUDE_THRESHOLD`) is normally
 * rejected as a fat-finger / currency-unit slip. When a genuine big move is real,
 * the operator can consciously widen the band for THIS ingest by passing a larger
 * relative threshold (e.g. `1.5` for ±150%); it is handed straight to the engine's
 * `crossReferenceEvent` and applies ONLY to the magnitude guard — structural
 * (`parseEvent`), existence, id-collision, and Reserve-sufficiency validation are
 * untouched. Left unset (the default), the engine keeps its own ±50% default and
 * behavior is byte-for-byte identical to a run with no options. This is the
 * documented recovery for a real >50% move (see docs/price-feed-ops.md); the
 * `pnpm spine` entry point exposes it only via a conspicuous, opt-in operator
 * override, never a routine dial.
 */
export async function ingestInbox(
  paths: EventStorePaths,
  options: { now?: () => Date; magnitudeThreshold?: number } = {},
): Promise<IngestReport> {
  const raw = await readOptional(paths.inbox);
  if (raw === undefined) {
    return { newCount: 0, duplicateCount: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Inbox ${paths.inbox} is not valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Inbox ${paths.inbox} must be a JSON array of transactions.`);
  }

  const genesis = await loadGenesis(paths.genesis);
  const existingLoad = await loadEventLog(paths.log);
  assertLogFullyLoaded(existingLoad, paths.log);
  const existing = existingLoad.events;

  // The walk itself — parse, dedup by id before the guard, cross-reference, re-fold on
  // accept — is the engine's `walkPendingInbox`, shared verbatim with the price-feed's
  // fetch-time rejection pre-check (audit finding 9). The known world is handed in as
  // INPUTS (genesis + the durable log) rather than as a pre-built reference: under
  // ADR-015 the gate reads `foldEvents(genesis, acceptedSoFar)`, so the walk re-derives
  // per accept and a position opened earlier in this inbox is citable later because the
  // FOLD says it exists. Only the magnitude dial is passed when the operator set it
  // (`undefined` keeps the engine's own ±50% default). `haltOnRejection` is THIS
  // caller's all-or-nothing policy: the walk stops at the first refusal and we throw
  // below, so nothing is appended.
  //
  // NOTE the posture change ADR-015 records: this fold now runs BEFORE the append, so a
  // book that cannot be folded refuses the batch. That is deliberate, and unlike the
  // best-effort fold in the capture block further down, which only ever warns.
  const walk = walkPendingInbox(parsed, { genesis, priorEvents: existing }, {
    seenIds: new Set(existing.map((event) => event.id)),
    haltOnRejection: true,
    ...(options.magnitudeThreshold === undefined
      ? {}
      : { magnitudeThreshold: options.magnitudeThreshold }),
  });
  if (walk.invalid) {
    throw new Error(
      `Inbox transaction [${walk.invalid.index}] is invalid (${walk.invalid.path}: ${walk.invalid.message}).`,
    );
  }
  const [rejection] = walk.rejected;
  if (rejection) {
    throw new Error(
      `Inbox transaction [${rejection.index}] failed cross-reference (${rejection.path}: ${rejection.message}).`,
    );
  }
  const toAppend = walk.accepted;
  const duplicateCount = walk.duplicateCount;

  // No-op archive on a zero-new re-drop: archive nothing and leave the inbox (and
  // any prior archive) untouched, honoring the "never overwritten" promise. Only a
  // batch that actually extends the log consumes and archives the inbox.
  if (toAppend.length === 0) {
    return { newCount: 0, duplicateCount };
  }

  await appendEvents(paths.log, toAppend);

  // Best-effort durable-log capture: fold the new head and commit head-digest + log into
  // the dataDir's accumulus checkout. The append above already landed atomically, so this
  // whole block is guarded — a fold/git failure downgrades to a warning and NEVER fails
  // the ingest. `paths.log` is `<dataDir>/events.jsonl`, so its dirname is the dataDir.
  try {
    const dataDir = dirname(paths.log);
    // The WHOLE envelope goes to the capture, never `.data`: `head-digest.json` is
    // committed into accumulus as a head a reader trusts WITHOUT replaying the log, so a
    // silently dropped event here would be laundered into a permanent artifact nobody
    // re-checks. The digest carries the discard count (ADR-020, `HeadDigest` v2); the
    // records themselves reach the operator through the surfaces that can act on them.
    const foldedHead = foldEvents(genesis, [...existing, ...toAppend]);
    const appVersion = readAppVersion(resolveWorkspaceRoot());
    await captureIngestCommit({ dataDir, folded: foldedHead, appendedEvents: toAppend, appVersion });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`⚠️ ingest commit capture skipped — append is durable on disk. ${detail}\n`);
  }

  const now = options.now ?? (() => new Date());
  const archivedTo = await archiveInbox(paths, now());

  return { newCount: toAppend.length, duplicateCount, archivedTo };
}

export interface MigrationReport {
  /** Legacy open/close records upgraded with a supplied cash leg. */
  migratedCount: number;
  /** Already-loadable records re-written unchanged (now schemaVersion-stamped). */
  unchangedCount: number;
  outputPath: string;
  /**
   * Every event the migration's OWN cross-reference folds read and could not apply,
   * deduped on (`eventId`, `reason`) — the Discard Channel carried out of the one path
   * #293 names as UNGATEABLE (ADR-020; PRD #323 seam C). Empty on a clean log.
   *
   * IT MATTERS MOST HERE. Every other reader of this channel is looking at history that
   * at least passed the ingest gates once; this rewrite is the path that never did, and
   * it is also the one moment the whole log is read start to finish. Reported, never
   * acted on: a drop is a fact about history the migration is faithfully preserving, and
   * aborting a one-shot rewrite over one long-dead event would leave the operator with a
   * log they can neither migrate nor repair (#323 R2).
   *
   * DEDUPED BECAUSE THE LOOP FOLDS PER LINE. The walk re-folds the output prefix once
   * per line, so a drop at line 3 of a 400-line log is reported ~397 times — a count of
   * the loop, not of the damage.
   */
  discarded: SkippedFoldEvent[];
}

/**
 * The ONE-SHOT durable-log migration ADR-003's amendment sanctions: rewrite every
 * legacy (pre-cash-leg / v1) open/close in the log to the v2 cash-leg shape using an
 * operator-supplied `cashLegs` map (keyed by the event's stable `id`), leaving
 * already-loadable records unchanged (re-serialized with the schemaVersion marker).
 * Honest and fail-loud, never lossy:
 *
 *   - A line that is not valid JSON, or that fails to parse for a reason other than
 *     a missing cash leg, aborts the whole migration (nothing is written).
 *   - A legacy open/close with NO supplied cash leg aborts, listing every id that
 *     still needs one — the operator, not the code, holds the settling Reserve and
 *     the proceeds/funding split.
 *   - The fully-migrated sequence is cross-referenced in order against genesis, so a
 *     supplied leg that overdraws a Reserve or is a fat-finger magnitude fails loud
 *     BEFORE anything touches disk.
 *
 * The rewrite goes through {@link writeLogImage} — the one temp + rename writer — so
 * the path that rewrites the WHOLE durable log is hardened by anything landed there,
 * never left behind by a second hand-rolled copy. This is a
 * deliberate one-time reconstruction, NOT a runtime append path — append-only still
 * holds going forward. Idempotent: re-running a clean log migrates nothing.
 *
 * A log with nothing in it to migrate — absent, empty, or blank lines only — returns a
 * zero report and touches no disk at all, so the caller's "no durable log" sentence is
 * true of the bytes as well as of the counts (#345; the guard carries the reasoning).
 *
 * IT ALSO REPORTS WHAT THE FOLD DROPPED, and this is the path where that matters most:
 * #293 names the legacy migration as the one the ingest gates cannot cover. The
 * cross-reference below runs the fold (`buildEventReference`), so its discards are in
 * hand here and leave on {@link MigrationReport.discarded}. Reported, never acted on —
 * this rewrite preserves history including its damage (ADR-020, report never refuse).
 */
export async function migrateLegacyLog(
  paths: EventStorePaths,
  cashLegs: Map<string, SuppliedCashLeg>,
): Promise<MigrationReport> {
  const raw = await readOptional(paths.log);
  // A CONTENTLESS LOG IS THE SAME ANSWER AS A MISSING ONE (#345): nothing to migrate,
  // nothing written, and the file left byte-for-byte as the operator left it.
  //
  // Two shapes reach here as "contentless" and they are ONE seam, not two cases: an
  // existing empty log, and one holding only blank lines. The loop below trims each line
  // and skips the empty ones, so neither shape can ever yield a record — but without this
  // guard both still fell through to `writeLogImage` and were replaced by a single
  // newline byte, while `migratedCount + unchangedCount === 0` sent the shell down its
  // "No durable log to migrate" branch. The report was a lie about a write that happened,
  // on the one tool in the repo that rewrites the whole durable log. Hence the predicate
  // is the loop's own rule hoisted above the write — no content once blank lines are
  // discarded — rather than an `=== ""` check that would fix half of it.
  //
  // THE GUARD BELONGS HERE, NOT IN `readOptional`. That helper maps ENOENT alone to
  // `undefined`, and its other callers read it for exactly that: "absent" and "present
  // but empty" are different facts about the disk. Widening it to fold `""` into
  // `undefined` would quiet this path by destroying the distinction that separates an
  // empty log from an unreadable one. "Nothing to migrate" is a policy this migration
  // owns.
  //
  // IT RETURNS ABOVE `loadGenesis`, AND THAT PLACEMENT IS THE POINT, not an oversight —
  // it is a real behaviour change and it is deliberate. An empty log in a data dir whose
  // `genesis.json` is missing or corrupt now ends 0 with "No durable log to migrate",
  // where before #345 it ended 1 naming `genesis.json`. That is the guard's own thesis
  // applied consistently: an ABSENT log has always returned from here, above the genesis
  // read, so a CONTENTLESS one — which #345 says is the same answer — has to leave through
  // the same door or the two shapes are not really one seam. Genesis is loaded to
  // cross-reference records against; with no records there is nothing to cross-reference,
  // and demanding the operator repair a file this run was never going to read would be a
  // refusal about nothing. Pinned in `migrate-legacy-log.test.ts` — the case that plants an
  // empty log in a dir with no genesis at all — which is what goes red if this guard ever
  // drifts below the read.
  if (raw === undefined || raw.trim().length === 0) {
    return { migratedCount: 0, unchangedCount: 0, outputPath: paths.log, discarded: [] };
  }

  const genesis = await loadGenesis(paths.genesis);
  const migrated: PortfolioEvent[] = [];
  const unresolved: string[] = [];
  // The union over every per-line fold below; deduped once on the way out.
  const foldSkips: SkippedFoldEvent[] = [];
  let migratedCount = 0;

  // Number lines EXACTLY as the read half does (`loadEventLog`): a blank line is a
  // record to neither half, but it still consumes a line number, so every number
  // reported here is the physical line an editor shows. When the two halves disagree
  // the operator hand-edits whichever line the second message named — and in an
  // append-only durable log that corrupts a good line. Hence: skip blanks INSIDE the
  // loop, never filter them out before enumerating.
  for (const [index, rawLine] of raw.split("\n").entries()) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const lineNumber = index + 1;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(
        `Migration aborted: line ${lineNumber} is not valid JSON; only structurally-parseable records can be migrated.`,
      );
    }

    const parsed = parseEvent(json);
    let event: PortfolioEvent;
    if (parsed.kind === "ok") {
      event = parsed.value;
    } else {
      const object = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : undefined;
      const id = typeof object?.id === "string" ? object.id : undefined;
      const type = typeof object?.type === "string" ? object.type : undefined;
      const isLegacyTrade = type === "PositionOpened" || type === "PositionClosed";
      if (!isLegacyTrade || id === undefined) {
        throw new Error(
          `Migration aborted: line ${lineNumber} failed to parse and is not a migratable legacy ` +
            `open/close (${parsed.path}: ${parsed.message}).`,
        );
      }
      const cashLeg = cashLegs.get(id);
      if (!cashLeg) {
        const leg = type === "PositionOpened" ? "funding" : "settlement";
        unresolved.push(`  line ${lineNumber}: ${type} id '${id}' — supply a ${leg} leg`);
        continue;
      }
      const remigrated = migrateLegacyEvent(json, cashLeg);
      if (remigrated.kind !== "ok") {
        throw new Error(
          `Migration aborted: supplied cash leg for line ${lineNumber} (id '${id}') is invalid ` +
            `(${remigrated.path}: ${remigrated.message}).`,
        );
      }
      event = remigrated.value;
      migratedCount += 1;
    }

    // WHAT "accepted so far" MEANS MID-MIGRATION (ADR-015 named this the sharp one).
    // It is `migrated` — the prefix of the OUTPUT image, not of the input file. Every
    // line before this one has already been repaired into its v2 shape and cleared the
    // gate, and `migrated` is exactly the log that would exist if the migration stopped
    // here. So the world this line is judged against is `foldEvents(genesis, migrated)`:
    // the same question the spine asks of an inbox candidate, asked of the log the
    // rewrite is building. A legacy line's PRE-migration shape never enters the world —
    // it could not, it does not parse — which is why the walk had to be re-pointed at
    // the accumulator rather than at the file being read.
    //
    // O(n²) folds — one fold of the output prefix per line — over a one-shot,
    // operator-initiated rewrite. Measured on a mark-heavy synthetic log (2026-08-08,
    // Node 24): 1k lines 215 ms, 4k lines 2.8 s. Those are post-fix numbers; before the
    // fold's `closes[]` lookup became a Map the same walk cost 883 ms and 53 s, because
    // this path was O(n²) folds of a fold that was itself quadratic in marks (ADR-015).
    // At these magnitudes the price is worth paying to judge each line against the real
    // book; if the log ever grows to where that bites, fold incrementally here rather
    // than reintroducing a shadow.
    // The reference's own fold is the ONLY read of the whole log this path makes, so
    // what it dropped leaves on the report (see `MigrationReport.discarded`) rather than
    // dying with the loop iteration that saw it. It never changes the verdict below.
    const reference = buildEventReference(genesis, migrated);
    foldSkips.push(...reference.skipped);
    const crossRef = crossReferenceEvent(event, reference);
    if (crossRef.kind !== "ok") {
      throw new Error(
        `Migration aborted: line ${lineNumber} fails cross-reference after migration ` +
          `(${crossRef.path}: ${crossRef.message}).`,
      );
    }
    migrated.push(event);
  }

  if (unresolved.length > 0) {
    throw new Error(
      `Migration aborted: ${unresolved.length} legacy record(s) have no supplied cash leg. ` +
        `Supply one per id (keyed by event id) and retry:\n${unresolved.join("\n")}`,
    );
  }

  await writeLogImage(paths.log, `${migrated.map((event) => serializeEvent(event)).join("\n")}\n`);

  return {
    migratedCount,
    unchangedCount: migrated.length - migratedCount,
    outputPath: paths.log,
    discarded: dedupeFoldSkips(foldSkips),
  };
}

/**
 * Append events atomically: build the full next image of the log, write it to a
 * sibling temp file, then `rename` over the log. rename(2) within a directory is
 * atomic, so a crash mid-write leaves the prior log intact — a reader never sees a
 * half-written or truncated final line.
 *
 * Despite the name this is O(n) in the existing log, not an O(1) `appendFile`: it
 * reads and rewrites the whole image each ingest. That is the deliberate price of
 * the rename-based crash-atomicity above — a partial `appendFile` could leave a
 * torn final line. Fine at this log's scale; revisit only if the log grows large.
 */
async function appendEvents(logPath: string, events: PortfolioEvent[]): Promise<void> {
  const existing = await readOptional(logPath);
  await writeLogImage(logPath, nextLogImage(existing, events));
}

/**
 * The log's next image: the prior bytes, the missing terminator if the prior image lacks
 * one, then the new lines. Extracted so the two-file fill act (`record-fill.ts`) builds
 * its image with the SAME function the ordinary ingest does — a second image builder is
 * a second chance to get the torn-line repair wrong, and the plans-sidecar prototype
 * already demonstrated what that costs.
 */
export function nextLogImage(prior: string | undefined, events: PortfolioEvent[]): string {
  const lines = events.map((event) => serializeEvent(event)).join("\n");
  const prefix = prior && prior.length > 0 && !prior.endsWith("\n") ? "\n" : "";
  return `${prior ?? ""}${prefix}${lines}\n`;
}

/**
 * Per-process counter behind the temp name. Two writes from the SAME process can
 * be in flight at once (the pid alone would collide), so the name carries a tick
 * as well; across processes the pid separates them.
 */
let tempImageTick = 0;

/**
 * Write a full image of the log via temp + rename. The only way the log is written.
 *
 * The temp file's name is unique per write — `<log>.<pid>.<tick>.tmp` — and lives in the
 * SAME directory as the log. Unique because a shared `<log>.tmp` is a shared mutable file:
 * two concurrent writers open it at once, one truncates what the other is still writing,
 * and the rename — atomic in itself — then publishes a blended or truncated image, or
 * fails outright because the sibling already renamed the source away. Same directory
 * because rename(2) is only atomic within one filesystem; a temp in `os.tmpdir()` would
 * degrade to a copy that can tear.
 *
 * The suffix stays `.tmp` — that is policy, not decoration. Accumulus's `/data/*.tmp`
 * ignore rule (ADR-006) is the only thing stopping a multi-megabyte staged image from
 * becoming committable into the private data repo, so any rename of this scheme must
 * keep the `.tmp` ending. `packages/preferences/src/sidecar-io.ts` carries the same
 * constraint on its own copy; both must hold it.
 *
 * A failed write removes its own temp file, so a doomed write leaves no litter behind.
 * The cleanup is best-effort BY DESIGN: if the removal itself fails (the directory went
 * read-only, which is often why the write failed in the first place) its error is
 * dropped, because the caller must be told the log image failed to publish — not handed
 * an `unlink` error naming a temp file it has never heard of.
 */
export async function writeLogImage(logPath: string, contents: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  tempImageTick += 1;
  const tempPath = `${logPath}.${process.pid}.${tempImageTick}.tmp`;
  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, logPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Put the log back to a prior image — the ROLLBACK half of the two-file fill act.
 *
 * This is only sound because every writer above builds a full next image and renames it
 * over the log: the prior image is a complete, valid file, so restoring it is another
 * atomic rename rather than a surgical edit. `undefined` means the log did not exist
 * before, and the honest undo of creating it is removing it.
 */
export async function restoreLogImage(logPath: string, prior: string | undefined): Promise<void> {
  if (prior === undefined) {
    await rm(logPath, { force: true });
    return;
  }
  await writeLogImage(logPath, prior);
}

/**
 * Move the consumed inbox into the archive under a wall-clock-stamped name. The
 * stamp refuses to clobber a prior archive: if the name is already taken (two
 * same-instant batches), it probes a disambiguated `<stamp>-<n>.json` so the
 * consumed inbox is preserved, never overwritten.
 */
async function archiveInbox(paths: EventStorePaths, now: Date): Promise<string> {
  await mkdir(paths.ingestedDir, { recursive: true });
  const stamp = wallClockStamp(now);
  let archivedTo = join(paths.ingestedDir, `${stamp}.json`);
  for (let suffix = 1; await pathExists(archivedTo); suffix += 1) {
    archivedTo = join(paths.ingestedDir, `${stamp}-${suffix}.json`);
  }
  await rename(paths.inbox, archivedTo);
  return archivedTo;
}

/**
 * Serialize one event to a durable-log line, stamped with the current
 * {@link EVENT_SCHEMA_VERSION}. The marker is a storage-layer field (parse strips
 * it), written first so a line's version is eyeball-visible; every line the app or
 * the one-shot migration writes carries it, making the record shape explicit and
 * future migrations version-targetable (ADR-003 amendment).
 */
export function serializeEvent(event: PortfolioEvent): string {
  return JSON.stringify({ schemaVersion: EVENT_SCHEMA_VERSION, ...event });
}

/** A filesystem-safe ISO stamp, e.g. `2026-06-29T14-03-22-123Z`. */
function wallClockStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
