/**
 * `data/reconciliations.jsonl` — THE RECORD THAT THE OPERATOR WAS TOLD.
 *
 * Not a record of what is true. `plans.jsonl` is what was declared and
 * `events.jsonl` is what the fund did; this file records only that, at a
 * named moment, a reader compared them and showed the operator the result.
 *
 * AUTHORITY. `plans.jsonl` is authoritative, always. A line here NEVER
 * overrides it, corrects it, or is read in preference to it. A reader that
 * needs to know what a plan declares reads the sidecar; a reader that needs
 * to know what the operator was shown on some past day reads this.
 *
 * WHY IT DENORMALIZES, DELIBERATELY. Each line carries a copy of the
 * declared values as shown. That copy is not redundancy: plan supersession
 * is APPEND, and `pickPlanAsOf` selects the latest `effectiveAt <= asOf`,
 * so a line appended later but DATED EARLIER retroactively changes what
 * re-derivation returns for a fill already recorded. The verdict as shown
 * is therefore not recoverable from the sidecar at any later date.
 *
 * A DISAGREEMENT IS A FINDING, NOT A CORRUPTION. When a trail line and a
 * fresh re-derivation differ, the file is not stale and the sidecar is not
 * wrong: a past plan was rewritten after the fact. That divergence is
 * recorded nowhere else, and surfacing it is this file's whole reason to
 * be durable rather than printed.
 *
 * BEST-EFFORT, AND NEVER PART OF THE ACT. The fill is durable before this
 * file is touched. Every failure here degrades to a loud stderr warn and
 * returns; nothing in this file can refuse a fill, roll one back, or block
 * a return. A reader that finds no line for a fill reports UNKNOWN, never
 * clean.
 *
 * NEVER FOLDED. Not a `PortfolioEvent`. `parseEvent` never sees it,
 * `foldEvents` never reads it, and it changes no value NAV folds from
 * (ADR-004, ADR-013). It is durable, non-re-derivable truth by ADR-006's
 * membership test, which is what admits it to `TRACKED_FILES` — and that
 * admission rests on the denormalized copy above, not on the verdict.
 *
 * ---
 *
 * The block above is the file's own header, reproduced VERBATIM from the spec and
 * held there by a test. It lands on the IO shell rather than on the engine half for
 * `plans.ts`'s reason: it speaks about the FILE — its authority, its durability
 * contract, its admission to `TRACKED_FILES` — and the IO shell is the module that
 * documents the file. ADR-001 bars file IO from `@numisma/engine`, so the pure half
 * (the record contract, the closed mismatch vocabulary, the verdict function, the
 * canonical serializer) lives at `packages/engine/src/reconciliations.ts` and only
 * disk access and line parsing live here, beside `plans.ts` and inheriting the same
 * import guard.
 *
 * Durability contract, identical to `plans.ts`'s in mechanics and divergent in
 * exactly two places, both of which are about WHO WRITES THE FILE:
 *
 *   - The append is a GENUINE append via lock + temp + rename (`./sidecar-io.ts`),
 *     shared with `appendPlan` and `appendOrders`. Appending after a final line that
 *     lacks its `\\n` REPAIRS that line rather than concatenating onto it.
 *   - The loader is TOTAL ({@link loadReconciliations}): it never throws on any
 *     input, and it reports every skipped line rather than swallowing it.
 *   - The round-trip invariant: anything {@link appendReconciliation} accepts,
 *     {@link loadReconciliations} reads back — enforced by running the serialized
 *     line back through the LOADER'S OWN reader before the write is allowed to
 *     happen.
 *   - **DIVERGENCE 1 — the file is MACHINE-WRITTEN, not hand-authored.** A skipped
 *     line here is not an operator typo; it is a torn write or corruption, and
 *     therefore a genuine incident. The reader still never throws and the verdict
 *     still exits non-zero on any skip — the same policy as `unattendedPlansVerdict`,
 *     with a different diagnosis in the prose.
 *   - **DIVERGENCE 2 — the echo WARNS instead of throwing.** `appendPlan` throws when
 *     its round-trip echo rejects, which is right for a hand-authored file and wrong
 *     here: the trail write is best-effort and outside the fill act, and nothing on
 *     that path may throw. So the echo stays — same reader, same
 *     construction-not-convention guarantee — and its failure degrades to the same
 *     loud stderr warn as every other failure here, writing nothing. The invariant is
 *     preserved; only the escalation changes.
 *
 * Diagnostics discipline, which is a security property and not a style rule: nothing
 * this module produces ever quotes a line of the file, and NOTHING IT PRODUCES NAMES
 * A FIGURE — no price, no size, no amount, no balance, in a record, a skip `detail`,
 * a verdict message or a stderr warn. Every diagnostic names the LINE NUMBER instead,
 * which is exactly what the read-side `line` stamp is for.
 */
import { readFile } from "node:fs/promises";
import {
  CAPITAL_TIERS,
  PULL_INSTRUCTION,
  RECONCILIATION_MISMATCHES,
  isIsoCalendarDate,
  isRecordEventId,
  isRenderableRecordId,
  serializeReconciliationRecord,
  type CapitalTier,
  type DeclaredAsShown,
  type LoadedReconciliationRecord,
  type LoadedReconciliations,
  type ReconciliationFillKind,
  type ReconciliationMismatch,
  type ReconciliationRecord,
  type SkippedReconciliationLine,
} from "@numisma/engine";
import {
  appendSidecarLines,
  isRecordObject,
  resolveSidecarPath,
  stripBom,
} from "./sidecar-io.js";

/** The trail's name, used by the path resolver and by nothing else. */
const RECONCILIATIONS_FILE_NAME = "reconciliations.jsonl";

/**
 * Resolve the trail path under ADR-006's invariant — absolute and homedir-derived,
 * never CWD-relative. The four cases (unset → the accumulus default, blank/whitespace
 * → a loud throw, absolute → verbatim, relative → a loud throw) live once in
 * {@link resolveSidecarPath}.
 *
 * This is the ONE function in this module that can throw, and it throws for the
 * resolver's two stated reasons: a relative data dir splits the store, and a blank one
 * is a misconfigured knob that would otherwise default the trail onto the operator's
 * REAL ledger. A caller on the fill path resolves the path once, up front, outside the
 * best-effort write.
 */
export function resolveReconciliationsPath(dataDir?: string): string {
  return resolveSidecarPath(RECONCILIATIONS_FILE_NAME, dataDir);
}

/** The two fill events D7 counts. Closed here for the same reason tiers are. */
const FILL_KINDS: readonly ReconciliationFillKind[] = ["PositionOpened", "PositionAddedTo"];

/** The plan kinds `declared` may copy. `noPlan` is carried by `status`, not by `kind`. */
const DECLARED_PLAN_KINDS = ["dcaLadder", "dcaTime"] as const;

/**
 * `toldAt` — an instant with an EXPLICIT OFFSET.
 *
 * The offset is required rather than optional because the field is the audit fact:
 * "when the operator was told" is not a fact at all if the reader has to guess whose
 * midnight it was written against. `Z` counts — it is an explicit offset of zero, not
 * an absent one — and a bare local `YYYY-MM-DDTHH:MM:SS` does not.
 */
const INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isInstantWithOffset(value: unknown): value is string {
  return typeof value === "string" && INSTANT_WITH_OFFSET.test(value);
}

/** The reader's verdict on ONE untrusted value from the file. */
type ReconciliationLineRead =
  | { status: "ok"; record: LoadedReconciliationRecord }
  | { status: "skip"; skip: SkippedReconciliationLine };

function invalid(
  line: number,
  detail: string,
  scraped: Pick<SkippedReconciliationLine, "positionId" | "asOf"> = {},
): ReconciliationLineRead {
  return { status: "skip", skip: { line, reason: "invalid", detail, ...scraped } };
}

function unsupported(
  line: number,
  detail: string,
  scraped: Pick<SkippedReconciliationLine, "positionId" | "asOf"> = {},
): ReconciliationLineRead {
  return { status: "skip", skip: { line, reason: "unsupported", detail, ...scraped } };
}

/**
 * Read `declared` — D5's copy — or return the prose problem with it.
 *
 * Arms mirror `PlanLookup`'s one for one, and the copy NEVER carries `rungs`: rungs
 * hold `priceUsd` and `sizeUsd`, which are the fund's figures, and the trail carries
 * no figures. An unknown key on the object is simply not read — the canonical
 * serializer emits a fixed field set, so a line that carries more than that came from
 * somewhere else and the extra is not this reader's business to preserve.
 */
function readDeclared(value: unknown): { declared: DeclaredAsShown } | { problem: string } {
  if (!isRecordObject(value)) {
    return { problem: "declared must be a JSON object — it is required on every line" };
  }
  switch (value.status) {
    case "none":
    case "unreadable":
      return { declared: { status: value.status } };
    case "ended": {
      if (!isIsoCalendarDate(value.effectiveAt)) {
        return {
          problem:
            "an ended declared copy needs effectiveAt as a strict ISO calendar date, YYYY-MM-DD",
        };
      }
      return { declared: { status: "ended", effectiveAt: value.effectiveAt } };
    }
    case "active":
    case "pending": {
      const status = value.status;
      if (
        typeof value.kind !== "string" ||
        !(DECLARED_PLAN_KINDS as readonly string[]).includes(value.kind)
      ) {
        return { problem: "declared.kind must be dcaLadder or dcaTime" };
      }
      if (!isIsoCalendarDate(value.effectiveAt)) {
        return {
          problem:
            "a declared copy in force needs effectiveAt as a strict ISO calendar date, YYYY-MM-DD",
        };
      }
      if (
        !Array.isArray(value.tierOrder) ||
        value.tierOrder.length === 0 ||
        !value.tierOrder.every(
          (tier) => typeof tier === "string" && (CAPITAL_TIERS as readonly string[]).includes(tier),
        )
      ) {
        return {
          problem: "declared.tierOrder must be a non-empty array of this fund's capital tiers",
        };
      }
      // The ladder's own id travels onto the page beside the position's, so it is held
      // to the same renderability rule. `dcaTime` declares none, and absent is legal.
      if (value.planId !== undefined && !isRenderableRecordId(value.planId)) {
        return {
          problem:
            "declared.planId, when present, must be a non-empty string of at most 64 " +
            "characters, holding no control characters",
        };
      }
      return {
        declared: {
          status,
          kind: value.kind as "dcaLadder" | "dcaTime",
          ...(value.planId === undefined ? {} : { planId: value.planId as string }),
          effectiveAt: value.effectiveAt,
          tierOrder: [...(value.tierOrder as CapitalTier[])],
        },
      };
    }
    default:
      return {
        problem:
          "declared.status must be active, pending, ended, none or unreadable — it is " +
          "required on every line and is never omitted or null",
      };
  }
}

/**
 * Turn ONE untrusted value into a record, or into the skip that explains why not.
 *
 * **ENVELOPE FIRST.** `{positionId, eventId, asOf}` is read and validated BEFORE
 * anything dispatches on the body, for `readPlanLine`'s own stated reason — it is the
 * only thing that lets a line with an unreadable BODY still be attributed to a
 * position, and attribution is what keeps an unattributable skip rare and a
 * position-scoped one precise. A skip that names a position blacks out that position
 * when it is the newest in-window line; a skip that names none belongs to NO position
 * and is counted file-globally, because attaching it to one would turn a single broken
 * line into a fund-wide blackout.
 *
 * The two skip buckets carry INSTRUCTIONS, not parse stages. `unsupported` is narrow
 * here and deliberately so: it names the one hazard a newer checkout creates that a
 * whole-line skip does not already cover — an unrecognized member of `mismatches`,
 * which would otherwise be SILENTLY DROPPED from an otherwise-acceptable record, and
 * the thing this checkout cannot name might be a warning. Every other unreadable value
 * skips the whole line, which already renders that position unknown, and for a
 * machine-written file the honest diagnosis of that is corruption: `invalid`.
 *
 * Shared by {@link loadReconciliations} and {@link appendReconciliation} —
 * deliberately. The round-trip invariant is only worth anything if the writer's idea
 * of a writable line and the reader's idea of a readable one are the SAME CODE rather
 * than two lists someone keeps in sync. There is no cross-line state to thread: this
 * file claims no uniqueness across lines, because D7's "one line per fill" is a
 * property of the WRITER's caller, and a reader that refused a re-recorded fill would
 * drop the very line that documents it.
 */
function readReconciliationLine(value: unknown, line: number): ReconciliationLineRead {
  if (!isRecordObject(value)) {
    return invalid(line, "line is not a JSON object");
  }

  // --- envelope, before any dispatch on the body --------------------------------
  // An id that fails {@link isRenderableRecordId} is left OFF `scraped` deliberately:
  // the scraped id is the one that reaches the plans report page, so an id this module
  // will not render is also an id it will not attribute by. The line becomes
  // unattributable, which is the honest bucket for "we cannot say whose this is."
  const positionId = isRenderableRecordId(value.positionId) ? value.positionId : undefined;
  const asOf = isIsoCalendarDate(value.asOf) ? value.asOf : undefined;
  /** Everything readable about WHOSE line this is, attached to every skip below. */
  const scraped: Pick<SkippedReconciliationLine, "positionId" | "asOf"> = {
    ...(positionId === undefined ? {} : { positionId }),
    ...(asOf === undefined ? {} : { asOf }),
  };

  if (positionId === undefined) {
    return invalid(
      line,
      "positionId must be a non-empty string of at most 64 characters, holding no " +
        "control characters",
      scraped,
    );
  }
  // `isRecordEventId`, NOT `isRenderableRecordId`: the renderable rule's 64-character
  // bound is about the plans report page's id column, and `eventId` never travels
  // there. A real `fillEventId` — `fill:` + a synthesized order id + `@` + a stamp —
  // clears 64 for any plausible rung, so holding this field to the renderable rule
  // refused every id the fill path can actually produce. Non-empty and control-free
  // stay: it is identity, and it reaches a stderr diagnostic.
  if (!isRecordEventId(value.eventId)) {
    return invalid(
      line,
      "eventId must be a non-empty string holding no control characters — it is the " +
        "fill's dedup identity and one line per fill is checked by it",
      scraped,
    );
  }
  if (asOf === undefined) {
    return invalid(
      line,
      "asOf must be a strict ISO calendar date, YYYY-MM-DD — selection compares these as " +
        "strings, so any other form sorts wrong and picks the wrong line",
      scraped,
    );
  }

  // --- body ----------------------------------------------------------------------
  if (
    typeof value.fillKind !== "string" ||
    !(FILL_KINDS as readonly string[]).includes(value.fillKind)
  ) {
    return invalid(line, "fillKind must be PositionOpened or PositionAddedTo", scraped);
  }
  if (!isInstantWithOffset(value.toldAt)) {
    return invalid(
      line,
      "toldAt must be an instant with an explicit UTC offset — a stamp without one does " +
        "not say when the operator was told",
      scraped,
    );
  }
  if (
    typeof value.lotTier !== "string" ||
    !(CAPITAL_TIERS as readonly string[]).includes(value.lotTier)
  ) {
    return invalid(line, "lotTier names a capital tier this fund does not have", scraped);
  }
  const declaredRead = readDeclared(value.declared);
  if ("problem" in declaredRead) {
    return invalid(line, declaredRead.problem, scraped);
  }
  if (!Array.isArray(value.mismatches)) {
    return invalid(
      line,
      "mismatches must be an array — an empty one is a verdict and an absent one is not",
      scraped,
    );
  }
  const mismatches: ReconciliationMismatch[] = [];
  for (const mismatch of value.mismatches) {
    if (
      typeof mismatch !== "string" ||
      !(RECONCILIATION_MISMATCHES as readonly string[]).includes(mismatch)
    ) {
      // NOT dropped, and not `invalid`: a member this checkout cannot name might be a
      // warning, so the line is skipped with the instruction that repairs it. The token
      // itself is never echoed — it is arbitrary file content.
      return unsupported(line, `unrecognized mismatch kind; ${PULL_INSTRUCTION}`, scraped);
    }
    mismatches.push(mismatch as ReconciliationMismatch);
  }

  return {
    status: "ok",
    record: {
      positionId,
      eventId: value.eventId,
      fillKind: value.fillKind as ReconciliationFillKind,
      asOf,
      toldAt: value.toldAt,
      lotTier: value.lotTier as CapitalTier,
      declared: declaredRead.declared,
      mismatches,
      line,
    },
  };
}

/**
 * Read the trail into VALIDATED records — TOTALLY. No input throws.
 *
 * Totality is not a style choice here, it is what makes the return type expressible.
 * The trail is read by a DEFAULT SURFACE — the plans report — so a throwing reader
 * would let a trail problem kill a plans page, which is a strictly worse version of
 * the gap the trail exists to close. And a reader that throws collapses "the file is
 * not there" into "the file could not be read" at the call site, which is exactly the
 * collapse the report must not make.
 *
 * THREE `load` arms, and the third is the deliberate divergence from `loadPlans`:
 *
 *   - **The file is absent (`ENOENT`) → `absent`, empty buckets.** `loadPlans` folds
 *     this into `loaded` and says why: for a HAND-AUTHORED file, absence is the normal
 *     starting state and reporting it as an error would cry wolf on every fresh
 *     checkout. This file is MACHINE-WRITTEN, so its absence means the writer has
 *     never succeeded — which is the trail write's own failure mode, and the one fact
 *     the operator most needs. Different fact, different instruction, therefore a
 *     different bucket. It is still NOT an error: the verdict keeps exit code 0 for
 *     it, because before the first fill absence is normal.
 *   - **Any other read error → `load-failed`, empty buckets.** A permissions error or
 *     a half-mounted data directory is NOT "there are no reconciliations", and the
 *     difference is load-bearing downstream: the selector turns `load-failed` into
 *     unknown for every position rather than into "no line", because empty buckets
 *     alone would assert a fact about the fund that nobody established.
 *   - **A readable file → `loaded`**, however many of its lines were skipped.
 *
 * Line handling is forgiving of SHAPE and strict about CONTENT: a leading BOM is
 * stripped, CRLF terminators are tolerated, and blank lines (including the file's
 * trailing terminator) are skipped silently. Everything else is reported — and, this
 * file being machine-written, a report here is an incident rather than a typo.
 */
export async function loadReconciliations(path: string): Promise<LoadedReconciliations> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { load: { status: "absent", sourcePath: path }, reconciliations: [], skipped: [] };
    }
    return {
      load: {
        status: "load-failed",
        sourcePath: path,
        message: error instanceof Error ? error.message : String(error),
      },
      reconciliations: [],
      skipped: [],
    };
  }

  const reconciliations: LoadedReconciliationRecord[] = [];
  const skipped: SkippedReconciliationLine[] = [];
  const lines = stripBom(raw).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed === "") {
      continue;
    }
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      // A torn write lands here — the half-written tail of a line that never got its
      // terminator. Unattributable by construction, so it names no position.
      skipped.push({ line: lineNumber, reason: "invalid", detail: "line is not JSON" });
      continue;
    }
    const read = readReconciliationLine(value, lineNumber);
    if (read.status === "ok") {
      reconciliations.push(read.record);
    } else {
      skipped.push(read.skip);
    }
  }

  return { load: { status: "loaded", sourcePath: path }, reconciliations, skipped };
}

/** Prefix on every warn this module emits, so one `grep` finds all of them. */
const WARN_PREFIX = "reconciliations.jsonl";

/**
 * Append ONE trail line, genuinely and atomically — and NEVER throw.
 *
 * **The round-trip invariant is enforced here, not asserted in a comment.** The record
 * is serialized by the engine's canonical serializer, parsed back, and run through
 * {@link readReconciliationLine} — the LOADER'S OWN reader — before a single byte
 * reaches the disk. A record this function accepts is therefore a record
 * {@link loadReconciliations} reads back, by construction rather than by two lists
 * someone remembers to keep in sync. The serializer is field-by-field for its own
 * stated reason: a `LoadedReconciliationRecord` is structurally a
 * `ReconciliationRecord`, so a caller round-tripping a LOADED record would typecheck
 * perfectly and persist a stale `line` number into an append-only file.
 *
 * **The escalation is the one thing that differs from `appendPlan`.** That function
 * throws when its echo rejects, which is right for a hand-authored file: refusing
 * loudly at the call site is the cheap outcome when the alternative is an unreadable
 * line in an append-only file. It is wrong here, because this write is best-effort and
 * outside the fill act — the fill is already durable when this runs, and nothing on
 * this path may refuse a fill, roll one back, or block a return. So the echo stays and
 * its failure degrades to the same loud stderr warn as every other failure, WRITING
 * NOTHING. The invariant is preserved; only the escalation changes.
 *
 * Every failure degrades the same way: a rejected echo, a serializer refusal (an
 * unrenderable `positionId`), a lock the peer never released, a full volume. Each one
 * warns loudly to stderr naming the resolved path and the failure, writes nothing, and
 * returns normally.
 *
 * The durability mechanics (cross-process lock, unique temp sibling, torn-terminator
 * repair, atomic rename) live in `./sidecar-io.ts`, shared with `appendPlan`.
 * Appending after a final line that lacks its `\\n` REPAIRS that line rather than
 * concatenating onto it, so both records stay readable.
 *
 * No warn this function emits ever quotes a line or names a figure. The path and the
 * failure's own message are the whole of what travels.
 */
export async function appendReconciliation(
  path: string,
  record: ReconciliationRecord,
): Promise<void> {
  let serialized: string;
  try {
    // The serializer REFUSES an unrenderable `positionId` with a throw. That throw is
    // right where it lives and impossible here, so it is caught rather than avoided:
    // `isRenderableRecordId` is exported for callers that want to check first, and this
    // function must survive one that did not.
    serialized = serializeReconciliationRecord(record);
  } catch (error) {
    warn(path, "the record could not be serialized", error);
    return;
  }

  let echoed: unknown;
  try {
    echoed = JSON.parse(serialized);
  } catch (error) {
    warn(path, "the serialized line was not JSON", error);
    return;
  }
  const echo = readReconciliationLine(echoed, 1);
  if (echo.status !== "ok") {
    // The `detail` is fixed prose written by this module — never file content — so it
    // is safe in a warn, and it is the only thing that says WHICH field failed.
    warn(
      path,
      `this loader could not read the line back (${echo.skip.reason}): ${echo.skip.detail}`,
    );
    return;
  }

  try {
    await appendSidecarLines(path, [serialized]);
  } catch (error) {
    warn(path, "the append failed", error);
  }
}

/**
 * The loud stderr warn every failure on the write path degrades to.
 *
 * Loud because the alternative is silence: the fill is already durable and the caller
 * gets no signal, so this line is the only trace that the trail is now missing one.
 * The reader's side of that is a position that renders unknown rather than clean,
 * which is what makes the missing line detectable at all.
 */
function warn(path: string, what: string, cause?: unknown): void {
  const detail = cause === undefined ? "" : `: ${cause instanceof Error ? cause.message : String(cause)}`;
  console.warn(
    `${WARN_PREFIX}: NOT RECORDED — ${what}${detail}. The fill is durable; only the ` +
      `reconciliation trail line is missing (${path}).`,
  );
}

/** What an unattended caller must do about a trail load. */
export interface UnattendedReconciliationsVerdict {
  /** `0` iff the file was read or is simply not there yet, AND every line read. */
  exitCode: 0 | 1;
  /** Prose-only lines to print loudly. Never quotes the file, never names a figure. */
  messages: string[];
}

/**
 * The UNATTENDED-CALLER POLICY, as a value a test can assert instead of a convention a
 * reviewer must notice — the same shape and the same policy as
 * `unattendedPlansVerdict`, with a different diagnosis in the prose.
 *
 * The warrant is unchanged: a launchd job's stderr goes to an unread log, so a "loud
 * warning" reaches no one and an exit code is the only checked value. The policy is
 * therefore warn loudly AND exit non-zero whenever the file could not be read or any
 * line in it was skipped.
 *
 * The divergence is the DIAGNOSIS, not the policy. `plans.jsonl` is hand-authored, so
 * a skip there is an operator typo; this file is machine-written, so a skip here is a
 * torn write or corruption — a genuine incident, and the message says so.
 *
 * `absent` exits **0**, alone among the load arms. Before the first fill is recorded
 * absence is the normal state, and a daily non-zero exit for it would cry wolf exactly
 * as `loadPlans` warns. It still SAYS something, because the same absence after fills
 * have been recorded means the write has never succeeded — the fact the operator most
 * needs, and one only they can tell apart from a fresh checkout.
 */
export function unattendedReconciliationsVerdict(
  loaded: LoadedReconciliations,
): UnattendedReconciliationsVerdict {
  const messages: string[] = [];
  let failed = false;
  if (loaded.load.status === "absent") {
    messages.push(
      "reconciliations.jsonl is not there. Before the first recorded fill that is normal; " +
        "after one it means the trail write has never succeeded — look for its stderr warn.",
    );
  }
  if (loaded.load.status === "load-failed") {
    failed = true;
    messages.push(`reconciliations.jsonl could not be read: ${loaded.load.message}`);
  }
  for (const skip of loaded.skipped) {
    failed = true;
    messages.push(
      `reconciliations.jsonl line ${skip.line} skipped (${skip.reason}): ${skip.detail}. ` +
        "This file is machine-written, so this is a torn write or corruption rather than " +
        "a typo.",
    );
  }
  return { exitCode: failed ? 1 : 0, messages };
}
