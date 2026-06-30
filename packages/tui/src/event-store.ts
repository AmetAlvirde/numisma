/**
 * PROTOTYPE (mvi 2026-06-29-portfolio-persistence). Access-surface half of the
 * event-sourcing spine — the file IO, inbox detection, dedup persistence, and
 * startup orchestration that ADR-001 keeps OUT of `@numisma/engine`. The pure
 * fold + event validation live in the engine (`foldEvents` / `parseEvent`).
 *
 * Durable truth on disk:
 *   - data/genesis.json          immutable t0 seed (a FundReviewData shape)
 *   - data/events.jsonl          append-only log, one JSON event per line
 *   - data/inbox/transactions.json  disposable write channel (array of events)
 *   - data/ingested/<wall-clock>.json  archive of a consumed inbox
 *   - data/events.jsonl.quarantine  the lane for surfaced corrupt log lines
 *
 * DURABILITY (reliable conversion, ADR-003 slice 3):
 *   - Archives are stamped with the wall-clock ingest moment and refuse to clobber
 *     a prior archive; a zero-new re-drop archives nothing.
 *   - A corrupt log line is quarantined to a side lane and surfaced; the rest of
 *     the log still loads and startup proceeds.
 *   - Append is atomic (write a full next image to a sibling temp file, then
 *     rename over the log) so an interrupted write cannot truncate a line.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  applyEventToReference,
  buildEventReference,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  parseFundReview,
  type FundReviewData,
  type PortfolioEvent,
} from "@numisma/engine";

export interface EventStorePaths {
  genesis: string;
  log: string;
  inbox: string;
  ingestedDir: string;
}

export interface IngestReport {
  newCount: number;
  duplicateCount: number;
  archivedTo?: string;
}

/** A log line that failed to parse, diverted to the quarantine lane on read. */
export interface QuarantinedLine {
  lineNumber: number;
  line: string;
  reason: string;
}

/** The result of reading the append-only log: the good events plus any corrupt
 * lines that were quarantined rather than aborting the load. */
export interface EventLogLoad {
  events: PortfolioEvent[];
  quarantined: QuarantinedLine[];
}

const DATA_DIR = "data";

/** The quarantine lane sits beside the log it shadows. */
export function quarantineLogPath(logPath: string): string {
  return `${logPath}.quarantine`;
}

export function resolveEventStorePaths(dataDir = DATA_DIR): EventStorePaths {
  const base = resolve(dataDir);
  return {
    genesis: join(base, "genesis.json"),
    log: join(base, "events.jsonl"),
    inbox: join(base, "inbox", "transactions.json"),
    ingestedDir: join(base, "ingested"),
  };
}

/**
 * Parse an `--as-of <date>` / `--as-of=<date>` flag, if present. Returns the
 * date string for the fold, or undefined for current state. Throws on a flag
 * with a missing or malformed value so startup fails loud.
 */
export function parseAsOfArg(args: string[]): string | undefined {
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--as-of") {
      return requireAsOfValue(args[index + 1]);
    }
    if (arg?.startsWith("--as-of=")) {
      return requireAsOfValue(arg.slice("--as-of=".length));
    }
  }
  return undefined;
}

function requireAsOfValue(value: string | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Missing or invalid value for --as-of (expected YYYY-MM-DD).");
  }
  return value;
}

/** Read and structurally validate the immutable genesis seed. */
export async function loadGenesis(genesisPath: string): Promise<FundReviewData> {
  const raw = await readFile(genesisPath, "utf8");
  const parsed = parseFundReview(raw);
  if (parsed.kind !== "ok") {
    throw new Error(`Genesis seed failed validation (${parsed.kind}) at ${genesisPath}.`);
  }
  return parsed.value;
}

/**
 * Read the append-only log, validating each line into a typed event. A line that
 * fails to parse is diverted to the quarantine lane (returned, and surfaced to a
 * durable `events.jsonl.quarantine` sidecar) instead of aborting the load, so a
 * single corrupt line degrades gracefully rather than bricking startup. The rest
 * of the log still loads. The log file itself is never mutated on read.
 */
export async function loadEventLog(logPath: string): Promise<EventLogLoad> {
  const raw = await readOptional(logPath);
  const events: PortfolioEvent[] = [];
  const quarantined: QuarantinedLine[] = [];
  if (raw !== undefined) {
    for (const [index, line] of raw.split("\n").entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parsed = parseLogLine(trimmed);
      if (parsed.ok) {
        events.push(parsed.event);
      } else {
        quarantined.push({ lineNumber: index + 1, line: trimmed, reason: parsed.reason });
      }
    }
  }
  await surfaceQuarantine(logPath, quarantined);
  return { events, quarantined };
}

type ParsedLine =
  | { ok: true; event: PortfolioEvent }
  | { ok: false; reason: string };

function parseLogLine(line: string): ParsedLine {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  const result = parseEvent(json);
  if (result.kind !== "ok") {
    return { ok: false, reason: `${result.path}: ${result.message}` };
  }
  return { ok: true, event: result.value };
}

/**
 * Write the corrupt lines to the quarantine lane (one JSON record per line) so the
 * bad input is durably surfaced for the user to fix; remove a stale lane when the
 * log reads clean, so a fixed log self-heals. Idempotent: the lane reflects exactly
 * the current read, so repeated reads in one startup converge on the same content.
 */
async function surfaceQuarantine(logPath: string, quarantined: QuarantinedLine[]): Promise<void> {
  const lanePath = quarantineLogPath(logPath);
  if (quarantined.length === 0) {
    await rm(lanePath, { force: true });
    return;
  }
  await mkdir(dirname(logPath), { recursive: true });
  const body = `${quarantined.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await writeFile(lanePath, body, "utf8");
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
 */
export async function ingestInbox(
  paths: EventStorePaths,
  options: { now?: () => Date } = {},
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
  const { events: existing } = await loadEventLog(paths.log);
  const seen = new Set(existing.map((event) => event.id));
  // The known world is genesis + the durable log; accepted batch events extend it
  // in order, so a position opened earlier in this inbox can be referenced later.
  const reference = buildEventReference(genesis, existing);

  const toAppend: PortfolioEvent[] = [];
  let duplicateCount = 0;
  for (const [index, candidate] of parsed.entries()) {
    const result = parseEvent(candidate);
    if (result.kind !== "ok") {
      throw new Error(
        `Inbox transaction [${index}] is invalid (${result.path}: ${result.message}).`,
      );
    }
    if (seen.has(result.value.id)) {
      duplicateCount += 1;
      continue;
    }
    const crossRef = crossReferenceEvent(result.value, reference);
    if (crossRef.kind !== "ok") {
      throw new Error(
        `Inbox transaction [${index}] failed cross-reference (${crossRef.path}: ${crossRef.message}).`,
      );
    }
    seen.add(result.value.id);
    applyEventToReference(reference, result.value);
    toAppend.push(result.value);
  }

  // No-op archive on a zero-new re-drop: archive nothing and leave the inbox (and
  // any prior archive) untouched, honoring the "never overwritten" promise. Only a
  // batch that actually extends the log consumes and archives the inbox.
  if (toAppend.length === 0) {
    return { newCount: 0, duplicateCount };
  }

  await appendEvents(paths.log, toAppend);
  const now = options.now ?? (() => new Date());
  const archivedTo = await archiveInbox(paths, now());

  return { newCount: toAppend.length, duplicateCount, archivedTo };
}

/** Ingest, then fold genesis + log to `asOf` (or current state) for rendering. */
export async function loadFoldedReview(
  paths: EventStorePaths,
  asOf?: string,
): Promise<FundReviewData> {
  const genesis = await loadGenesis(paths.genesis);
  const { events } = await loadEventLog(paths.log);
  return foldEvents(genesis, events, asOf);
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
  await mkdir(dirname(logPath), { recursive: true });
  const lines = events.map((event) => JSON.stringify(event)).join("\n");
  const existing = await readOptional(logPath);
  const prefix = existing && existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const next = `${existing ?? ""}${prefix}${lines}\n`;
  const tempPath = `${logPath}.tmp`;
  await writeFile(tempPath, next, "utf8");
  await rename(tempPath, logPath);
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
