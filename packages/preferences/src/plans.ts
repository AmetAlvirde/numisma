/**
 * PROTOTYPE (`prototype/plans-sidecar`) — the IO half of the DCA plan sidecar.
 * Implements `S1`–`S7` of the sidecar-door grill (2026-07-28). Specimen code: per
 * the standing prototype rule it does NOT merge; the real increment reuses whatever
 * `audit` clears.
 *
 * This is `S3`'s Door B: a SECOND sidecar, `plans.jsonl`, hosted INSIDE
 * `@numisma/preferences` rather than in a new package — so it inherits
 * `preferences-import-guard.test.ts` and owes no additional guard for the package
 * boundary. Door A (discriminating `preferences.jsonl` with a `kind` union) was
 * rejected and is not to be revisited: one fund-wide policy vs many per-position
 * plans is a cardinality mismatch, it would edit the live phone-facing reader the
 * Reserve floor rests on, and its cost would SURVIVE the DCA feature's removal
 * (absent-`kind` ≡ `profitPolicy` stays pinned forever in an append-only file).
 *
 *   data/plans.jsonl   append-only, one plan record JSON per line
 *
 * A plan is DESCRIPTIVE-ONLY: it is never folded and never touches NAV. The log
 * folds standalone to the pure book with zero plans; this sidecar is composed in at
 * read time only, exactly as `preferences.jsonl` is.
 *
 * WHAT DIVERGES FROM `preferences.ts`, deliberately: `loadPreferences` quarantines a
 * bad line SILENTLY. This loader must not (`S6`). Silent dropping is already ruled a
 * defect in this repo by name (finding M1), and a plan sidecar has a forward-compat
 * cliff `preferences.jsonl` does not — new `kind`s arrive over time, so an old
 * checkout WILL meet newer data. That is structurally the same cliff that scheduled
 * the #153 outage. `loadPlans` therefore RETURNS its skips, split by cause.
 *
 * Durability contract (mirroring R4/M5):
 *   - Writes are genuinely APPEND-ONLY (`appendPlan`) — superseding a plan never
 *     destroys the prior one, which is what makes as-of replay honest.
 *   - The loader VALIDATES every line on read, ENVELOPE FIRST (see `loadPlans`).
 *   - Ordering contract: the loader preserves the file's append order; the pure
 *     engine selectors (`pickPlanAsOf` / `listPlansAsOf`) own as-of ordering, so a
 *     non-monotonic file still replays deterministically.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  isPlanIsoDate,
  resolveDataDir,
  type ActivePlan,
  type DcaLadderPlan,
  type DcaRung,
  type DcaTimePlan,
  type LoadedPlans,
  type NoPlanRecord,
  type PlanEnvelope,
  type PlanRecord,
  type SkippedPlanLine,
} from "@numisma/engine";

/**
 * Resolve the plan sidecar path. With no `dataDir` we resolve under the shared engine
 * `resolveDataDir` (the `NUMISMA_DATA_DIR` override or the absolute, homedir-derived
 * accumulus default) — NEVER a CWD-relative `./data/plans.jsonl` (R-M3), which would
 * split-brain the moment two processes with different working directories both read
 * it. An explicit `dataDir` is honored verbatim for callers (e.g. tests) that pass one.
 *
 * Named `plans.jsonl`, not `dca-plans.jsonl` (`S5`): DCA is the species, a
 * per-position plan is the genus, and this repo has paid the narrow-name tax twice in
 * two sessions. The word `strategy` is deliberately NOT spent either — naming it
 * `strategies.jsonl` would implicitly promise that the `strategy` tag already required
 * on every Position resolves against this file, which is a migration, not a naming
 * choice.
 */
export function resolvePlansPath(dataDir = resolveDataDir()): string {
  return join(resolve(dataDir), "plans.jsonl");
}

/**
 * `S4`'s durability obligation, stated in code so a reader of this module meets it.
 *
 * `plans.jsonl` must be added to accumulus's deny-by-default `.gitignore` ALLOWLIST
 * and to `TRACKED_FILES` in `apps/tui/src/ingest-commit.ts`, or the file is silently
 * EPHEMERAL — written, never committed, lost. Those two edits are load-bearing; the
 * explicit-add in `run-daily-fetch.sh` matters exactly once (the day the file is
 * created, because `git add -u` skips an untracked file) and its post-check makes it
 * loud forever after.
 *
 * NEITHER EDIT IS MADE BY THIS PROTOTYPE. Decision 7 puts the accumulus repo out of
 * scope — that durable, two-repo edit belongs to the real increment, not a specimen —
 * and the guard TEST that converts this silent trap into a red suite is likewise the
 * real increment's, not this branch's. This constant exists so the obligation is on
 * the record at the site that creates it.
 */
export const PLANS_DURABILITY_OBLIGATION = {
  fileName: "plans.jsonl",
  loadBearing: ["accumulus .gitignore allowlist", "ingest-commit.ts TRACKED_FILES"],
  parity: ["run-daily-fetch.sh explicit-add", "run-daily-fetch.sh post-check"],
} as const;

/** Cadences `dcaTime` accepts. Outside this set the BODY is invalid, not unknown. */
const CADENCES: readonly DcaTimePlan["cadence"][] = ["daily", "weekly", "monthly"];

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A `tierOrder` is a non-empty list of distinct, non-empty tier ids. */
function validateTierOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  if (!value.every(isNonEmptyString)) {
    return undefined;
  }
  // A repeated tier would make consumption order ambiguous at the repeat.
  if (new Set(value as string[]).size !== value.length) {
    return undefined;
  }
  return [...(value as string[])];
}

/**
 * Validate the rungs of a ladder. Rung SHAPE is invented by this prototype (`S5`
 * left the bodies to `spec`), but two checks are not arbitrary: prices and sizes must
 * be finite and positive, because a rung at price 0 or size NaN would flow into an
 * accumulation curve as a real point; and rung ids must be distinct, because they are
 * the join key a later fill will match on (`D7`'s open residual).
 */
function validateRungs(value: unknown): DcaRung[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const rungs: DcaRung[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      return undefined;
    }
    const rung = raw as Record<string, unknown>;
    if (!isNonEmptyString(rung.id)) {
      return undefined;
    }
    if (!isFinitePositive(rung.priceUsd) || !isFinitePositive(rung.sizeUsd)) {
      return undefined;
    }
    rungs.push({ id: rung.id, priceUsd: rung.priceUsd, sizeUsd: rung.sizeUsd });
  }
  if (new Set(rungs.map((rung) => rung.id)).size !== rungs.length) {
    return undefined;
  }
  return rungs;
}

/**
 * Read the THREE ENVELOPE FIELDS common to every kind, `noPlan` included.
 *
 * This runs BEFORE any dispatch on `kind`, and that ordering is load-bearing (`S5`,
 * Key fact 5): it is the only reason a line this build cannot READ can still be
 * ATTRIBUTED to a position and a date, which is what `S6`'s per-position "not
 * readable" warning requires. Per `S5` this envelope is the emerging shared
 * abstraction — discovered by this loader's needs rather than designed up front —
 * and nothing further is abstracted over the kinds until strategy #3.
 *
 * Returns `undefined` when the envelope itself is broken; the caller then reports an
 * `invalid` skip carrying whatever partial attribution it could scrape.
 */
function readEnvelope(value: unknown): PlanEnvelope | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.kind)) {
    return undefined;
  }
  if (!isNonEmptyString(record.positionId)) {
    return undefined;
  }
  if (!isPlanIsoDate(record.effectiveAt)) {
    return undefined;
  }
  return {
    kind: record.kind,
    positionId: record.positionId,
    effectiveAt: record.effectiveAt,
  };
}

/**
 * Best-effort attribution for a line whose ENVELOPE did not validate. A corrupt line
 * may still carry a readable `positionId` — scraping it means the skip lands on the
 * right row instead of being smeared across every position (see `pickPlanAsOf`, which
 * deliberately refuses to attribute an unattributable skip to anyone).
 */
function scrapeAttribution(value: unknown): Partial<PlanEnvelope> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
    ...(isNonEmptyString(record.positionId) ? { positionId: record.positionId } : {}),
    ...(isPlanIsoDate(record.effectiveAt) ? { effectiveAt: record.effectiveAt } : {}),
  };
}

/**
 * Validate the BODY of a line whose envelope already parsed and whose `kind` this
 * build knows. Returns `undefined` to signal an `invalid` skip — note this is a
 * different failure from an unknown `kind`: the build DOES have a reader, and the
 * data did not satisfy it.
 */
function validateBody(envelope: PlanEnvelope, value: unknown): PlanRecord | undefined {
  const record = value as Record<string, unknown>;

  if (envelope.kind === "noPlan") {
    // The terminator (`S7`). `reason` is free-form INTENT — pause vs end — and is
    // deliberately not a schema field; a non-string reason is the only way to fail.
    if (record.reason !== undefined && typeof record.reason !== "string") {
      return undefined;
    }
    const terminator: NoPlanRecord = {
      kind: "noPlan",
      positionId: envelope.positionId,
      effectiveAt: envelope.effectiveAt,
      ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    };
    return terminator;
  }

  // Both ACTIVE kinds carry the tier-consumption ordering as a FIELD (`S1`), so it
  // inherits the plan's `effectiveAt` and needs no second artifact or contract.
  const tierOrder = validateTierOrder(record.tierOrder);
  if (tierOrder === undefined) {
    return undefined;
  }

  if (envelope.kind === "dcaLadder") {
    const rungs = validateRungs(record.rungs);
    if (rungs === undefined) {
      return undefined;
    }
    const ladder: DcaLadderPlan = {
      kind: "dcaLadder",
      positionId: envelope.positionId,
      effectiveAt: envelope.effectiveAt,
      tierOrder,
      rungs,
    };
    return ladder;
  }

  if (envelope.kind === "dcaTime") {
    if (!isFinitePositive(record.amountUsd)) {
      return undefined;
    }
    if (
      typeof record.cadence !== "string" ||
      !(CADENCES as readonly string[]).includes(record.cadence)
    ) {
      return undefined;
    }
    if (!isPlanIsoDate(record.startsAt)) {
      return undefined;
    }
    const timed: DcaTimePlan = {
      kind: "dcaTime",
      positionId: envelope.positionId,
      effectiveAt: envelope.effectiveAt,
      tierOrder,
      cadence: record.cadence as DcaTimePlan["cadence"],
      amountUsd: record.amountUsd,
      startsAt: record.startsAt,
    };
    return timed;
  }

  return undefined;
}

/** Is this a `kind` the current build has a reader for? */
function isKnownKind(kind: string): kind is PlanRecord["kind"] {
  return kind === "dcaLadder" || kind === "dcaTime" || kind === "noPlan";
}

/**
 * Read the append-only plan sidecar into validated records PLUS the lines it had to
 * skip. A missing file = no plans (empty everything), NOT an error — a fund with no
 * DCA plan is the normal starting state (`S2`). Blank lines are tolerated. Append
 * order is preserved; the engine's selectors own as-of ordering.
 *
 * THE SKIPS ARE RETURNED, NEVER MERELY LOGGED (`S6`). U, verbatim: *"Any access
 * surface has to make evident something was wrong. But it can do so with a warning.
 * Not a global error."* Throwing here would repeat #153 where the stakes do not
 * justify it — an unparseable `events.jsonl` line means NAV is wrong, whereas an
 * unreadable plan line means a VIEW is incomplete. And the warning must ride in the
 * return value because the push runs headless at 18:00 while the TUI is interactive;
 * a warning printed to a stream nobody reads is a silent skip with extra steps.
 *
 * The two skip buckets are DIFFERENT INSTRUCTIONS and are never merged:
 *   `unknownKind` → your checkout is older than your data; pull.
 *   `invalid`     → the line is corrupt.
 *
 * `detail` never quotes the offending line. Plan bodies carry rung prices and sizes,
 * which are FIGURES (`S8`); a diagnostic that echoed the line would launder them into
 * logs, and this repo already paid that tax once (`c304f01`).
 */
export async function loadPlans(path: string): Promise<LoadedPlans> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { plans: [], unknownKind: [], invalid: [] };
    }
    throw error;
  }

  const plans: PlanRecord[] = [];
  const unknownKind: SkippedPlanLine[] = [];
  const invalid: SkippedPlanLine[] = [];

  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    // 1-based, so the number matches what an editor shows a human.
    const lineNumber = index + 1;
    if (!line) {
      continue; // tolerate blank lines
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalid.push({
        reason: "invalid",
        line: lineNumber,
        detail: "not valid JSON",
      });
      continue;
    }

    // ENVELOPE FIRST — before any dispatch on `kind`. This is what makes the two
    // skips below attributable to a position.
    const envelope = readEnvelope(parsed);
    if (envelope === undefined) {
      invalid.push({
        reason: "invalid",
        line: lineNumber,
        ...scrapeAttribution(parsed),
        detail:
          "envelope is not well-formed (needs a non-empty `kind`, a non-empty " +
          "`positionId`, and an `effectiveAt` that is a strict ISO YYYY-MM-DD date)",
      });
      continue;
    }

    if (!isKnownKind(envelope.kind)) {
      unknownKind.push({
        reason: "unknownKind",
        line: lineNumber,
        kind: envelope.kind,
        positionId: envelope.positionId,
        effectiveAt: envelope.effectiveAt,
        detail:
          `this build has no reader for plan kind "${envelope.kind}" — ` +
          `the checkout is older than the data`,
      });
      continue;
    }

    const record = validateBody(envelope, parsed);
    if (record === undefined) {
      invalid.push({
        reason: "invalid",
        line: lineNumber,
        kind: envelope.kind,
        positionId: envelope.positionId,
        effectiveAt: envelope.effectiveAt,
        detail: `the body of this "${envelope.kind}" line is malformed`,
      });
      continue;
    }

    plans.push(record);
  }

  return { plans, unknownKind, invalid };
}

/**
 * Genuinely APPEND-ONLY writer: append exactly ONE plan record as a JSON line without
 * touching prior lines. Superseding a plan is just appending a later `effectiveAt`
 * for the same `positionId` (`S7`) — the old line stays and still replays for earlier
 * dates, which is the entire basis of as-of replay. ENDING a plan is appending a
 * `noPlan` record; pause and end are the same act, and resumption is a later plan
 * line.
 *
 * There is deliberately NO whole-file rewrite path and no `updatePlan`. Editing a
 * plan in place would silently rewrite history that a past projection depends on.
 */
export async function appendPlan(path: string, record: PlanRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

/**
 * Convenience for the write path: end a position's plan as of a date.
 *
 * Exists because `noPlan` is the one record a caller writes without having a plan
 * body in hand, and spelling the envelope out at each call site is where a typo'd
 * `kind` would come from.
 */
export async function appendNoPlan(
  path: string,
  positionId: string,
  effectiveAt: string,
  reason?: string,
): Promise<void> {
  await appendPlan(path, {
    kind: "noPlan",
    positionId,
    effectiveAt,
    ...(reason === undefined ? {} : { reason }),
  });
}

/** Re-exported for callers that hold a plan and want to narrow it without the engine. */
export type { ActivePlan, PlanRecord };
