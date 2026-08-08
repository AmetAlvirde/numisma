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
 *   - There is NO public write surface: `seedDefaultPreferences` is the only writer, and
 *     its one-line append is inline (audit finding 34 deleted the exported, caller-less
 *     `appendPreference` rather than hardening it). The seed is genuinely APPEND-ONLY —
 *     no whole-file overwrite, so prior bytes survive even when every line is quarantined.
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
  resolveDataDir,
  type ProfitPolicyEntry,
  type SplitBasis,
} from "@numisma/engine";

/**
 * Resolve the preferences sidecar path. With no `dataDir` we resolve under the shared
 * engine `resolveDataDir` (the `NUMISMA_DATA_DIR` override or the absolute, homedir-derived
 * accumulus default) — NEVER a CWD-relative `./data/preferences.jsonl` (R-M3). The read
 * path is ALREADY WIRED — `apps/web/src/push/push-core.ts` calls
 * `loadPreferences(resolvePreferencesPath())` live, via `loadReserveFloorAsOf` →
 * `buildGlanceForAnchor` — so the split-brain hazard this resolver prevents is live, not
 * hypothetical: a CWD-relative read here would silently serve the phone a Reserve floor
 * from a different file than the one the fund appends to (ADR-004). An explicit `dataDir`
 * is still honored verbatim for callers (e.g. tests) that pass one.
 */
export function resolvePreferencesPath(dataDir = resolveDataDir()): string {
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
 * Seed a NEW sidecar with this fund's locked default policy if it holds no valid entry
 * yet. The one-line append is INLINE here on purpose: this package exposes no general
 * write surface (audit finding 34). A public `appendPreference` was exported, documented
 * and tested with no caller outside this seeder, carrying a weaker durability contract than
 * `appendOrders` — a plain `appendFile` with no lock and no torn-line handling, the shape
 * that has concretely lost records before. Rather than harden a writer nothing used, the
 * write surface was DELETED. Any future caller that genuinely needs to write a policy
 * (a `preferences:set` CLI) must add its entry point deliberately, on the
 * lock + temp + rename contract of `orders.ts`, instead of inheriting the rejected shape.
 *
 * Seeding still preserves history: it appends rather than rewriting, so the one file it
 * can meet non-empty — every line quarantined by the loader — keeps its bytes for repair.
 *
 * This is a SEED FOR A NEW SIDECAR, and it is NOT a read-gap fallback — the distinction
 * is load-bearing. It writes `defaultProfitPolicyEntry`, whose `reserveTargetPct` is
 * `10`, so a reader that reached for it on a MISSING or QUARANTINED policy would render
 * a `10%` floor the user never set. That is exactly what V2/R1 forbid. On a read gap the
 * correct behavior is the opposite of this function: `pickPolicyAsOf` returns
 * `undefined`, `reserveTargetPct` is ABSENT from the payload, and the Reserve number
 * suppresses. Call this only to initialize a sidecar that does not exist yet.
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
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(seeded)}\n`, "utf8");
  return [seeded];
}
