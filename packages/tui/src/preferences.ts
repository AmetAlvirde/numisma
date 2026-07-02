/**
 * Access-surface half of the profit-split preferences seam: read/seed the
 * time-stamped, append-only preferences SIDECAR that is DECOUPLED from the event log
 * (ADR-001 keeps this file IO out of
 * `@numisma/engine`; the pure `pickPolicyAsOf` selector lives in the engine).
 *
 * The log folds standalone to the pure #90 book with ZERO preferences; this sidecar is
 * composed in only at read time. The split ratio is fund policy (not secret
 * transaction data), so this file MAY be committed — but `data/events.jsonl` is
 * git-ignored and must NEVER be committed.
 *
 *   data/preferences.jsonl   append-only, one ProfitPolicyEntry JSON per line
 *
 * Durability contract (R4/M5):
 *   - Writes are genuinely APPEND-ONLY (`appendPreference`) — a new policy line never
 *     destroys prior history. There is no whole-file overwrite on the reliable path.
 *   - The loader VALIDATES every line on read (`loadPreferences`): shape, a present &
 *     parseable `effectiveAt`, a split whose Reserve fraction lands in [0, 1], and a
 *     `splitBasis` in the enum. Malformed/garbage lines are QUARANTINED (dropped from
 *     the result) rather than thrown through or allowed to corrupt as-of replay; blank
 *     lines are tolerated.
 *   - Ordering contract: the loader preserves the file's append order; the pure engine
 *     selector `pickPolicyAsOf` owns as-of ordering (it sorts by `effectiveAt`, so a
 *     non-monotonic file replays deterministically).
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  defaultProfitPolicyEntry,
  type ProfitPolicyEntry,
  type SplitBasis,
} from "@numisma/engine";

export function resolvePreferencesPath(dataDir = "data"): string {
  return join(resolve(dataDir), "preferences.jsonl");
}

const SPLIT_BASES: readonly SplitBasis[] = ["highWaterMark", "perClose"];

function isSplitBasis(value: unknown): value is SplitBasis {
  return typeof value === "string" && (SPLIT_BASES as readonly string[]).includes(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Validate ONE untrusted sidecar value into a well-formed `ProfitPolicyEntry`, or
 * return `undefined` so the loader can quarantine the line. Rejects: a non-object;
 * a missing / non-string / unparseable `effectiveAt`; a `splitBasis` outside the
 * enum; a non-string `routingReserveId`; a non-finite/negative `reserveTargetPct`;
 * and any split whose parts are non-finite/negative or whose Reserve FRACTION
 * (reserve / (wealth + reserve)) does not land in [0, 1] (an invalid ratio).
 */
function validateProfitPolicyEntry(value: unknown): ProfitPolicyEntry | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const entry = value as Record<string, unknown>;

  const effectiveAt = entry.effectiveAt;
  if (typeof effectiveAt !== "string" || effectiveAt.trim() === "") {
    return undefined;
  }
  if (Number.isNaN(Date.parse(effectiveAt))) {
    return undefined;
  }

  if (!isSplitBasis(entry.splitBasis)) {
    return undefined;
  }

  if (typeof entry.routingReserveId !== "string" || entry.routingReserveId.trim() === "") {
    return undefined;
  }

  if (!isFiniteNonNegative(entry.reserveTargetPct)) {
    return undefined;
  }

  const split = entry.split;
  if (typeof split !== "object" || split === null) {
    return undefined;
  }
  const { wealth, reserve } = split as Record<string, unknown>;
  if (!isFiniteNonNegative(wealth) || !isFiniteNonNegative(reserve)) {
    return undefined;
  }
  const denominator = wealth + reserve;
  if (denominator <= 0) {
    return undefined;
  }
  const reserveFraction = reserve / denominator;
  if (reserveFraction < 0 || reserveFraction > 1) {
    return undefined;
  }

  return {
    effectiveAt,
    split: { wealth, reserve },
    splitBasis: entry.splitBasis,
    routingReserveId: entry.routingReserveId,
    reserveTargetPct: entry.reserveTargetPct,
  };
}

/**
 * Read the append-only sidecar into ordered, VALIDATED entries. A missing file = no
 * policy (`[]`). Blank lines are tolerated; a line that is not JSON, or is JSON of the
 * wrong shape / range, is QUARANTINED (skipped) so a single corrupt line can neither
 * throw through nor silently corrupt as-of replay. Append order is preserved.
 */
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
    if (!trimmed) {
      continue; // tolerate blank lines
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // quarantine: not valid JSON
    }
    const entry = validateProfitPolicyEntry(parsed);
    if (entry) {
      entries.push(entry);
    }
    // else quarantine: valid JSON but not a well-formed policy entry
  }
  return entries;
}

/**
 * Genuinely APPEND-ONLY writer: append exactly ONE `ProfitPolicyEntry` as a JSON line
 * without touching prior entries. This is the reliable write path — a new policy never
 * destroys history.
 */
export async function appendPreference(path: string, entry: ProfitPolicyEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Seed the sidecar with this fund's locked default policy if it holds no valid entry
 * yet. Uses the append-only writer so seeding, like every write, preserves history.
 */
export async function seedDefaultPreferences(
  path: string,
  effectiveAt: string,
  routingReserveId: string,
): Promise<ProfitPolicyEntry[]> {
  const existing = await loadPreferences(path);
  if (existing.length > 0) {
    return existing;
  }
  const seeded = defaultProfitPolicyEntry(effectiveAt, routingReserveId);
  await appendPreference(path, seeded);
  return [seeded];
}
