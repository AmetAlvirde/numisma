/**
 * THE DESK RENDERING of `plans.jsonl` — pure, IO-free, and the whole of what
 * `pnpm plans` decides. The shell around it (`plans-cli.ts`) reads three things — the
 * fold, the `plans.jsonl` sidecar and the `reconciliations.jsonl` trail — hands the
 * results here, prints one string and sets one exit code.
 *
 * WHY THIS SURFACE EXISTS AT ALL. The durability chain proves the sidecar is
 * COMMITTED — never that it parses, never which `positionId` a line attributed to,
 * never which of the five states it resolves to today. A plausible non-ISO stamp
 * (`"08/10/2026"`) is accepted by the operator's editor, commits green, and sorts
 * ahead of every ISO date in the file. Nothing before this module could tell anyone.
 *
 * TWO DISCIPLINES, both load-bearing rather than stylistic:
 *
 *   - **The exit code is the verdict.** It is taken from `unattendedPlansVerdict` and
 *     `unattendedReconciliationsVerdict` — the policies that already exist as values
 *     — and never re-derived here; this module only COMPOSES them, 1 if either is 1.
 *     A second copy of "what counts as a bad load" is a second answer waiting to
 *     drift, and the whole warrant for the policy is that a warning printed into an
 *     unread log reaches no one while a non-zero exit is a checked value.
 *   - **Diagnostics are PROSE ONLY.** Plan bodies carry the fund's figures, so a
 *     diagnostic that quoted a line would launder them into terminals and CI logs.
 *     The loader guarantees its `detail` never quotes the file, and this module adds
 *     no quoting of its own: it prints the line NUMBER so the operator can go look,
 *     the bucket, and the instruction the bucket carries.
 *
 * Figures in the PLAN BODIES are a different matter and render freely — the desk
 * already shows real positions, and a rung count an operator cannot read is a row
 * they cannot check their authored line against. Only diagnostics are prose-only.
 *
 * PURE, and the sidecar is never written. Nothing here or downstream writes any file
 * or touches git, and a plans failure never reaches the fold: the fold does not read
 * this file. The one write on the whole `pnpm plans` path is UPSTREAM of this module
 * and belongs to the event log — `loadEventLog`'s quarantine lane (see the
 * write-on-read invariant in `packages/event-store/README.md`).
 */
import {
  formatUsd,
  listPlansAsOf,
  pickReconciliationAsOf,
  type IsoDate,
  type LoadedPlans,
  type LoadedReconciliations,
  type PlanLookup,
  type ReconciliationVerdict,
} from "@numisma/engine";
import { unattendedPlansVerdict, unattendedReconciliationsVerdict } from "@numisma/preferences";

/** Everything the rendering reads. No clock, no filesystem, no enclosing scope. */
export interface PlansReportInput {
  loaded: LoadedPlans;
  /** The query date. Strict ISO — the selectors refuse anything else, loudly. */
  asOf: IsoDate;
  /**
   * The positions that EXIST as of `asOf`, supplied by the caller so the selector
   * stays pure and fold-type-free. This set is the only thing separating `pending`
   * against `active`.
   */
  existingPositionIds: ReadonlySet<string>;
  /** The resolved sidecar path, printed so the operator knows which file was read. */
  sourcePath: string;
  /**
   * The `reconciliations.jsonl` trail (D8, S4), which composes HERE rather than in
   * the engine's selector: this module already holds the plan lookup and the
   * existing-position set, so `pickPlanAsOf` grows no new input and stays pure and
   * fold-type-free.
   *
   * It is REQUIRED, not optional, and that is the ⚠️ enforced at the type level: an
   * optional trail would let a caller render `active` rows with no trail read at all
   * and no qualifier saying so — a clean-looking page that never asked. The trail's
   * own `load` arm carries `sourcePath`, so no second field is needed.
   */
  reconciliations: LoadedReconciliations;
}

/** The page and the verdict, as one value the shell prints and exits on. */
export interface PlansReport {
  /** Ready for one `stdout.write`. No trailing newline. */
  text: string;
  /** `0` iff the file loaded AND no line was skipped. From the policy, not from here. */
  exitCode: 0 | 1;
}

/** Widest state word, so the body columns line up under any mix of rows. */
const STATE_WIDTH = "unreadable".length;

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/**
 * What the operator checks their authored line by: the `effectiveAt` that WON the
 * selection, and enough of the body to recognize the plan they wrote.
 *
 * A `dcaLadder` renders its RUNG COUNT rather than its rungs — the count is the fact
 * the runbook has the operator confirm, and a rung table at the desk would be a
 * second renderer to keep honest for no extra assurance.
 */
function describeLookup(lookup: PlanLookup): string {
  switch (lookup.status) {
    case "none":
      return "— the sidecar names no line in force at this date";
    case "unreadable":
      return "— the newest line known for this position could not be read (see diagnostics)";
    case "ended":
      return `effective ${lookup.endedBy.effectiveAt}  noPlan — this plan is over`;
    case "pending":
    case "active": {
      const plan = lookup.plan;
      const body =
        plan.kind === "dcaLadder"
          ? `dcaLadder, ${plan.rungs.length} rung(s)`
          : `dcaTime, ${plan.cadence} ${formatUsd(plan.amountUsd)}, anchored ${plan.anchorAt}`;
      return `effective ${plan.effectiveAt}  ${body}`;
    }
  }
}

/**
 * D8 AT THE PIXEL — what the trail adds to an `active` row, and the one rule this
 * function exists to hold: **clean and unknown are never the same glyph.**
 *
 * A `clean` verdict prints NOTHING EXTRA — the row is already the plan row — and it
 * may do so precisely BECAUSE every unknown prints an explicit qualifier naming its
 * reason. Collapsing either direction of that rule is the defect the whole increment
 * exists to prevent: a missing or unreadable trail rendered as a plain `active` row
 * is false assurance, which is worse than not reading the trail at all.
 *
 * Four unknown reasons, four qualifiers, because each carries a DIFFERENT operator
 * instruction — the same taxonomy principle the loader's skip buckets state: the
 * buckets carry instructions, not parse stages.
 *
 * NO FIGURES. The marker names a mismatch kind and the FILL's own date, and never a
 * price, size, amount or balance — the trail carries none, and this is the surface
 * where one would be laundered into a terminal.
 */
function describeVerdict(verdict: ReconciliationVerdict): string {
  switch (verdict.status) {
    case "clean":
      return "";
    case "warned":
      // Loud, and it names the fill's `asOf` rather than its `toldAt`: the operator
      // is looking for the fill, not for the moment they were told about it.
      return `  !! FILL ${verdict.record.asOf} DISAGREED: ${verdict.mismatches.join(", ")}`;
    case "unknown":
      switch (verdict.reason) {
        case "no-trail":
          return "  ?? NO TRAIL — the file is not there; check the data dir, and whether this build records fills";
        case "no-line":
          return "  ?? NO TRAIL LINE — nothing names this position; the fill predates the trail, or its write failed (look for the stderr warn)";
        case "trail-unreadable":
          return "  ?? TRAIL UNREADABLE — the newest line known for this position could not be read; repair or supersede it (see diagnostics)";
        case "plans-were-unreadable":
          return "  ?? PLANS WERE UNREADABLE at fill time — the reconcile could not see the sidecar; re-run the check";
      }
  }
}

/**
 * Render the sidecar at one date, and say whether an unattended caller should be
 * unhappy about it.
 *
 * Rows are in the sidecar's own first-mention file order (`listPlansAsOf`), which is
 * the operator's reading order — the only order a page they are checking a file
 * against may take. Positions with no line at all are OMITTED rather than listed as
 * `none`: this page reports what the SIDECAR says, and the fold's roster is a
 * different question with a different surface.
 */
export function formatPlansReport(input: PlansReportInput): PlansReport {
  const { loaded, asOf, existingPositionIds, sourcePath, reconciliations } = input;
  const verdict = unattendedPlansVerdict(loaded);
  const trailVerdict = unattendedReconciliationsVerdict(reconciliations);
  const listing = listPlansAsOf(loaded, asOf, existingPositionIds);

  const lines: string[] = [
    `Plans — ${sourcePath}`,
    `Trail — ${reconciliations.load.sourcePath}`,
    `As of ${asOf}`,
    "",
  ];

  if (listing.positions.length === 0) {
    lines.push(
      loaded.load.status === "load-failed"
        ? "  (no rows — the file could not be read)"
        : "  (the sidecar names no position)",
    );
  } else {
    const idWidth = Math.max(...listing.positions.map((position) => position.positionId.length));
    for (const position of listing.positions) {
      // D8 scopes the annotation to `active` rows. A `pending` row names a position
      // that does not exist, so it has no fills and would carry `no-line` forever —
      // noise on every pending row, and noise is what stops a marker being read.
      const trail =
        position.lookup.status === "active"
          ? describeVerdict(pickReconciliationAsOf(reconciliations, position.positionId, asOf))
          : "";
      lines.push(
        `  ${pad(position.positionId, idWidth)}  ${pad(position.lookup.status, STATE_WIDTH)}  ` +
          describeLookup(position.lookup) +
          trail,
      );
    }
  }

  // FILE-GLOBAL, and reported as its own line rather than against any row. A skip
  // whose envelope was too broken to name a position belongs to NO position;
  // attaching it to one would turn a single broken line into a fund-wide blackout.
  lines.push("", `  unattributable line(s): ${listing.unattributable.length}`);

  // The trail's own file-global count, on the SAME rule and reported separately so
  // the two counts can never be read as one. The trail is machine-written, so a skip
  // here is a torn write rather than a typo — but it is still one line, and it turns
  // no position unknown.
  lines.push(
    `  unattributable trail line(s): ${
      reconciliations.skipped.filter((skip) => skip.positionId === undefined).length
    }`,
  );

  // The diagnostics, last, so they are the final thing on the terminal beside the
  // exit code — and prose from the loaders, printed verbatim, never re-decorated with
  // anything read off the disk. Both files' messages land in the one block: the
  // operator reads one page, and a trail message hidden behind a second heading they
  // do not scroll to is a message that reaches no one.
  const messages = [...verdict.messages, ...trailVerdict.messages];
  if (messages.length > 0) {
    lines.push("", "Diagnostics — prose only; no line of the file is ever printed.");
    for (const message of messages) {
      lines.push(`  ${message}`);
    }
  }

  // COMPOSED, and 0 only when BOTH policies are 0. Each verdict is taken from the
  // policy that already exists as a value and never re-derived here; an absent trail
  // is deliberately not a failure, because before the first recorded fill absence is
  // normal and a daily non-zero would cry wolf.
  const exitCode = verdict.exitCode === 1 || trailVerdict.exitCode === 1 ? 1 : 0;
  return { text: lines.join("\n"), exitCode };
}
