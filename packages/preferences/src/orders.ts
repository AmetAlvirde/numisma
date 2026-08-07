/**
 * IO shell over the `orders.jsonl` sidecar — resolve-path, load, append.
 *
 * ADR-013 puts an `Order` BESIDE the append-only event log: a third durable artifact in
 * ADR-004's sidecar class, joined to the fold at read time and never merged into it.
 * ADR-001 bars file IO from `@numisma/engine`, so the pure half — the record contract
 * and the as-of selector — lives there and only the disk access lives here.
 *
 * This is a THIRD TENANT of a package whose name now names one member of the sidecar
 * class rather than the class. The name debt is recorded in ADR-004 and deliberately
 * not paid here; the practical gain is that a tenant inside this package inherits the
 * existing `@numisma/preferences` import guard for free.
 *
 *   data/orders.jsonl   append-only, one canonical OrderRecord JSON per line
 *
 * Durability contract:
 *   - The append is a GENUINE append via temp + rename (`appendOrders`), matching the
 *     event store's standard. A `appendFile` suffix-write is rejected for exactly the
 *     reason documented there, and the reason is not hypothetical: the plans-sidecar
 *     prototype took the suffix-only path and lost two records unattributably.
 *   - The loader is TOTAL (`loadOrders`): it returns an outcome instead of throwing,
 *     distinguishes UNREADABLE from ABSENT, and reports every skipped line rather than
 *     swallowing it.
 */
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import {
  parseOrderRecord,
  resolveDataDir,
  serializeOrderRecord,
  type OrderRecord,
  type OrderRecordProblem,
} from "@numisma/engine";

/**
 * Resolve the orders sidecar path. With no `dataDir` we resolve under the shared engine
 * `resolveDataDir` (the `NUMISMA_DATA_DIR` override or the absolute, homedir-derived
 * accumulus default) — NEVER a CWD-relative `./data/orders.jsonl`, which would write a
 * durable, git-tracked artifact into whatever directory the process happened to start
 * in. An explicit `dataDir` is honored verbatim for callers (e.g. tests) that pass one.
 */
export function resolveOrdersPath(dataDir = resolveDataDir()): string {
  return join(resolve(dataDir), "orders.jsonl");
}

/** One line the loader could not turn into a record, reported rather than swallowed. */
export interface OrderSkip {
  /** 1-based line number in the file, so the operator can go look at it. */
  line: number;
  problem: OrderRecordProblem;
  message: string;
}

/**
 * The loader's total outcome. `absent` and `unreadable` are SEPARATE cases and that
 * separation is the whole point: "there are no orders" and "I could not read the
 * orders" are opposite facts about committed capital, and collapsing them would let a
 * permissions error or a half-mounted data directory render as an unencumbered balance.
 * A file that exists and holds no records is `loaded` with an empty list — a third,
 * equally distinct truth.
 */
export type OrdersLoad =
  | { status: "loaded"; path: string; records: OrderRecord[]; skips: OrderSkip[] }
  | { status: "absent"; path: string }
  | { status: "unreadable"; path: string; message: string };

export interface LoadOrdersOptions {
  /** Where skip warnings go. Injectable so tests can observe them without a spy. */
  warn?: (message: string) => void;
}

function defaultWarn(message: string): void {
  console.warn(message);
}

/**
 * Read the sidecar into VALIDATED records, totally: no throw on any input.
 *
 * A missing file is `absent`; any other read failure is `unreadable` and carries the
 * reason. Blank lines are tolerated. A line that is not JSON, or is JSON of the wrong
 * shape, is skipped as `malformed`; a line whose `kind` this build does not know is
 * skipped as `unknown-kind` — NOT a global failure, because kinds are expected to be
 * added over time and an older reader meeting a newer kind is forward compatibility,
 * not corruption. Every skip is both WARNED and RETURNED, so a caller that wants to
 * refuse to render a committed figure over a partially-read file can.
 */
export async function loadOrders(path: string, options: LoadOrdersOptions = {}): Promise<OrdersLoad> {
  const warn = options.warn ?? defaultWarn;

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { status: "absent", path };
    }
    return {
      status: "unreadable",
      path,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const records: OrderRecord[] = [];
  const skips: OrderSkip[] = [];
  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      continue; // tolerate blank lines, including the file's trailing terminator
    }
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      const skip: OrderSkip = { line: lineNumber, problem: "malformed", message: "line is not JSON" };
      skips.push(skip);
      warn(`orders.jsonl:${lineNumber} skipped — ${skip.message}`);
      continue;
    }
    const parsed = parseOrderRecord(value);
    if (parsed.status === "ok") {
      records.push(parsed.record);
      continue;
    }
    skips.push({ line: lineNumber, problem: parsed.problem, message: parsed.message });
    warn(`orders.jsonl:${lineNumber} skipped — ${parsed.message}`);
  }

  return { status: "loaded", path, records, skips };
}

/**
 * Per-process counter behind the temp file's unique name. Combined with the pid it makes
 * the name unique across BOTH concurrency axes — two processes, and two overlapping
 * `await`s inside one — which a fixed `.tmp` sibling is unique across neither.
 */
let tempCounter = 0;

/**
 * A UNIQUE, same-directory temp sibling for one append.
 *
 * Same directory is the non-negotiable half: rename(2) is only atomic within a
 * filesystem, and atomicity is the sole reason this module writes through a temp at all.
 * Unique is the half a fixed `${path}.tmp` was missing — two concurrent appends shared
 * one temp name, so writer A's rename moved the file out from under writer B and B's
 * rename then failed ENOENT having already discarded its batch. The suffix stays `.tmp`
 * so accumulus's `/data/*.tmp` ignore rule still covers it.
 */
function tempPathFor(path: string): string {
  tempCounter += 1;
  return `${path}.${process.pid}.${tempCounter}.tmp`;
}

/**
 * Read a file that may not exist, mapping ENOENT to `undefined`.
 *
 * A DELIBERATE PRIVATE COPY OF `@numisma/event-store`'s `readOptional`, NOT DRIFT (#198).
 * Importing the canonical one would draw a permanent `@numisma/preferences ->
 * @numisma/event-store` edge — this package's only dependency today is `@numisma/engine`.
 * ADR-013 makes the sidecar's separation from the durable log load-bearing: an `Order` is
 * recorded BESIDE `events.jsonl`, `parseEvent` never sees one, and the module that writes
 * `orders.jsonl` has no business knowing the event store exists.
 *
 * The duplication is affordable because the helper carries ZERO POLICY — its entire
 * content is "ENOENT means absent", a rule of the filesystem rather than of either file
 * format. There is nothing here that can drift into disagreeing with the other copy.
 * #141 once required exactly one definition repo-wide; that criterion is retired, because
 * counting definitions was the wrong test for a policy-free adapter.
 */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** How long a waiter sleeps between attempts to take the append lock. */
const LOCK_RETRY_MS = 20;
/** How long a waiter keeps trying before it REFUSES rather than write over a peer. */
const LOCK_TIMEOUT_MS = 10_000;

function isEexist(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/**
 * Serialize the read-modify-write of the whole sidecar image, across processes.
 *
 * A unique temp name alone is NOT enough, and the difference is the whole point. The
 * append reads the existing image, adds to it and renames the result over the file — so
 * two overlapping appends can both read image `I`, and the second rename silently
 * DISCARDS the first one's batch. That is a lost record with no torn line, no error and
 * no trace: exactly the unattributable loss this module exists to prevent. The pair of
 * CLIs that write here (`orders:import`, `orders:cancel`) are separate processes, so an
 * in-process mutex would not see each other.
 *
 * `open(…, "wx")` is the primitive: an EXCLUSIVE create is atomic in the kernel, so the
 * winner is decided by the filesystem and not by our own read of it.
 *
 * A holder that dies without releasing leaves the lock behind, and a waiter then REFUSES
 * after `LOCK_TIMEOUT_MS` with the path to delete. That is deliberate: breaking a lock we
 * cannot prove is stale would reintroduce the very race, and a loud refusal an operator
 * clears by hand is cheaper than a batch that vanishes.
 */
async function withAppendLock<T>(path: string, write: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (!isEexist(error)) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `another writer holds ${lockPath} and did not release it within ` +
            `${LOCK_TIMEOUT_MS}ms; nothing was written. If no import or cancel is running, ` +
            `delete that file by hand.`,
        );
      }
      await delay(LOCK_RETRY_MS);
      continue;
    }
    try {
      await handle.close();
      return await write();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}

/**
 * Genuinely APPEND-ONLY writer: add records without touching prior lines, to the
 * repo's own standard (`apps/tui/src/event-store.ts`).
 *
 * Build the full next image, write it to a sibling temp file, then `rename` over the
 * sidecar. rename(2) within a directory is atomic, so a crash mid-write leaves the
 * prior file intact and a reader never sees a truncated final line. This is O(n) in the
 * existing file rather than an O(1) `appendFile`, and that is the deliberate price of
 * the crash-atomicity — the event store's own comment rejects `appendFile` "for exactly
 * this."
 *
 * The `prefix` is the other half, and the half the plans-sidecar prototype omitted: if
 * the existing file's last line lacks its terminator, a suffix write CONCATENATES the
 * new record onto that torn line and both are lost — unattributably, because neither
 * parses and neither is recoverable from the mangled result. Supplying the missing
 * newline REPAIRS the torn line instead of compounding it.
 */
export async function appendOrders(path: string, records: OrderRecord[]): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await withAppendLock(path, async () => {
    const lines = records.map((record) => serializeOrderRecord(record)).join("\n");
    const existing = await readOptional(path);
    const prefix = existing && existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    const next = `${existing ?? ""}${prefix}${lines}\n`;
    const tempPath = tempPathFor(path);
    await writeFile(tempPath, next, "utf8");
    await rename(tempPath, path);
  });
}
