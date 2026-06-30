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
 *   - data/ingested/<asOf>.json  archive of a consumed inbox
 *
 * SHORTCUTS (visible, prototype-only):
 *   - Archive filename is the genesis review date (no wall clock in tests); a
 *     real ingest would stamp the actual ingest moment and avoid collisions.
 *   - A malformed inbox or log line throws / is reported; there is no partial
 *     recovery or quarantine lane yet.
 *   - Append is a plain file append, not atomic/locked — fine for single-user
 *     local-first, hardened during reliable conversion.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

const DATA_DIR = "data";

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

/** Read the append-only log, validating each line into a typed event. */
export async function loadEventLog(logPath: string): Promise<PortfolioEvent[]> {
  const raw = await readOptional(logPath);
  if (raw === undefined) {
    return [];
  }
  const events: PortfolioEvent[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    events.push(parseLogLine(trimmed, logPath, index + 1));
  }
  return events;
}

function parseLogLine(line: string, logPath: string, lineNumber: number): PortfolioEvent {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    throw new Error(`Corrupt event log: line ${lineNumber} of ${logPath} is not valid JSON.`);
  }
  const result = parseEvent(json);
  if (result.kind !== "ok") {
    throw new Error(
      `Corrupt event log: line ${lineNumber} of ${logPath} (${result.path}: ${result.message}).`,
    );
  }
  return result.value;
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
export async function ingestInbox(paths: EventStorePaths): Promise<IngestReport> {
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
  const existing = await loadEventLog(paths.log);
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

  if (toAppend.length > 0) {
    await appendEvents(paths.log, toAppend);
  }
  const latestDate = toAppend.reduce<string>((latest, event) => (event.asOf > latest ? event.asOf : latest), "");
  const archivedTo = await archiveInbox(paths, latestDate || "ingested");

  return { newCount: toAppend.length, duplicateCount, archivedTo };
}

/** Ingest, then fold genesis + log to `asOf` (or current state) for rendering. */
export async function loadFoldedReview(
  paths: EventStorePaths,
  asOf?: string,
): Promise<FundReviewData> {
  const genesis = await loadGenesis(paths.genesis);
  const events = await loadEventLog(paths.log);
  return foldEvents(genesis, events, asOf);
}

async function appendEvents(logPath: string, events: PortfolioEvent[]): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const lines = events.map((event) => JSON.stringify(event)).join("\n");
  const existing = await readOptional(logPath);
  const prefix = existing && existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(logPath, `${existing ?? ""}${prefix}${lines}\n`, "utf8");
}

async function archiveInbox(paths: EventStorePaths, stamp: string): Promise<string> {
  await mkdir(paths.ingestedDir, { recursive: true });
  const archivedTo = join(paths.ingestedDir, `${stamp}.json`);
  await rename(paths.inbox, archivedTo);
  return archivedTo;
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
