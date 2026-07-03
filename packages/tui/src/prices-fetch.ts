/**
 * prices:fetch — MVI PROTOTYPE (crypto-only vertical tracer).
 *
 * Level 2 price fetch, crypto plane only. For the four crypto instruments it
 * fetches the latest daily close from Binance's public REST API (keyless),
 * upserts each quote into the disposable price store (data/prices/<id>.jsonl),
 * and emits daily PriceMarked candidates into the inbox
 * (data/inbox/transactions.json) for the existing `pnpm spine` ingest path to
 * validate and append.
 *
 * PROTOTYPE — not reliable-converted. Visible shortcuts documented in
 * ~/Dev/tmp/mvi-numisma-2026-07-03-price-fetch-prototype.md
 *
 * Two-plane invariant (grill / forthcoming ADR): EVERY run upserts the price
 * store; marks are emitted at the daily mark cadence. The fetcher never writes
 * the event log — it only drops candidates in the inbox, and `pnpm spine` does
 * the validated, guarded append. Sub-daily fetches would only grow the price
 * store; the log keeps receiving the daily marks.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveEventStorePaths } from "./event-store.js";

// --- prototype symbol map (crypto only; const-in-script shortcut) -------------
// instrumentId (genesis id) -> Binance spot symbol. All quote in USDT ~= USD.
// GRAM = ex-TON; GRAMUSDT and RENDERUSDT verified live on Binance 2026-07-03.
const SYMBOL_MAP: readonly { instrumentId: string; symbol: string }[] = [
  { instrumentId: "btc", symbol: "BTCUSDT" },
  { instrumentId: "eth", symbol: "ETHUSDT" },
  { instrumentId: "render", symbol: "RENDERUSDT" },
  { instrumentId: "gram", symbol: "GRAMUSDT" },
];

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";

interface Quote {
  instrumentId: string;
  symbol: string;
  asOf: string; // YYYY-MM-DD, derived from the candle open time (UTC)
  price: number; // daily close
  source: "binance";
  fetchedAt: string; // ISO instant of this fetch
}

function utcDate(msEpoch: number): string {
  return new Date(msEpoch).toISOString().slice(0, 10);
}

async function fetchDailyClose(entry: {
  instrumentId: string;
  symbol: string;
}): Promise<Quote> {
  const url = `${BINANCE_KLINES}?symbol=${entry.symbol}&interval=1d&limit=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance ${entry.symbol} -> HTTP ${res.status} ${res.statusText}`);
  }
  const rows = (await res.json()) as unknown;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!Array.isArray(row)) {
    throw new Error(`Binance ${entry.symbol} -> unexpected payload shape`);
  }
  // Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...]
  const openTime = Number(row[0]);
  const close = Number(row[4]);
  if (!Number.isFinite(close) || close <= 0) {
    throw new Error(`Binance ${entry.symbol} -> non-positive close ${String(row[4])}`);
  }
  return {
    instrumentId: entry.instrumentId,
    symbol: entry.symbol,
    asOf: utcDate(openTime),
    price: close,
    source: "binance",
    fetchedAt: new Date().toISOString(),
  };
}

// --- price store (disposable market-data plane) -------------------------------
async function upsertQuote(pricesDir: string, quote: Quote): Promise<void> {
  const file = join(pricesDir, `${quote.instrumentId}.jsonl`);
  let existing: Quote[] = [];
  try {
    const raw = await readFile(file, "utf8");
    existing = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Quote);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // upsert by asOf: the latest fetch for a given day wins.
  const merged = existing.filter((q) => q.asOf !== quote.asOf);
  merged.push(quote);
  merged.sort((a, b) => a.asOf.localeCompare(b.asOf));
  await writeFile(file, merged.map((q) => JSON.stringify(q)).join("\n") + "\n", "utf8");
}

// --- inbox emit (candidate marks; the ingest path owns the log) ---------------
interface PriceMarkedCandidate {
  id: string;
  asOf: string;
  type: "PriceMarked";
  instrumentId: string;
  price: number;
}

function toMark(quote: Quote): PriceMarkedCandidate {
  return {
    // deterministic id => a doubled run is a no-op (ingest dedups by id).
    id: `pm-${quote.instrumentId}-${quote.asOf}`,
    asOf: quote.asOf,
    type: "PriceMarked",
    instrumentId: quote.instrumentId,
    price: quote.price,
  };
}

async function emitToInbox(
  inboxPath: string,
  marks: PriceMarkedCandidate[],
): Promise<number> {
  let existing: PriceMarkedCandidate[] = [];
  try {
    const raw = await readFile(inboxPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Inbox ${inboxPath} must be a JSON array of transactions.`);
    }
    existing = parsed as PriceMarkedCandidate[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // Merge, never clobber: keep any pending (e.g. hand-authored) inbox events,
  // and skip our own marks that are already queued (same id).
  const seen = new Set(existing.map((event) => event.id));
  const fresh = marks.filter((mark) => !seen.has(mark.id));
  const next = [...existing, ...fresh];
  await mkdir(dirname(inboxPath), { recursive: true });
  await writeFile(inboxPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return fresh.length;
}

// --- main ---------------------------------------------------------------------
async function main(): Promise<void> {
  const paths = resolveEventStorePaths();
  const pricesDir = resolve("data", "prices");
  await mkdir(pricesDir, { recursive: true });

  const quotes: Quote[] = [];
  const failures: string[] = [];

  // Fetch sequentially: 4 calls sit far under Binance's rate budget, and a bad
  // symbol stays individually attributable instead of masking the others.
  for (const entry of SYMBOL_MAP) {
    try {
      const quote = await fetchDailyClose(entry);
      await upsertQuote(pricesDir, quote);
      quotes.push(quote);
      console.log(
        `  fetched ${entry.instrumentId.padEnd(7)} ${entry.symbol.padEnd(11)} ${quote.asOf}  ${quote.price}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(message);
      // Surface, do not swallow (grill risk: rejections must be visible).
      console.error(
        `  FAILED  ${entry.instrumentId.padEnd(7)} ${entry.symbol.padEnd(11)} ${message}`,
      );
    }
  }

  const marks = quotes.map(toMark);
  const emitted = await emitToInbox(paths.inbox, marks);

  console.log("");
  console.log(
    `prices:fetch — ${quotes.length}/${SYMBOL_MAP.length} quotes stored in ${pricesDir}`,
  );
  console.log(`  ${emitted} new PriceMarked candidate(s) written to ${paths.inbox}`);
  console.log(`  ${marks.length - emitted} already pending (same id) — skipped`);
  if (failures.length > 0) {
    console.log(`  ${failures.length} fetch failure(s) surfaced above (not swallowed).`);
  }
  console.log("");
  console.log("Next: run `pnpm spine` to validate + append the marks to the event log.");

  // Non-zero exit so a scheduler notices failures — but only AFTER storing and
  // emitting everything that DID succeed (partial progress is always kept).
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});
