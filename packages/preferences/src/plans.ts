/**
 * IO shell over the `plans.jsonl` sidecar — resolve-path, load, append.
 *
 * A `Plan` is the operator's DECLARATION OF INTENT for one position, and this file is
 * a member of ADR-004's sidecar class — the third BY CLASS MEMBERSHIP, the axis
 * ADR-004's own counting note uses: durable, append-only, git-versioned,
 * beside the event log and never folded. ADR-001 bars file IO from `@numisma/engine`,
 * so the pure half — the record contract, the closed vocabularies, the strict
 * calendar-date predicate — lives at `packages/engine/src/plans.ts` and only the disk
 * access lives here. This is ANOTHER TENANT of a package whose name names one member
 * of the class rather than the class; the debt is recorded in ADR-004 and deliberately
 * not paid here, and the practical gain is the existing `@numisma/preferences` import
 * guard, inherited for free.
 *
 *   data/plans.jsonl   append-only, OPERATOR-AUTHORED, one PlanRecord JSON per line
 *
 * **The file is authored by hand.** Agents never write it and never touch the real
 * accumulus checkout. `appendPlan` exists so the format has exactly one executable
 * definition of what a writable line is — which is what makes the round-trip invariant
 * testable — not because anything in this repository routinely writes plans.
 *
 * Durability contract:
 *   - The append is a GENUINE append via lock + temp + rename (`./sidecar-io.ts`),
 *     matching the event store's standard and `appendOrders`. A bare `appendFile` with
 *     a suffix `\\n` is rejected for the reason documented there, and the reason is not
 *     hypothetical: the plans-sidecar PROTOTYPE took the suffix-only path and lost two
 *     records unattributably.
 *   - The loader is TOTAL (`loadPlans`): it never throws on any input, it distinguishes
 *     "the file is not there yet" against "the file could not be read", and it reports
 *     every skipped line rather than swallowing it.
 *   - The round-trip invariant: anything `appendPlan` accepts, `loadPlans` reads back —
 *     enforced by running the serialized line back through the LOADER'S OWN reader
 *     before the write is allowed to happen.
 *
 * Diagnostics discipline, which is a security property and not a style rule: nothing
 * this module produces ever quotes a line of the file. Plan bodies carry the fund's
 * figures, and a diagnostic that echoes a line launders them into terminals, log files
 * and CI output.
 */
import { readFile } from "node:fs/promises";
import {
  CAPITAL_TIERS,
  DCA_CADENCES,
  PLAN_KINDS,
  PULL_INSTRUCTION,
  isIsoCalendarDate,
  type CapitalTier,
  type DcaCadence,
  type DcaRung,
  type IsoDate,
  type LoadedPlanRecord,
  type LoadedPlans,
  type PlanKind,
  type PlanRecord,
  type SkippedPlanLine,
} from "@numisma/engine";
import {
  appendSidecarLines,
  isRecordObject,
  resolveSidecarPath,
  stripBom,
} from "./sidecar-io.js";

/** The sidecar's name, used by the path resolver and by nothing else. */
const PLANS_FILE_NAME = "plans.jsonl";

/**
 * Resolve the plans sidecar path under ADR-006's invariant — absolute and
 * homedir-derived, never CWD-relative. The three cases (unset/blank → the accumulus
 * default, absolute → verbatim, relative → a loud throw) live once in
 * {@link resolveSidecarPath}; see its docstring for why an explicit `""` must NOT
 * resolve against the process's working directory.
 */
export function resolvePlansPath(dataDir?: string): string {
  return resolveSidecarPath(PLANS_FILE_NAME, dataDir);
}

/** How much of an unrecognized `kind` may be carried into a diagnostic field. */
const KIND_TOKEN_MAX_LENGTH = 24;

/**
 * Reduce an arbitrary `kind` to a BOUNDED, SANITIZED token.
 *
 * The raw value is unbounded, operator-authored file content: it could be a megabyte,
 * it could contain newlines that forge a second log line, it could be a rendered
 * figure. This is the only form of it that leaves the module, it rides in a typed
 * field rather than in prose, and a value with nothing token-shaped in it yields
 * `undefined` — the diagnostic then names no kind at all, which is the honest
 * outcome.
 */
function sanitizeKindToken(raw: string): string | undefined {
  const token = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, KIND_TOKEN_MAX_LENGTH);
  return token === "" ? undefined : token;
}


function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** How long a `positionId` may be before the line is treated as corrupt. */
const POSITION_ID_MAX_LENGTH = 64;

/**
 * Is this `positionId` safe to carry out of the module and RENDER?
 *
 * `kind` is bounded and sanitized above, on the stated grounds that operator-authored
 * file content "could contain newlines that forge a second log line." `positionId`
 * rides the same envelope, gets read the same way, and travels FURTHER — into
 * `SkippedPlanLine.positionId`, into a `PlanRow`, and onto the desk page padded into a
 * column. An id holding a newline forges a whole fabricated ROW on the exact page the
 * runbook tells the operator to check their authored line against. The asymmetry was
 * the defect; this closes it.
 *
 * It VALIDATES rather than sanitizes, and the difference matters: `kind` is a token in
 * a diagnostic, so mangling it loses nothing, while `positionId` is IDENTITY — it is
 * matched against the fold's real position ids to decide `pending` against `active`.
 * A silently mangled id would attribute a plan to the wrong position, or to none,
 * which is a worse failure than the one being fixed. So an unsafe id makes the line
 * corrupt, and the loader's existing skip taxonomy carries it.
 *
 * The bound is the same argument once more: an unbounded id is not just a long string,
 * it sets `idWidth` for EVERY row on the page. Real ids in this fund run to a dozen
 * characters; 64 is far above any plausible one and still a column.
 */
function isRenderableId(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value.length <= POSITION_ID_MAX_LENGTH &&
    // C0 controls plus DEL. `\n` and `\r` are the forging pair; the rest join them
    // because none of them belongs in an identifier and every one moves a cursor.
    // eslint-disable-next-line no-control-regex -- matching control chars is the point
    !/[\u0000-\u001F\u007F]/.test(value)
  );
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPlanKind(value: unknown): value is PlanKind {
  return typeof value === "string" && (PLAN_KINDS as readonly string[]).includes(value);
}

function isDcaCadence(value: unknown): value is DcaCadence {
  return typeof value === "string" && (DCA_CADENCES as readonly string[]).includes(value);
}

/**
 * `tierOrder`: a non-empty, DISTINCT array drawn from the closed tier vocabulary.
 *
 * Non-empty because an empty routing order routes nothing and the plan is then
 * unusable; distinct because a repeated tier makes consumption order ambiguous at the
 * repeat. Returns the prose problem, or `undefined` when the value is well-formed.
 */
function tierOrderProblem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return "tierOrder must be a non-empty array of capital tiers";
  }
  const seen = new Set<string>();
  for (const tier of value) {
    if (typeof tier !== "string" || !(CAPITAL_TIERS as readonly string[]).includes(tier)) {
      return "tierOrder names a capital tier this fund does not have";
    }
    if (seen.has(tier)) {
      return "tierOrder repeats a capital tier, so consumption order is ambiguous";
    }
    seen.add(tier);
  }
  return undefined;
}

/**
 * `rungs`: a non-empty array of distinctly-identified, finite-positive rungs.
 *
 * A rung at price `0` or size `NaN` is not a harmless blank — it flows into an
 * accumulation curve as a real point. A repeated `id` breaks the join key a later
 * fill will match on, which is the only reason `id` exists.
 *
 * A REPEATED `priceUsd` IS REFUSED FOR THE SAME REASON, ONE LEVEL DOWN (#286). The
 * declared join (`planId` + `rungId` on the order) is optional forever, so PRICE MATCH
 * is the permanent fallback for every line that carries neither — and that fallback can
 * only ever be ambiguous if the DECLARATION was. Refusing here kills the collision
 * structurally instead of handling it at every reader downstream.
 *
 * THE DETAIL NAMES THE PRICE, which is the one deliberate narrowing of this module's
 * never-quote-the-line discipline. The remedy is to supersede the declaration with the
 * collided rung repriced, and an operator cannot find which rung that is from a refusal
 * that names none. The figure is a bounded parsed number the operator authored — not a
 * fund position or a balance — and it rides in the same prose the rest of the taxonomy
 * uses.
 */
function rungsProblem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return "rungs must be a non-empty array";
  }
  const seen = new Set<string>();
  const seenPrices = new Set<number>();
  for (const rung of value) {
    if (!isRecordObject(rung)) {
      return "every rung must be a JSON object";
    }
    if (!isNonEmptyString(rung.id)) {
      return "every rung needs a non-empty id";
    }
    if (seen.has(rung.id)) {
      return "two rungs share an id, so a later fill could not be joined to one of them";
    }
    seen.add(rung.id);
    if (!isFinitePositive(rung.priceUsd)) {
      return "every rung needs a finite, positive priceUsd";
    }
    if (!isFinitePositive(rung.sizeUsd)) {
      return "every rung needs a finite, positive sizeUsd";
    }
    // Compared on the PARSED NUMBER, so `90` and `90.0` are the one price they are.
    if (seenPrices.has(rung.priceUsd)) {
      return (
        `two rungs are declared at ${rung.priceUsd}, so a fill at that price could not be ` +
        "joined to one of them"
      );
    }
    seenPrices.add(rung.priceUsd);
  }
  return undefined;
}

/** The reader's verdict on ONE untrusted value from the file. */
type PlanLineRead =
  | { status: "ok"; record: LoadedPlanRecord }
  | { status: "skip"; skip: SkippedPlanLine };

function invalid(line: number, detail: string, scraped: Partial<SkippedPlanLine> = {}): PlanLineRead {
  return { status: "skip", skip: { line, reason: "invalid", detail, ...scraped } };
}

/**
 * Turn ONE untrusted value into a record, or into the skip that explains why not.
 *
 * **ENVELOPE FIRST.** `{kind, positionId, effectiveAt}` is read and validated BEFORE
 * anything dispatches on `kind`. That ordering is not incidental — it is the only
 * reason a line whose BODY is unreadable can still be attributed to a position, and
 * attribution is what lets the selector answer "this position's plan is unreadable"
 * instead of blacking out the whole fund.
 *
 * The two skip buckets carry INSTRUCTIONS, not parse stages: `unsupported` means the
 * file is ahead of this checkout (an unrecognized `kind` or `cadence`), `invalid`
 * means the line itself is corrupt.
 *
 * Shared by `loadPlans` and `appendPlan` — deliberately. The round-trip invariant is
 * only worth anything if the writer's idea of a writable line and the reader's idea of
 * a readable one are the SAME CODE rather than two lists someone keeps in sync.
 *
 * `claimedLadderIds` IS THE ONE PIECE OF CROSS-LINE STATE, and it is a PARAMETER rather
 * than module scope so this stays a function of its arguments: `loadPlans` threads one
 * set through one file, and `appendPlan`'s round-trip echo passes NONE — a single line
 * cannot collide with itself, and the writer has not read the file it is appending to,
 * so a uniqueness verdict there would be invented rather than checked.
 */
function readPlanLine(
  value: unknown,
  line: number,
  claimedLadderIds?: Set<string>,
): PlanLineRead {
  if (!isRecordObject(value)) {
    return invalid(line, "line is not a JSON object");
  }

  // --- envelope, before any dispatch on kind ------------------------------------
  // An id that fails {@link isRenderableId} is left OFF `scraped` deliberately: the
  // scraped id is the one that reaches a `PlanRow` and the page, so an id this module
  // will not render is also an id it will not attribute by. The line becomes
  // unattributable, which is the honest bucket for "we cannot say whose this is."
  const positionId = isRenderableId(value.positionId) ? value.positionId : undefined;
  const effectiveAt = isIsoCalendarDate(value.effectiveAt) ? value.effectiveAt : undefined;
  /** Everything readable about WHOSE line this is, attached to every skip below. */
  const scraped: Partial<SkippedPlanLine> = {
    ...(positionId === undefined ? {} : { positionId }),
    ...(effectiveAt === undefined ? {} : { effectiveAt }),
  };

  if (positionId === undefined) {
    return invalid(
      line,
      `positionId must be a non-empty string of at most ${POSITION_ID_MAX_LENGTH} ` +
        "characters, holding no control characters",
      scraped,
    );
  }
  if (effectiveAt === undefined) {
    return invalid(
      line,
      "effectiveAt must be a strict ISO calendar date, YYYY-MM-DD — selection compares " +
        "these as strings, so any other form sorts wrong and selects the wrong plan",
      scraped,
    );
  }
  if (typeof value.kind !== "string") {
    return invalid(line, "kind must be a string", scraped);
  }
  if (!isPlanKind(value.kind)) {
    // M3: the raw kind is arbitrary file content. It rides in a bounded, sanitized,
    // typed field; the prose says nothing that came off the disk.
    const kindToken = sanitizeKindToken(value.kind);
    return {
      status: "skip",
      skip: {
        line,
        reason: "unsupported",
        detail: `unrecognized plan kind; ${PULL_INSTRUCTION}`,
        ...scraped,
        ...(kindToken === undefined ? {} : { kindToken }),
      },
    };
  }

  // --- body, dispatched on a kind now known to be one of three -------------------
  const kind: PlanKind = value.kind;
  const envelope = { positionId, effectiveAt };
  switch (kind) {
    case "noPlan": {
      if (value.reason !== undefined && typeof value.reason !== "string") {
        return invalid(line, "noPlan reason must be a string when present", scraped);
      }
      return {
        status: "ok",
        record: {
          kind,
          ...envelope,
          ...(value.reason === undefined ? {} : { reason: value.reason }),
          line,
        },
      };
    }
    case "dcaLadder": {
      // THE LADDER'S OWN IDENTITY (#286), held to the same renderability rule
      // `positionId` is held to and for the same reasons — it is identity, it is
      // operator-authored file content, and it travels. A canonical UUID clears it.
      if (!isRenderableId(value.id)) {
        return invalid(
          line,
          `a dcaLadder needs an id: a non-empty string of at most ${POSITION_ID_MAX_LENGTH} ` +
            "characters, holding no control characters — a UUID is the expected form",
          scraped,
        );
      }
      // UNIQUE ACROSS THE WHOLE FILE. Two ladders sharing an id are indistinguishable to
      // an order that names one, which is the entire purpose of the field; the FIRST line
      // wins, because it is the one every reference already written points at. The id is
      // named because the repair — supersede the repeat with a freshly generated UUID —
      // is unfindable without it, and it has just cleared the renderability gate.
      if (claimedLadderIds?.has(value.id) === true) {
        return invalid(
          line,
          `two plan lines declare the ladder id ${value.id}, so nothing pointing at it could ` +
            "say which ladder it means",
          scraped,
        );
      }
      const tierProblem = tierOrderProblem(value.tierOrder);
      if (tierProblem !== undefined) {
        return invalid(line, tierProblem, scraped);
      }
      const rungProblem = rungsProblem(value.rungs);
      if (rungProblem !== undefined) {
        return invalid(line, rungProblem, scraped);
      }
      // Claimed only by a line that READ — a skipped declaration is not a declaration,
      // so it must not make a later, well-formed line carrying the same id collide.
      claimedLadderIds?.add(value.id);
      return {
        status: "ok",
        record: {
          kind,
          id: value.id,
          ...envelope,
          tierOrder: [...(value.tierOrder as CapitalTier[])],
          rungs: (value.rungs as DcaRung[]).map((rung) => ({
            id: rung.id,
            priceUsd: rung.priceUsd,
            sizeUsd: rung.sizeUsd,
          })),
          line,
        },
      };
    }
    case "dcaTime": {
      if (typeof value.cadence !== "string") {
        return invalid(line, "cadence must be a string", scraped);
      }
      if (!isDcaCadence(value.cadence)) {
        // Same rule as an unrecognized kind: open at the wire, closed at the reader.
        // The cadence vocabulary is a closed literal list in the ENGINE, so the token
        // is bounded by construction and needs no sanitized echo.
        return {
          status: "skip",
          skip: {
            line,
            reason: "unsupported",
            detail: `unrecognized dcaTime cadence; ${PULL_INSTRUCTION}`,
            ...scraped,
          },
        };
      }
      if (!isIsoCalendarDate(value.anchorAt)) {
        return invalid(
          line,
          "anchorAt must be a strict ISO calendar date, YYYY-MM-DD — it fixes the " +
            "cadence's phase, so an unparseable one has no grid to sit on",
          scraped,
        );
      }
      if (!isFinitePositive(value.amountUsd)) {
        return invalid(line, "amountUsd must be finite and positive", scraped);
      }
      const tierProblem = tierOrderProblem(value.tierOrder);
      if (tierProblem !== undefined) {
        return invalid(line, tierProblem, scraped);
      }
      return {
        status: "ok",
        record: {
          kind,
          ...envelope,
          cadence: value.cadence,
          anchorAt: value.anchorAt,
          amountUsd: value.amountUsd,
          tierOrder: [...(value.tierOrder as CapitalTier[])],
          line,
        },
      };
    }
  }
}


/**
 * Read the sidecar into VALIDATED records — TOTALLY. No input throws.
 *
 * The two arms of `load` and their instructions:
 *
 *   - **The file is absent (`ENOENT`) → `loaded`, empty buckets.** This is the NORMAL
 *     STARTING STATE, not a failure: the file does not exist until the operator
 *     authors the first line. A loader that reported this as an error would cry wolf
 *     on every fresh checkout.
 *   - **Any other read error → `load-failed`, empty buckets.** A permissions error or
 *     a half-mounted data directory is NOT "there are no plans", and the difference is
 *     load-bearing downstream: the selector turns `load-failed` into `unreadable` for
 *     every position rather than `none`, because empty buckets alone would assert a
 *     fact about the fund that nobody established.
 *
 * Line handling is deliberately forgiving of SHAPE and strict about CONTENT: a leading
 * BOM is stripped, CRLF terminators are tolerated, and blank or whitespace-only lines
 * (including the file's trailing terminator) are skipped silently — none of those is
 * something an operator did wrong. Everything else is reported.
 */
export async function loadPlans(path: string): Promise<LoadedPlans> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { load: { status: "loaded", sourcePath: path }, plans: [], skipped: [] };
    }
    return {
      load: {
        status: "load-failed",
        sourcePath: path,
        message: error instanceof Error ? error.message : String(error),
      },
      plans: [],
      skipped: [],
    };
  }

  const plans: LoadedPlanRecord[] = [];
  const skipped: SkippedPlanLine[] = [];
  /** Every ladder id this file has already declared — the cross-line state, built once. */
  const claimedLadderIds = new Set<string>();
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
      skipped.push({ line: lineNumber, reason: "invalid", detail: "line is not JSON" });
      continue;
    }
    const read = readPlanLine(value, lineNumber, claimedLadderIds);
    if (read.status === "ok") {
      plans.push(read.record);
    } else {
      skipped.push(read.skip);
    }
  }

  return { load: { status: "loaded", sourcePath: path }, plans, skipped };
}

/**
 * The CANONICAL write shape of one record: exactly the declared fields of its kind, in
 * a fixed order, and NOTHING else.
 *
 * Field-by-field rather than `JSON.stringify(record)` for one specific reason. The
 * read shape is `PlanRecord & { line }`, and a `LoadedPlanRecord` is structurally a
 * `PlanRecord` — so a caller round-tripping a loaded record through `appendPlan` would
 * type-check perfectly and persist a LINE NUMBER into the file. The line number is
 * read-side only: written down, it becomes a second, immediately-stale identity for a
 * record whose identity is `positionId` + `effectiveAt`.
 */
function serializePlanRecord(record: PlanRecord): string {
  switch (record.kind) {
    case "noPlan":
      return JSON.stringify({
        kind: record.kind,
        positionId: record.positionId,
        effectiveAt: record.effectiveAt,
        ...(record.reason === undefined ? {} : { reason: record.reason }),
      });
    case "dcaLadder":
      return JSON.stringify({
        kind: record.kind,
        id: record.id,
        positionId: record.positionId,
        effectiveAt: record.effectiveAt,
        tierOrder: record.tierOrder,
        rungs: record.rungs.map((rung) => ({
          id: rung.id,
          priceUsd: rung.priceUsd,
          sizeUsd: rung.sizeUsd,
        })),
      });
    case "dcaTime":
      return JSON.stringify({
        kind: record.kind,
        positionId: record.positionId,
        effectiveAt: record.effectiveAt,
        cadence: record.cadence,
        anchorAt: record.anchorAt,
        amountUsd: record.amountUsd,
        tierOrder: record.tierOrder,
      });
  }
}

/**
 * Append ONE plan line, genuinely and atomically.
 *
 * **The round-trip invariant is enforced here, not asserted in a comment.** The record
 * is serialized, parsed back, and run through `readPlanLine` — the LOADER'S OWN
 * reader — before a single byte reaches the disk. A record this function accepts is
 * therefore a record `loadPlans` reads back, by construction rather than by two lists
 * someone remembers to keep in sync. A rejection throws: an append-only file is the
 * one place where writing something unreadable is unrecoverable, so refusing loudly at
 * the call site is the cheap outcome.
 *
 * The durability mechanics (cross-process lock, unique temp sibling, torn-terminator
 * repair, atomic rename) live in `./sidecar-io.ts`, shared with `appendOrders`.
 * Appending after a final line that lacks its `\\n` REPAIRS that line rather than
 * concatenating onto it, so both records stay readable.
 */
export async function appendPlan(path: string, record: PlanRecord): Promise<void> {
  const serialized = serializePlanRecord(record);
  // THE ONE GUARD THIS ECHO CANNOT RUN IS THE ONE WHOSE VIOLATION IS PERMANENT. No
  // `claimedLadderIds` is passed — the writer has not read the file, so a uniqueness
  // verdict here would be invented — which means a `dcaLadder` line whose id collides
  // with one already on disk appends cleanly and then makes EVERY later `loadPlans`
  // refuse the file. Latent today: `appendNoPlan` is the sole wrapper and ladder lines
  // are hand-authored. A caller that starts appending ladders must read the sidecar and
  // check the id first; this function structurally cannot do it for them.
  const echo = readPlanLine(JSON.parse(serialized), 1);
  if (echo.status !== "ok") {
    throw new Error(
      `refusing to append a plan line this loader could not read back (${echo.skip.reason}): ` +
        `${echo.skip.detail}`,
    );
  }
  await appendSidecarLines(path, [serialized]);
}

/** What `appendNoPlan` needs, as ONE object — see the function's docstring. */
export interface NoPlanInput {
  positionId: string;
  effectiveAt: IsoDate;
  /** Free prose for the operator's own record. Optional. */
  reason?: string;
}

/**
 * Append the explicit TERMINATOR for one position: this plan is over.
 *
 * Pause and end are the same act — resumption is a later plan line — and the
 * terminator is not optional politeness: selection is "latest `effectiveAt ≤ asOf`",
 * so without one the last plan line stays in force forever.
 *
 * **It takes ONE OBJECT, and that is a deliberate refusal.** The positional form
 * `appendNoPlan(path, positionId, effectiveAt)` is two adjacent strings whose SWAP
 * TYPECHECKS — and the swapped call does not fail loudly, it writes a durable line
 * into an append-only file under a position id shaped like a date. Named fields make
 * the mistake unrepresentable rather than merely unlikely.
 */
export async function appendNoPlan(path: string, input: NoPlanInput): Promise<void> {
  await appendPlan(path, {
    kind: "noPlan",
    positionId: input.positionId,
    effectiveAt: input.effectiveAt,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
}

/** What an unattended caller must do about a load. */
export interface UnattendedPlansVerdict {
  /** `0` iff the file was read AND every line in it was readable. */
  exitCode: 0 | 1;
  /** Prose-only lines to print loudly. Never quotes the file. */
  messages: string[];
}

/**
 * The UNATTENDED-CALLER POLICY, as a value a test can assert instead of a convention
 * a reviewer must notice.
 *
 * The warrant is the daily-fetch script's own finding: *a launchd job's stderr goes to
 * an unread log — a "loud warning" reaches no one.* So `loadPlans` returns a typed
 * outcome and never throws, and the POLICY over that outcome is: warn loudly to the
 * terminal AND **exit non-zero** whenever the file could not be read or any line in it
 * was skipped. An exit code is a checked value; a warning is a thing someone must
 * happen to read.
 *
 * The counter-rule, equally load-bearing: a plans failure must never kill the NAV fold
 * or withhold a push. This policy binds the callers that exist to READ PLANS — the
 * desk command — and nothing else. The fold never reads `plans.jsonl` at all.
 */
export function unattendedPlansVerdict(loaded: LoadedPlans): UnattendedPlansVerdict {
  const messages: string[] = [];
  if (loaded.load.status === "load-failed") {
    messages.push(`plans.jsonl could not be read: ${loaded.load.message}`);
  }
  for (const skip of loaded.skipped) {
    messages.push(`plans.jsonl line ${skip.line} skipped (${skip.reason}): ${skip.detail}`);
  }
  return { exitCode: messages.length === 0 ? 0 : 1, messages };
}
