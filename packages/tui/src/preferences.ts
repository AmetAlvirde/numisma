/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). Access-surface half of the
 * profit-split preferences seam: read/seed the time-stamped, append-only preferences
 * SIDECAR that is DECOUPLED from the event log (ADR-001 keeps this file IO out of
 * `@numisma/engine`; the pure `pickPolicyAsOf` selector lives in the engine).
 *
 * The log folds standalone to the pure #90 book with ZERO preferences; this sidecar is
 * composed in only at read time. The split ratio is fund policy (not secret
 * transaction data), so this file MAY be committed — but `data/events.jsonl` is
 * git-ignored and must NEVER be committed.
 *
 *   data/preferences.jsonl   append-only, one ProfitPolicyEntry JSON per line
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { defaultProfitPolicyEntry, type ProfitPolicyEntry } from "@numisma/engine";

export function resolvePreferencesPath(dataDir = "data"): string {
  return join(resolve(dataDir), "preferences.jsonl");
}

/** Read the append-only sidecar into ordered entries. A missing file = no policy. */
export async function loadPreferences(path: string): Promise<ProfitPolicyEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const entries: ProfitPolicyEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      entries.push(JSON.parse(trimmed) as ProfitPolicyEntry);
    }
  }
  return entries;
}

/** Overwrite the sidecar with `entries` (one JSON per line). Prototype helper. */
export async function writePreferences(path: string, entries: ProfitPolicyEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

/** Seed the sidecar with this fund's locked default policy if it is empty/absent. */
export async function seedDefaultPreferences(
  path: string,
  effectiveAt: string,
  routingReserveId: string,
): Promise<ProfitPolicyEntry[]> {
  const existing = await loadPreferences(path);
  if (existing.length > 0) {
    return existing;
  }
  const seeded = [defaultProfitPolicyEntry(effectiveAt, routingReserveId)];
  await writePreferences(path, seeded);
  return seeded;
}
