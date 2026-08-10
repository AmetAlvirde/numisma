/**
 * THE DESK RENDERING of `plans.jsonl` — pure, IO-free, and the whole of what
 * `pnpm plans` decides. The shell around it (`plans-cli.ts`) reads two files, hands
 * the results here, prints one string and sets one exit code.
 *
 * WHY THIS SURFACE EXISTS AT ALL. The durability chain proves the sidecar is
 * COMMITTED — never that it parses, never which `positionId` a line attributed to,
 * never which of the five states it resolves to today. A plausible non-ISO stamp
 * (`"08/10/2026"`) is accepted by the operator's editor, commits green, and sorts
 * ahead of every ISO date in the file. Nothing before this module could tell anyone.
 *
 * TWO DISCIPLINES, both load-bearing rather than stylistic:
 *
 *   - **The exit code is the verdict.** It is taken from `unattendedPlansVerdict` —
 *     the policy that already exists as a value — and never re-derived here. A
 *     second copy of "what counts as a bad load" is a second answer waiting to
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
 * and belongs to the event log — `loadEventLog`'s quarantine lane, named in
 * `plans-cli.ts`'s header.
 */
import { formatUsd, listPlansAsOf, type IsoDate, type LoadedPlans, type PlanLookup } from "@numisma/engine";
import { unattendedPlansVerdict } from "@numisma/preferences";

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
  const { loaded, asOf, existingPositionIds, sourcePath } = input;
  const verdict = unattendedPlansVerdict(loaded);
  const listing = listPlansAsOf(loaded, asOf, existingPositionIds);

  const lines: string[] = [`Plans — ${sourcePath}`, `As of ${asOf}`, ""];

  if (listing.positions.length === 0) {
    lines.push(
      loaded.load.status === "load-failed"
        ? "  (no rows — the file could not be read)"
        : "  (the sidecar names no position)",
    );
  } else {
    const idWidth = Math.max(...listing.positions.map((position) => position.positionId.length));
    for (const position of listing.positions) {
      lines.push(
        `  ${pad(position.positionId, idWidth)}  ${pad(position.lookup.status, STATE_WIDTH)}  ` +
          describeLookup(position.lookup),
      );
    }
  }

  // FILE-GLOBAL, and reported as its own line rather than against any row. A skip
  // whose envelope was too broken to name a position belongs to NO position;
  // attaching it to one would turn a single broken line into a fund-wide blackout.
  lines.push("", `  unattributable line(s): ${listing.unattributable.length}`);

  // The diagnostics, last, so they are the final thing on the terminal beside the
  // exit code — and prose from the loader, printed verbatim, never re-decorated with
  // anything read off the disk.
  if (verdict.messages.length > 0) {
    lines.push("", "Diagnostics — prose only; no line of the file is ever printed.");
    for (const message of verdict.messages) {
      lines.push(`  ${message}`);
    }
  }

  return { text: lines.join("\n"), exitCode: verdict.exitCode };
}
