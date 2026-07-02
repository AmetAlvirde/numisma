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
 * Strict ISO calendar date (`YYYY-MM-DD`, no time component). The pure as-of selector
 * (`pickPolicyAsOf`) orders and filters entries by STRING comparison, so `effectiveAt`
 * must be lexicographically sortable-as-chronological. A `Date.parse`-able but
 * non-ISO stamp (`01/02/2026`, `Jan 2 2026`) or a date-time (`...T00:00:00Z`) would
 * sort wrong and silently select the wrong policy, so those are quarantined here.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate ONE untrusted sidecar value into a well-formed `ProfitPolicyEntry`, or
 * return `undefined` so the loader can quarantine the line. Rejects: a non-object;
 * an `effectiveAt` that is not a strict ISO `YYYY-MM-DD` calendar date; a `splitBasis`
 * outside the enum; a non-string `routingReserveId`; a `reserveTargetPct` that is not
 * a finite percentage in [0, 100]; and any split whose parts are non-finite/negative
 * or whose denominator (wealth + reserve) is not positive.
 */
function validateProfitPolicyEntry(value: unknown): ProfitPolicyEntry | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const entry = value as Record<string, unknown>;

  const effectiveAt = entry.effectiveAt;
  if (typeof effectiveAt !== "string" || !ISO_DATE.test(effectiveAt) || Number.isNaN(Date.parse(effectiveAt))) {
    return undefined;
  }

  if (!isSplitBasis(entry.splitBasis)) {
    return undefined;
  }

  if (typeof entry.routingReserveId !== "string" || entry.routingReserveId.trim() === "") {
    return undefined;
  }

  // A NAV-share target is a percentage: finite and in [0, 100]. An absurd 150%/500%
  // target would otherwise flow verbatim into the "vs X% target" dashboard line.
  if (!isFiniteNonNegative(entry.reserveTargetPct) || entry.reserveTargetPct > 100) {
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
  // denominator > 0 with both parts non-negative already forces the Reserve fraction
  // reserve / (wealth + reserve) into [0, 1]; the positive-denominator check is the
  // only ratio guard needed (a zero split like 0/0 is the degenerate case rejected).
  if (wealth + reserve <= 0) {
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
