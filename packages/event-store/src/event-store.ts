/**
 * The durable log's READ path — lifted verbatim out of `apps/tui/src/event-store.ts`
 * so both runnable surfaces can fold the same log. The TUI reads it to render; the
 * web push reads it to publish. ADR-001 keeps this file IO OUT of `@numisma/engine`
 * (which stays I/O-free); the pure fold + event validation live there
 * (`foldEvents` / `parseEvent`), and this package is the thin IO shell around them.
 *
 * Deliberately app-free: plain `node:fs`, no Bun, no terminal, no git, no argv. The
 * write half (inbox ingest, atomic append, archival, the one-shot legacy migration,
 * git capture) stays in the TUI app.
 *
 * Durable truth on disk this path reads:
 *   - data/genesis.json            immutable t0 seed (a FundReviewData shape)
 *   - data/events.jsonl            append-only log, one JSON event per line
 *   - data/events.jsonl.quarantine the lane for surfaced corrupt log lines
 *
 * DURABILITY (reliable conversion, ADR-003 slice 3):
 *   - A corrupt log line is quarantined to a side lane and surfaced; the rest of
 *     the log still loads. The fold path then refuses to run on a partial log.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  foldEvents,
  parseEvent,
  parseFundReview,
  resolveDataDir,
  type FundReviewData,
  type PortfolioEvent,
} from "@numisma/engine";

export interface EventStorePaths {
  genesis: string;
  log: string;
  inbox: string;
  ingestedDir: string;
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

/**
 * Resolve the default dataDir root honoring the `NUMISMA_DATA_DIR` env var — the
 * SINGLE knob that moves EVERY plane. The resolution rule (env override with an
 * absolute, homedir-derived accumulus default; relative values rejected) is the
 * pure engine `resolveDataDir`; this thin wrapper keeps the public name the tui
 * callers already use.
 */
export function resolveDataDirDefault(): string {
  return resolveDataDir();
}

/** The quarantine lane sits beside the log it shadows. */
export function quarantineLogPath(logPath: string): string {
  return `${logPath}.quarantine`;
}

export function resolveEventStorePaths(dataDir = resolveDataDirDefault()): EventStorePaths {
  const base = resolve(dataDir);
  return {
    genesis: join(base, "genesis.json"),
    log: join(base, "events.jsonl"),
    inbox: join(base, "inbox", "transactions.json"),
    ingestedDir: join(base, "ingested"),
  };
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

/**
 * Fail loud when the durable log holds any line that would not load. A dropped
 * material event (a legacy-shape open/close, or any unparseable line) silently
 * skews the fold — a plausible-but-wrong NAV, the exact drift class this MVI
 * eliminates — so the fold/ingest paths refuse to run on a partial log rather than
 * degrade gracefully. The quarantine sidecar has already been written by
 * {@link loadEventLog}, so the operator can see every offending line and reason; a
 * legacy open/close is additionally pointed at the one-shot migration. This is the
 * ADR-003 amendment's migration/versioning contract enforced at the read boundary
 * (it reverses the prototype's "a corrupt line degrades gracefully" behavior).
 * `foldEvents` itself stays a pure projection — the loud stop lives here, not in the
 * fold.
 *
 * Exported because the TUI's `ingestInbox` guards its read of the existing log with
 * exactly this assertion; the package owns the single definition.
 */
export function assertLogFullyLoaded(load: EventLogLoad, logPath: string): void {
  if (load.quarantined.length === 0) {
    return;
  }
  const detail = load.quarantined
    .map((entry) => `  line ${entry.lineNumber}: ${entry.reason}`)
    .join("\n");
  throw new Error(
    `Durable log ${logPath} has ${load.quarantined.length} unloadable line(s); refusing to ` +
      `fold a partial log (it would silently skew NAV). Fix or migrate them, then retry. ` +
      `Details also written to ${quarantineLogPath(logPath)}:\n${detail}`,
  );
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
 * Load genesis + the durable log, assert the log fully loaded, then fold to `asOf`
 * (or current state) for rendering. A pure READ: it does NOT ingest — the inbox is
 * never consulted and the durable log is never written (only `loadEventLog`'s
 * quarantine sidecar moves).
 */
export async function loadFoldedReview(
  paths: EventStorePaths,
  asOf?: string,
): Promise<FundReviewData> {
  const genesis = await loadGenesis(paths.genesis);
  const load = await loadEventLog(paths.log);
  assertLogFullyLoaded(load, paths.log);
  return foldEvents(genesis, load.events, asOf);
}

/**
 * Read a file that may not exist, mapping ENOENT to `undefined` and rethrowing every
 * other IO error. Exported: the TUI's ingest and migration paths read the inbox and
 * the log through the same helper, so this package owns the single definition.
 */
export async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
