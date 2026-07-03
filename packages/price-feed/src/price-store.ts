/**
 * The disposable market-data plane's IO (ADR-005). One JSONL file per instrument
 * (`data/prices/<instrumentId>.jsonl`), one line per trading day, upsert-by-`asOf`
 * latest-wins. Disposable — no durability contract beyond git-ignore — but writes
 * are still atomic (temp+rename) so a crash mid-write cannot corrupt a price file.
 * The full-file rewrite per upsert is accepted at daily cadence; append-only /
 * compaction is a noted future concern gated on sub-daily fetching.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { priceStoreFileName, type Quote } from "@numisma/engine";
import { atomicWrite } from "./atomic-write.js";

/** Upsert one quote into its per-instrument store file, latest-wins by `asOf`. */
export async function upsertQuote(pricesDir: string, quote: Quote): Promise<void> {
  const file = join(pricesDir, priceStoreFileName(quote.instrumentId));
  const existing = await readQuotes(file);
  const merged = existing.filter((q) => q.asOf !== quote.asOf);
  merged.push(quote);
  merged.sort((a, b) => a.asOf.localeCompare(b.asOf));
  const body = `${merged.map((q) => JSON.stringify(q)).join("\n")}\n`;
  await atomicWrite(file, body);
}

async function readQuotes(file: string): Promise<Quote[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Quote);
}
