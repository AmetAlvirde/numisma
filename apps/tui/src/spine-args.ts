/**
 * The spine's argv/env OPERATOR KNOBS — the `--as-of` fold window and the opt-in
 * magnitude-guard override. Pure string→value parsing: no filesystem, no durable
 * log, no engine. ADR-001 keeps these knobs out of `@numisma/engine`; they lived in
 * `event-store.ts` until audit finding 35 pointed out that the module owning the
 * append path had no business also owning CLI flag parsing. The entry points
 * (`spine.ts`, `startup.ts`, `report.ts`) import them from here; `event-store.ts`
 * keeps its durable-log responsibilities only.
 *
 * Behavior is byte-identical to the pre-extraction functions, messages included —
 * these flags are an operator's contract, and a reworded failure is a changed
 * contract.
 */

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

/** The env var that raises the ingest magnitude guard for a single conscious run. */
export const SPINE_MAGNITUDE_THRESHOLD_ENV = "SPINE_MAGNITUDE_THRESHOLD";

/**
 * Parse the OPT-IN magnitude-guard override for a single `pnpm spine` run, from
 * either the `--magnitude-threshold=<n>` / `--magnitude-threshold <n>` CLI flag or
 * the `SPINE_MAGNITUDE_THRESHOLD` env var (the flag wins when both are set).
 * Returns `undefined` when NEITHER is set — the overwhelmingly common case — so the
 * engine keeps its own ±50% default and the run is byte-for-byte a normal run.
 *
 * Deliberately conspicuous, never a routine dial: this widens the fat-finger guard,
 * so a present-but-malformed value (non-numeric, non-finite, or ≤ 0 — a value that
 * cannot be a real relative deviation) FAILS LOUD rather than silently falling back
 * to the default. `0.75` means ±75% from the instrument's last close; the operator
 * raises it only to land a mark they have confirmed reflects a genuine big move.
 */
export function parseMagnitudeThresholdArg(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): number | undefined {
  const raw = magnitudeThresholdSource(args, env);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw.value);
  if (raw.value.trim() === "" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Invalid magnitude-threshold override from ${raw.origin}: '${raw.value}'. ` +
        `Expected a positive number (a relative deviation, e.g. 1.5 for ±150%).`,
    );
  }
  return value;
}

/** The override's raw string and where it came from, flag taking precedence. */
function magnitudeThresholdSource(
  args: string[],
  env: Record<string, string | undefined>,
): { value: string; origin: string } | undefined {
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--magnitude-threshold") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("Missing value for --magnitude-threshold (expected a positive number).");
      }
      return { value, origin: "--magnitude-threshold" };
    }
    if (arg?.startsWith("--magnitude-threshold=")) {
      return { value: arg.slice("--magnitude-threshold=".length), origin: "--magnitude-threshold" };
    }
  }
  const fromEnv = env[SPINE_MAGNITUDE_THRESHOLD_ENV];
  if (fromEnv !== undefined) {
    return { value: fromEnv, origin: SPINE_MAGNITUDE_THRESHOLD_ENV };
  }
  return undefined;
}
