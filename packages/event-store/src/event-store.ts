/**
 * The durable log's READ path — lifted verbatim out of `apps/tui/src/event-store.ts`
 * so both runnable surfaces can fold the same log. The TUI reads it to render; the
 * web push reads it to publish. ADR-001 keeps this file IO OUT of `@numisma/engine`
 * (which stays I/O-free); the pure fold + event validation live there
 * (`foldEvents` / `parseEvent`), and this package is the thin IO shell around them.
 *
 * Deliberately app-free: plain `node:fs`, no Bun, no terminal, no git, no argv. The
 * write half (inbox ingest, atomic append, archival, the one-shot legacy migration,
 * git capture) stays in the TUI app.
 *
 * Durable truth on disk this path reads:
 *   - data/genesis.json            immutable t0 seed (a FundReviewData shape)
 *   - data/events.jsonl            append-only log, one JSON event per line
 *   - data/events.jsonl.quarantine the lane for surfaced corrupt log lines
 *
 * DURABILITY (reliable conversion, ADR-003 slice 3):
 *   - A corrupt log line is quarantined to a side lane and surfaced; the rest of
 *     the log still loads. The fold path then refuses to run on a partial log.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  INBOX_PATH_SEGMENTS,
  dedupeFoldSkips,
  foldEvents,
  normalizeDataDirOverride,
  parseEvent,
  parseFundReview,
  resolveDataDir,
  type FoldedReview,
  type FundReviewData,
  type PortfolioEvent,
} from "@numisma/engine";

export interface EventStorePaths {
  genesis: string;
  log: string;
  inbox: string;
  ingestedDir: string;
}

/** A log line that failed to parse, diverted to the quarantine lane on read. */
export interface QuarantinedLine {
  lineNumber: number;
  line: string;
  reason: string;
}

/** The result of reading the append-only log: the good events plus any corrupt
 * lines that were quarantined rather than aborting the load. */
export interface EventLogLoad {
  events: PortfolioEvent[];
  quarantined: QuarantinedLine[];
}

/**
 * Resolve the default dataDir root honoring the `NUMISMA_DATA_DIR` env var — the
 * SINGLE knob that moves EVERY plane. The resolution rule (env override with an
 * absolute, homedir-derived accumulus default; relative values rejected) is the
 * pure engine `resolveDataDir`; this thin wrapper keeps the public name the tui
 * callers already use.
 */
export function resolveDataDirDefault(): string {
  return resolveDataDir();
}

/** The quarantine lane sits beside the log it shadows. */
export function quarantineLogPath(logPath: string): string {
  return `${logPath}.quarantine`;
}

/**
 * Resolve every on-disk location of one event store from its root.
 *
 * No `dataDir` → the shared `resolveDataDirDefault()`. A PRESENT `dataDir` goes through
 * the shared `normalizeDataDirOverride` (#369) — blank refused, `~` expanded, absolute
 * normalized, relative refused — the same predicate the engine's env knob and the
 * sidecar / preferences / price-feed doors use, so no door can be softer than another.
 * Until #369 this one accepted a bare `"data"` and produced `<cwd>/data/events.jsonl`.
 *
 * The `undefined` arm is written as an explicit check rather than as a default PARAMETER
 * because a JS default fires on `undefined` and on nothing else: `""` used to sail past
 * it into `resolve("")`, which is the process's CWD. That is the arm ADR-006 exists to
 * forbid, and it is worst here of anywhere — this resolver owns `genesis.json` and the
 * append-only `events.jsonl`, so a caller that got its env expansion wrong would not read
 * a stale ledger, it would find NO ledger, seed a second one beside whatever directory
 * the job started in, and append to that. `undefined` means nobody configured this and
 * takes the default; `""` means somebody configured it and got it wrong, which is not a
 * thing to guess at.
 */
export function resolveEventStorePaths(dataDir?: string): EventStorePaths {
  const base =
    dataDir === undefined
      ? resolveDataDirDefault()
      : normalizeDataDirOverride(dataDir, {
          subject: "an event-store data directory",
          blankHeadline: "an event-store data directory must not be empty",
          blankConsequence:
            "resolving it would land on the process's working directory and seed a " +
            "SECOND genesis and event log there, splitting the ledger away from the real one.",
          blankRemedy: "Pass no data directory at all to use the default deliberately",
        });
  return {
    genesis: join(base, "genesis.json"),
    log: join(base, "events.jsonl"),
    inbox: join(base, ...INBOX_PATH_SEGMENTS),
    ingestedDir: join(base, "ingested"),
  };
}

/** Read and structurally validate the immutable genesis seed. */
export async function loadGenesis(genesisPath: string): Promise<FundReviewData> {
  const raw = await readFile(genesisPath, "utf8");
  const parsed = parseFundReview(raw);
  if (parsed.kind !== "ok") {
    throw new Error(`Genesis seed failed validation (${parsed.kind}) at ${genesisPath}.`);
  }
  return parsed.value;
}

/**
 * Read the append-only log, validating each line into a typed event. A line that
 * fails to parse is diverted to the quarantine lane (returned, and surfaced to a
 * durable `events.jsonl.quarantine` sidecar) instead of aborting the load, so a
 * single corrupt line degrades gracefully rather than bricking startup. The rest
 * of the log still loads. The log file itself is never mutated on read. See the
 * write-on-read invariant in `packages/event-store/README.md`.
 */
export async function loadEventLog(logPath: string): Promise<EventLogLoad> {
  const raw = await readOptional(logPath);
  const events: PortfolioEvent[] = [];
  const quarantined: QuarantinedLine[] = [];
  if (raw !== undefined) {
    for (const [index, line] of raw.split("\n").entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parsed = parseLogLine(trimmed);
      if (parsed.ok) {
        events.push(parsed.event);
      } else {
        quarantined.push({ lineNumber: index + 1, line: trimmed, reason: parsed.reason });
      }
    }
  }
  await surfaceQuarantine(logPath, quarantined);
  return { events, quarantined };
}

/**
 * Fail loud when the durable log holds any line that would not load. A dropped
 * material event (a legacy-shape open/close, or any unparseable line) silently
 * skews the fold — a plausible-but-wrong NAV, the exact drift class this MVI
 * eliminates — so the fold/ingest paths refuse to run on a partial log rather than
 * degrade gracefully. The quarantine sidecar has already been written by
 * {@link loadEventLog}, so the operator can see every offending line and reason; a
 * legacy open/close is additionally pointed at the one-shot migration. This is the
 * ADR-003 amendment's migration/versioning contract enforced at the read boundary
 * (it reverses the prototype's "a corrupt line degrades gracefully" behavior).
 * `foldEvents` itself stays a pure projection — the loud stop lives here, not in the
 * fold.
 *
 * Exported because the TUI's `ingestInbox` guards its read of the existing log with
 * exactly this assertion; the package owns the single definition.
 */
export function assertLogFullyLoaded(load: EventLogLoad, logPath: string): void {
  if (load.quarantined.length === 0) {
    return;
  }
  const detail = load.quarantined
    .map((entry) => `  line ${entry.lineNumber}: ${entry.reason}`)
    .join("\n");
  throw new Error(
    `Durable log ${logPath} has ${load.quarantined.length} unloadable line(s); refusing to ` +
      `fold a partial log (it would silently skew NAV). Fix or migrate them, then retry. ` +
      `Details also written to ${quarantineLogPath(logPath)}:\n${detail}`,
  );
}

type ParsedLine =
  | { ok: true; event: PortfolioEvent }
  | { ok: false; reason: string };

function parseLogLine(line: string): ParsedLine {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  const result = parseEvent(json);
  if (result.kind !== "ok") {
    return { ok: false, reason: `${result.path}: ${result.message}` };
  }
  return { ok: true, event: result.value };
}

/**
 * Write the corrupt lines to the quarantine lane (one JSON record per line) so the
 * bad input is durably surfaced for the user to fix; remove a stale lane when the
 * log reads clean, so a fixed log self-heals. Idempotent: the lane reflects exactly
 * the current read, so repeated reads in one startup converge on the same content.
 */
async function surfaceQuarantine(logPath: string, quarantined: QuarantinedLine[]): Promise<void> {
  const lanePath = quarantineLogPath(logPath);
  if (quarantined.length === 0) {
    await rm(lanePath, { force: true });
    return;
  }
  await mkdir(dirname(logPath), { recursive: true });
  const body = `${quarantined.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await writeFile(lanePath, body, "utf8");
}

/**
 * Load genesis + the durable log, assert the log fully loaded, then fold to `asOf`
 * (or current state) for rendering. A pure READ: it does NOT ingest — the inbox is
 * never consulted. See the write-on-read invariant in
 * `packages/event-store/README.md` for what `loadEventLog` does write.
 *
 * THE REFUSE/REPORT PAIR — the shell's whole epistemic split, and the reason this
 * function is worth reading before touching either half:
 *
 *  - **Refuse what could not be read.** {@link assertLogFullyLoaded} throws on a
 *    quarantined line, so a partial log never becomes a fold. That failure is
 *    REMEDIABLE: the operator fixes or migrates the line and the next run is clean,
 *    so refusing is an errand that extinguishes itself.
 *  - **Report what was read and then dropped.** `foldEvents` returns
 *    {@link FoldedReview} — `{data, skipped}` — and every event it read but could not
 *    apply (a verb naming a position or reserve it has no record of) rides out in
 *    `skipped`. That fact is IMMUTABLE: the locator points into an append-only durable
 *    log, so there is no line to fix and the report never extinguishes. Refusing on it
 *    would brick every future read over one damaged historical event.
 *
 * That pair IS the Discard Channel's remediable/immutable distinction rendered in code
 * (ADR-020's clause 3, `context/adr/ADR-020-the-discard-channel-report-never-refuse.md`;
 * PRD #323 seam B, implementing #293).
 *
 * IT RETURNS THE ENVELOPE AND UNWRAPS NOTHING. Returning `.data` here would reproduce
 * #293 exactly one layer up — the caller would again hold a `FundReviewData`
 * indistinguishable from one folded off a complete log. THE SHELL IS A PIPE, NOT A
 * FILTER: it adds, removes and reorders nothing in `skipped`. And there is deliberately
 * no `loadFoldedReviewWithDiscards` beside a bare-data original: a side channel a caller
 * must remember to ask for is the failure mode ADR-020 rules out (PRD #323 R4).
 */
export async function loadFoldedReview(
  paths: EventStorePaths,
  asOf?: string,
): Promise<FoldedReview> {
  const genesis = await loadGenesis(paths.genesis);
  const load = await loadEventLog(paths.log);
  assertLogFullyLoaded(load, paths.log);
  return foldEvents(genesis, load.events, asOf);
}

/**
 * THE FOLD'S CLAUSE-4 VERDICT — the policy over {@link FoldedReview}, as a value a test
 * can assert (ADR-020, clause 4: the component reports, the caller decides).
 *
 * IT HAS NO `exitCode` MEMBER, AND THE ABSENCE IS THE POINT. `UnattendedPlansVerdict`
 * and `unattendedPreferencesVerdict` both carry one, because a malformed sidecar line is
 * an ERRAND: the operator edits the line and the next run is clean, so a checked value
 * that goes red and then goes green again is the honest signal. A fold discard is a
 * STANDING FACT — its locator points into an append-only durable log, so there is no
 * line to fix and the report never extinguishes (ADR-020's clause 3; spec #323 §3).
 * Folding it into an exit code would leave the errand channel permanently red from the
 * night the damaged event was written, which retires that channel for the next REAL
 * failure. `gap-report-core.ts` settled the identical trade-off in the identical words:
 * *a lost day is reported; a broken job is failed*, because a permanently red job is one
 * nobody reads.
 *
 * So the type itself makes "the exit code is the verdict" INEXPRESSIBLE here. Do not add
 * the member back; a consumer that wants a non-zero exit for a fold discard is asking
 * for something this increment ruled out, not for a field.
 */
export interface UnattendedFoldVerdict {
  /** Prose for the run's operator channel. Empty on a clean fold. */
  messages: string[];
}

/**
 * The fold discard summary, as it reaches an UNATTENDED surface: at most ONE line,
 * carrying a COUNT and nothing else that varies.
 *
 * ONE LINE, NEVER AN ENUMERATION — a ruling that binds future edits, not a threshold
 * (spec #323 R7). This line prints from launchd every evening, forever. An enumeration
 * is three lines today and forty in a year on the only channel that is genuinely read
 * daily, and PR #322's `formatGapReport` starvation finding is that same failure one
 * surface over: the transient, recurring kind fills the surface and the permanent
 * finding beside it is never seen again. A count is stable, cannot grow, and cannot
 * starve a co-tenant. The ENUMERATION exists — {@link formatFoldDiscards} — and its home
 * is the interactive surfaces, where a human is at the keyboard and asked to see it.
 *
 * IT NAMES NO EVENT CONTENT. No id, no verb, no target, no figure: the count is the only
 * thing that varies between two runs of this line. Ids are locators and belong on the
 * enumeration; a figure on a daily-printed channel is a fund detail laundered into log
 * files and CI output (ADR-020 clause 3).
 *
 * DEDUPED THROUGH THE ENGINE'S OWN `dedupeFoldSkips` — never a local re-derivation of
 * the (`eventId`, `reason`) key. One definition of "a distinct finding" is what keeps
 * this line, the interactive enumeration, `walkPendingInbox` and the head digest's
 * `discardedEventCount` reporting the SAME number for the same log; two definitions
 * would let a future sharpening of the key move some of them and not others, and the
 * halves would still pass their own tests.
 *
 * IT IS A RUN'S COUNT AND NOT A LOOP'S. The backfill folds once per anchor and re-reads the same log each time, so a
 * ten-anchor replay rediscovers one damaged event ten times; the shell concatenates
 * every anchor's `skipped` and calls this ONCE, and the dedup is what turns that into
 * "one event was dropped". `RunReport`'s own dedup cannot do it — two anchors legitimately
 * produce two DIFFERENT counts, so it would keep both lines. (Extends spec #320 seam D's
 * once-per-run ruling to this channel.)
 *
 * The parameter is `Pick<FoldedReview, "skipped">` rather than the whole envelope for
 * exactly that caller: the union of N anchors' skips is not any one anchor's `data`, and
 * requiring one would force a shell to nominate an arbitrary fold to carry a verdict
 * about all of them. A `FoldedReview` is assignable, so the ordinary call is unchanged.
 */
export function unattendedFoldVerdict(
  folded: Pick<FoldedReview, "skipped">,
): UnattendedFoldVerdict {
  const distinct = dedupeFoldSkips(folded.skipped);
  if (distinct.length === 0) {
    // A CLEAN FOLD SAYS NOTHING, so the daily run's output is byte-identical to the one
    // before this channel existed. Silence here is what buys the line its meaning.
    return { messages: [] };
  }
  return {
    messages: [
      `fold: ${distinct.length} event(s) were read from the durable log and could not be ` +
        `applied, so the fold's totals omit them. The log is append-only, so this is a ` +
        `standing fact about history and not a failure of this run — run \`pnpm report\` ` +
        `to see each dropped event's id, index, verb and reason.`,
    ],
  };
}

/**
 * The most fold-discard lines {@link formatFoldDiscards} renders before it summarizes
 * the rest.
 *
 * PER KIND, AND THAT IS THE WHOLE MECHANISM (ADR-020, "the kind and its reserved
 * capacity"). This bound is computed over the fold's lines ALONE — never over a
 * concatenation with whatever else a surface prints — so no co-tenant diagnostic can
 * take the fold's share and the fold cannot take a co-tenant's. It is the same shape as
 * `RunReport`'s `MAX_LINES_PER_KIND` and `gap-lines.ts`'s reserved floor, and it exists
 * for the same reason both do: a bounded surface that slices a concatenation withholds
 * whichever kind sorts last, forever.
 *
 * Exported so the test DRIVES the bound rather than restating it.
 */
export const MAX_FOLD_DISCARD_LINES = 12;

/**
 * THE ENUMERATION, for a surface with a human at the keyboard: one line per distinct
 * dropped event, carrying its LOCATOR (`eventId` + `index`), its VERB and its REASON.
 *
 * THE OPPOSITE TRADE-OFF FROM {@link unattendedFoldVerdict}, deliberately. The
 * unattended line is a count because it prints unasked, daily, forever. These lines
 * print when an operator ran `pnpm report`, `pnpm spine` or `pnpm plans` — they are the
 * answer to a question just asked, and a count would be an answer that cannot be acted
 * on. The id is greppable in `events.jsonl`, which is the whole reason the locator is an
 * id and an index rather than a line number: the log is append-only, so a line number
 * would rot and an id will not.
 *
 * BOUNDED, WITH THE TRUNCATION ANNOUNCED. A bound that renders as an all-clear is the
 * same defect wearing a cap, so the withheld count gets its own line under this kind's
 * own name. `detail` is fixed prose off the closed reason vocabulary and quotes nothing.
 */
export function formatFoldDiscards(
  folded: Pick<FoldedReview, "skipped">,
  limit: number = MAX_FOLD_DISCARD_LINES,
): string[] {
  const distinct = dedupeFoldSkips(folded.skipped);
  if (distinct.length === 0) {
    // EMPTY MEANS CLEAN — the caller stays quiet, exactly as `formatGapReport` does, and
    // that is what bounds the noise by construction on every surface this feeds.
    return [];
  }
  const shown = distinct.slice(0, limit);
  const lines = shown.map(
    (skip) =>
      `Numisma: DROPPED EVENT ${skip.eventId} (index ${skip.index}) — ${skip.verb}, ` +
      `${skip.reason}. ${skip.detail}`,
  );
  const withheld = distinct.length - shown.length;
  if (withheld > 0) {
    lines.push(
      `Numisma: …and ${withheld} further dropped event(s) not shown ` +
        `(fold cap ${limit}).`,
    );
  }
  return lines;
}

/**
 * Read a file that may not exist, mapping ENOENT to `undefined` and rethrowing every
 * other IO error.
 *
 * THE CANONICAL DEFINITION — the one other packages import. The TUI's ingest and
 * migration paths read the inbox and the log through it (`apps/tui/src/event-store.ts`,
 * `record-fill-cli.ts`), and the price feed reads its own INBOX through it
 * (`apps/price-feed/src/inbox.ts`) — a file this package never touches, which is fine:
 * the helper carries no log-specific policy, only "ENOENT means absent".
 *
 * IT IS NOT THE ONLY DEFINITION REPO-WIDE, DELIBERATELY. `@numisma/preferences` keeps a
 * private copy rather than take a dependency on this package; the reasoning lives beside
 * that copy (`packages/preferences/src/orders.ts`, #198). Do not "fix" the duplication by
 * pointing that module here.
 */
export async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
