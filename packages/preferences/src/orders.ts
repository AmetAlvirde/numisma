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
import { readFile } from "node:fs/promises";
import {
  parseOrderRecord,
  serializeOrderRecord,
  type OrderRecord,
  type OrderRecordProblem,
} from "@numisma/engine";
import { appendSidecarLines, resolveSidecarPath } from "./sidecar-io.js";

/**
 * Resolve the orders sidecar path. With no `dataDir` we resolve under the shared engine
 * `resolveDataDir` (the `NUMISMA_DATA_DIR` override or the absolute, homedir-derived
 * accumulus default) — NEVER a CWD-relative `./data/orders.jsonl`, which would write a
 * durable, git-tracked artifact into whatever directory the process happened to start
 * in. An explicit `dataDir` is honored verbatim for callers (e.g. tests) that pass one.
 */
export function resolveOrdersPath(dataDir?: string): string {
  return resolveSidecarPath("orders.jsonl", dataDir);
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
 * Genuinely APPEND-ONLY writer: add records without touching prior lines.
 *
 * The mechanics — the cross-process lock, the unique same-directory temp sibling,
 * the torn-terminator repair and the atomic rename — live in `./sidecar-io.ts`,
 * shared with the plans sidecar, which needs byte-identical durability for the same
 * reason. What stays here is the only part that is about ORDERS: the canonical
 * serialization of a record.
 */
export async function appendOrders(path: string, records: OrderRecord[]): Promise<void> {
  await appendSidecarLines(path, records.map((record) => serializeOrderRecord(record)));
}
