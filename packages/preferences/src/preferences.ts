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
 *     `splitBasis` in the enum. A malformed/garbage line is discarded rather than thrown
 *     through or allowed to corrupt as-of replay — and the discard is REPORTED, not
 *     swallowed: `loadPreferences` returns a `LoadedPreferences` envelope carrying the
 *     load outcome, the accepted entries, and one addressable `skipped` record per
 *     discarded line. Blank lines are tolerated and are not discards. The loader is
 *     TOTAL: an unreadable file is a `load-failed` outcome, never a thrown error.
 *   - Ordering contract: the loader preserves the file's append order; the pure engine
 *     selector `pickPolicyAsOf` owns as-of ordering (it sorts by `effectiveAt`, so a
 *     non-monotonic file replays deterministically).
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  defaultProfitPolicyEntry,
  isIsoCalendarDate,
  resolveDataDir,
  type LoadedPreferences,
  type PreferenceSkipReason,
  type ProfitPolicyEntry,
  type SkippedPreferenceLine,
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
 *
 * A blank or whitespace-only `dataDir` is REFUSED (#348), and the refusal is the reason
 * this is written as an explicit `undefined` check rather than as a default PARAMETER.
 * A JS default parameter fires on `undefined` and on nothing else, so `""` used to sail
 * straight past it into `resolve("")` — which is the process's CWD, the one arm ADR-006
 * exists to forbid. The phone's Reserve floor would then be read from
 * `<wherever-the-job-started>/preferences.jsonl`, a file nobody writes, and the answer
 * would be a plausible wrong number rather than an error. `undefined` still means nobody
 * configured this and still takes the default; `""` means somebody configured it and got
 * the expansion wrong, and that is not something this resolver may guess at.
 */
export function resolvePreferencesPath(dataDir?: string): string {
  if (dataDir !== undefined && dataDir.trim() === "") {
    throw new Error(
      `a preferences data directory must not be empty (got "${dataDir}"). ` +
        `An empty value is not "unset": resolving it would land on the process's ` +
        `working directory, serving a Reserve floor from a file nothing writes. ` +
        `Pass no data directory at all to use the default deliberately, or pass an ` +
        `absolute path.`,
    );
  }
  return join(resolve(dataDir ?? resolveDataDir()), "preferences.jsonl");
}

const SPLIT_BASES: readonly SplitBasis[] = ["highWaterMark", "perClose"];

function isSplitBasis(value: unknown): value is SplitBasis {
  return typeof value === "string" && (SPLIT_BASES as readonly string[]).includes(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * The validator's answer: the entry it accepted, or the CLOSED-vocabulary reason the
 * line was rejected. A discriminated result rather than `ProfitPolicyEntry | undefined`
 * because `undefined` erases WHICH of the eight guards fired, and the Discard Channel's
 * whole point is that a discard is a value the caller receives.
 */
type ValidatedEntry =
  | { ok: true; entry: ProfitPolicyEntry }
  | { ok: false; reason: Exclude<PreferenceSkipReason, "not-json"> };

/**
 * Fixed prose for each rejection reason — the operator-facing half of a discard.
 *
 * PROSE-ONLY, and never built by interpolating the rejected line: a diagnostic that
 * echoes file content launders it into terminals, log files and CI output. The `line`
 * number is the addressability; this is the category in words.
 */
const SKIP_DETAIL: Record<PreferenceSkipReason, string> = {
  "not-json": "line is not JSON",
  "not-an-object": "line is JSON but not an object",
  "effective-at": "effectiveAt is not a strict ISO YYYY-MM-DD calendar date",
  "split-basis": "splitBasis is not one of the supported bases",
  "routing-reserve-id": "routingReserveId is missing, blank, or not a string",
  "reserve-target-pct": "reserveTargetPct is not a finite percentage in [0, 100]",
  "split-shape": "split is missing or not an object",
  "split-parts": "a split part is not a finite, non-negative number",
  "split-denominator": "split denominator (wealth + reserve) is not positive",
};

/**
 * Validate ONE untrusted sidecar value into a well-formed `ProfitPolicyEntry`, or
 * return the reason the loader must record. Rejects: a non-object; an `effectiveAt`
 * that is not a strict ISO `YYYY-MM-DD` calendar date; a `splitBasis` outside the enum;
 * a non-string `routingReserveId`; a `reserveTargetPct` that is not a finite percentage
 * in [0, 100]; and any split whose parts are non-finite/negative or whose denominator
 * (wealth + reserve) is not positive.
 *
 * The SET OF ACCEPTED VALUES IS EXACTLY WHAT IT WAS before this function started
 * naming its reasons — the shape changed, the verdict did not. Every guard below is
 * byte-for-byte the predicate it was; only the `return` grew a reason. The
 * accept/reject parity test in `preferences-reliable.test.ts` is what makes that
 * checkable rather than promised, so a future edit that tightens or loosens a guard
 * here has to argue with a test rather than slip past a docstring.
 */
function validateProfitPolicyEntry(value: unknown): ValidatedEntry {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "not-an-object" };
  }
  const entry = value as Record<string, unknown>;

  // STRICT ISO CALENDAR DATE — shape AND round trip, ADR-004's second amendment.
  //
  // `pickPolicyAsOf` orders and filters these by STRING comparison, so `effectiveAt`
  // must be lexicographically sortable-as-chronological. Shape alone rejects the
  // obvious offenders (`01/02/2026`, `Jan 2 2026`, `...T00:00:00Z`), each of which
  // would sort wrong and silently select the wrong policy.
  //
  // Shape is only half the rule, and this loader used to ship only that half: shape
  // plus `Date.parse`, which SUCCEEDS on `"2026-02-30"` by rolling it over to March 2.
  // The accepted string then sorts as February and means March — the very defect the
  // check exists to prevent, arriving through the check meant to prevent it. On the
  // live path (`push-core.ts` → `loadReserveFloorAsOf` → `buildGlanceForAnchor`) that
  // is a new policy in force a month early, silently. `isIsoCalendarDate` re-renders
  // the parsed date and compares it back, which rejects the overflow and leaves a
  // legitimate `"2026-01-31"` alone. The amendment cited this file as the precedent
  // for the class; it is applied here now rather than only claimed.
  if (!isIsoCalendarDate(entry.effectiveAt)) {
    return { ok: false, reason: "effective-at" };
  }
  const effectiveAt = entry.effectiveAt;

  if (!isSplitBasis(entry.splitBasis)) {
    return { ok: false, reason: "split-basis" };
  }

  if (typeof entry.routingReserveId !== "string" || entry.routingReserveId.trim() === "") {
    return { ok: false, reason: "routing-reserve-id" };
  }

  // A NAV-share target is a percentage: finite and in [0, 100]. An absurd 150%/500%
  // target would otherwise flow verbatim into the "vs X% target" dashboard line.
  if (!isFiniteNonNegative(entry.reserveTargetPct) || entry.reserveTargetPct > 100) {
    return { ok: false, reason: "reserve-target-pct" };
  }

  const split = entry.split;
  if (typeof split !== "object" || split === null) {
    return { ok: false, reason: "split-shape" };
  }
  const { wealth, reserve } = split as Record<string, unknown>;
  if (!isFiniteNonNegative(wealth) || !isFiniteNonNegative(reserve)) {
    return { ok: false, reason: "split-parts" };
  }
  // denominator > 0 with both parts non-negative already forces the Reserve fraction
  // reserve / (wealth + reserve) into [0, 1]; the positive-denominator check is the
  // only ratio guard needed (a zero split like 0/0 is the degenerate case rejected).
  if (wealth + reserve <= 0) {
    return { ok: false, reason: "split-denominator" };
  }

  return {
    ok: true,
    entry: {
      effectiveAt,
      split: { wealth, reserve },
      splitBasis: entry.splitBasis,
      routingReserveId: entry.routingReserveId,
      reserveTargetPct: entry.reserveTargetPct,
    },
  };
}

/**
 * Read the append-only sidecar into ordered, VALIDATED entries AND the report of every
 * line it had to discard — the Discard Channel: the discard is not a side effect and
 * never nothing at all, it is a value the caller receives whether or not it looks.
 *
 * TOTAL — it does not throw. Discarding is a normal outcome of reading untrusted input:
 *
 *   - **The file is absent (`ENOENT`) → `loaded`, empty buckets.** The NORMAL STARTING
 *     STATE for a fund that has not set a policy yet, not a failure.
 *   - **Any other read error → `load-failed`, empty buckets.** This REPLACES the rethrow
 *     this loader used to do, and the distinction it buys is load-bearing: empty
 *     `entries` alone would assert "this fund has no policy" when the truth is "the
 *     policy file could not be read", and downstream that difference is a Reserve floor
 *     suppressed on the phone for a reason nobody can see. `message` is the errno CODE
 *     and never Node's own message — see {@link readFailureCode}.
 *   - **A bad line → one `skipped` record, and the read continues.** One 1-based line
 *     number, one closed-vocabulary reason, fixed prose that never quotes the line.
 *
 * Blank (and whitespace-only) lines are the one DELIBERATE drop and produce no record —
 * a trailing newline is not something an operator did wrong. Append order is preserved
 * in `entries`; `pickPolicyAsOf` owns as-of ordering.
 */
/**
 * A read failure rendered as a CLOSED-VOCABULARY token: the errno code (`EACCES`,
 * `EISDIR`, `EMFILE`), or the error's class when it carries none.
 *
 * NEVER `error.message`. Node's fs errors interpolate the ABSOLUTE PATH they failed on
 * — `EACCES: permission denied, open '/Users/<user>/…/preferences.jsonl'` — and this
 * string is PROSE: {@link unattendedPreferencesVerdict} prints it to stderr, and from
 * there into log files and CI output. {@link SIDECAR_NAME} withholds the path
 * deliberately (a full path names the operator's home directory and their data store's
 * location), so a raw errno message would launder it back in through the one branch
 * that reports a failure. Sanitizing HERE rather than at the verdict makes the
 * invariant structural: no consumer of the envelope can reintroduce the leak.
 *
 * Same spirit as {@link PreferenceSkipReason} — the diagnostic names a category, never
 * the payload. The code is the whole diagnostic value anyway: `EACCES` says fix the
 * permissions, `EMFILE` says something is leaking descriptors.
 */
function readFailureCode(error: unknown): string {
  if (error instanceof Error) {
    const { code } = error as NodeJS.ErrnoException;
    return typeof code === "string" && code.length > 0 ? code : error.constructor.name;
  }
  return "unknown-read-error";
}

export async function loadPreferences(path: string): Promise<LoadedPreferences> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { load: { status: "loaded", sourcePath: path }, entries: [], skipped: [] };
    }
    return {
      load: {
        status: "load-failed",
        sourcePath: path,
        message: readFailureCode(error),
      },
      entries: [],
      skipped: [],
    };
  }
  const entries: ProfitPolicyEntry[] = [];
  const skipped: SkippedPreferenceLine[] = [];
  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1; // 1-BASED, so the operator can go look at it
    const trimmed = (lines[index] ?? "").trim();
    if (!trimmed) {
      continue; // tolerate blank lines — the one deliberate drop, and not a discard
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      skipped.push({ line: lineNumber, reason: "not-json", detail: SKIP_DETAIL["not-json"] });
      continue;
    }
    const validated = validateProfitPolicyEntry(parsed);
    if (validated.ok) {
      entries.push(validated.entry);
    } else {
      skipped.push({
        line: lineNumber,
        reason: validated.reason,
        detail: SKIP_DETAIL[validated.reason],
      });
    }
  }
  return { load: { status: "loaded", sourcePath: path }, entries, skipped };
}

/** What an unattended caller must do about a preferences load. */
export interface UnattendedPreferencesVerdict {
  /** `0` iff the file was read AND every line in it was readable. */
  exitCode: 0 | 1;
  /** Prose-only lines to print loudly. Never quotes the file. */
  messages: string[];
}

/** The file's own name, as the diagnostic addresses it. Never a full path. */
const SIDECAR_NAME = "preferences.jsonl";

/**
 * The UNATTENDED-CALLER POLICY over a preferences load, as a value a test can assert
 * instead of a convention a reviewer must notice — the Discard Channel's fourth
 * clause (spec #320 §4): the discarding component never picks the consequence.
 * `loadPreferences` reports; this decides; and per the fifth clause the decision may
 * never be to withhold the push.
 *
 * DELIBERATELY THE SAME SHAPE AS {@link unattendedPlansVerdict}, down to the message
 * grammar, and for the same warrant — recorded in that function's docstring and
 * governing here: *a launchd job's stderr goes to an unread log, so a "loud warning"
 * reaches no one.* An exit code is a checked value; a warning is a thing someone must
 * happen to read. The two are separate functions rather than one generic because the
 * sidecars' skip records are different types and a shared one would have to erase
 * them; three compliant implementations of a stated contract is the goal (§10).
 *
 * A MISSING FILE IS ZERO. `loadPreferences` renders `ENOENT` as `loaded` with empty
 * buckets, which is the normal starting state of a fund that has not set a policy —
 * not an anomaly, and marking the run for it would train the operator to ignore the
 * mark. `load-failed` is the opposite: the file exists and could not be read, which
 * suppresses the Reserve slot for a reason nobody can see unless this says so.
 *
 * EXIT CODE AND MESSAGES ARE COMPUTED INDEPENDENTLY AND RETURNED SEPARATELY, and that
 * is a seam rather than a style: this run's operator channel is shared with other
 * diagnostic kinds whose exit policies differ (a fold locator's verdict is prose-only
 * and exits zero, by its own ruling). A caller composes the prose of every kind into
 * one channel and the exit codes of every kind into one code, which it can only do if
 * nothing here fuses them.
 */
export function unattendedPreferencesVerdict(
  loaded: LoadedPreferences,
): UnattendedPreferencesVerdict {
  const messages: string[] = [];
  if (loaded.load.status === "load-failed") {
    messages.push(`${SIDECAR_NAME} could not be read: ${loaded.load.message}`);
  }
  for (const skip of loaded.skipped) {
    // The 1-based line is the addressability and `detail` is the fixed prose the
    // loader already chose; NOTHING from the line itself is interpolated. Read
    // `skip.detail` rather than re-deriving it from `reason` — one table, one owner.
    messages.push(
      `${SIDECAR_NAME} line ${skip.line} skipped (${skip.reason}): ${skip.detail}`,
    );
  }
  return { exitCode: messages.length === 0 ? 0 : 1, messages };
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
 * can meet non-empty — every line discarded by the loader — keeps its bytes for repair.
 * That state is now VISIBLE rather than inferred: the same load whose `entries` are
 * empty carries a `skipped` record per discarded line, so "no policy yet" and "a policy
 * file every line of which was rejected" are distinguishable at the call site. This
 * seeder deliberately does not act on THAT distinction — a quarantined file is still a
 * file this writer read, and it appends. It is a writer, not a reporting surface, and
 * its own return stays `ProfitPolicyEntry[]`.
 *
 * IT DOES ACT ON THE `load` OUTCOME, AND MUST. Making the loader total (slice 1)
 * silently converted a non-`ENOENT` read error from "propagate, write nothing" into
 * "empty `entries`, so seed" — and empty entries from a FAILED READ are not the same
 * fact as empty entries from an empty file. Under EMFILE, EACCES or a transient EIO
 * over a sidecar holding the fund's real policy, seeding would append the default 10%
 * floor with today's `effectiveAt`, and `pickPolicyAsOf` would serve it from that date
 * forward: the invented read-gap floor the paragraph below forbids, arriving through
 * the writer instead of the reader. So a `load-failed` outcome THROWS here, restoring
 * the pre-total-loader refusal. Reporting is the unattended verdict's job; this
 * function's only safe move on a read gap is to touch nothing.
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
  if (existing.load.status === "load-failed") {
    // `message` is the errno code, never a path — see `readFailureCode`.
    throw new Error(
      `${SIDECAR_NAME} could not be read (${existing.load.message}); refusing to seed a ` +
        `default policy over a file whose contents are unknown.`,
    );
  }
  if (existing.entries.length > 0) {
    return existing.entries;
  }
  const seeded = defaultProfitPolicyEntry(effectiveAt, routingReserveId);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(seeded)}\n`, "utf8");
  return [seeded];
}
