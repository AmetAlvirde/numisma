/**
 * THE DESK SURFACE OVER `plans.jsonl` — the first thing in this repository that
 * READS the sidecar, and therefore the first thing that can tell an operator what
 * their hand-authored line actually resolved to.
 *
 * The durability chain proves the file is COMMITTED. It never proves the file
 * PARSES, which `positionId` a line attributed to, or which of the five states it
 * resolves to at today's date. A plausible non-ISO stamp commits green and selects
 * the wrong plan. These assertions are that gap closed at the one runnable call
 * site the increment ships.
 *
 * Three contracts, each locked separately below:
 *
 *   1. every one of the five `PlanLookup` states renders, and renders the facts the
 *      operator checks the line by — the state, the `effectiveAt` that was selected,
 *      and the rung count (`dcaLadder`) or cadence + anchor (`dcaTime`);
 *   2. the EXIT CODE contract — `0` iff the file loaded and no line was skipped —
 *      because an exit code is a checked value and a warning is not;
 *   3. diagnostics are PROSE ONLY. The last test runs a real fixture file through
 *      the real loader and asserts that no line of it appears in the output, so an
 *      implementation that interpolated the offending line would fail here.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "@numisma/engine";
import { loadPlans } from "@numisma/preferences";
import type { LoadedPlans, LoadedReconciliations, SkippedPlanLine } from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { formatPlansReport } from "./plans-report.js";

const AS_OF = "2026-08-10";
const SOURCE = "/tmp/synthetic/plans.jsonl";

/**
 * These tests are about the SIDECAR, so every one of them runs against a trail that
 * is not there — the state a checkout has before its first recorded fill. `absent` is
 * deliberately NOT an error, so it leaves the exit-code assertions below saying
 * exactly what they said before the trail existed. What the trail ADDS to a row is
 * asserted next door, in `plans-report-trail.test.ts`.
 */
const NO_TRAIL: LoadedReconciliations = {
  load: { status: "absent", sourcePath: "/tmp/synthetic/reconciliations.jsonl" },
  reconciliations: [],
  skipped: [],
};

/** A synthetic sidecar that resolves to all five states at {@link AS_OF}. */
function fiveStateFixture(): LoadedPlans {
  const skipped: SkippedPlanLine[] = [
    {
      line: 4,
      reason: "invalid",
      positionId: "pos-unreadable",
      effectiveAt: "2026-08-01",
      detail: "line is not a JSON object",
    },
    { line: 6, reason: "invalid", detail: "line is not JSON" },
  ];
  return {
    load: { status: "loaded", sourcePath: SOURCE },
    plans: [
      {
        kind: "dcaLadder",
        // A synthesized, obviously-fake ladder id: stable across runs, never generated
        // here, and never rendered by the report — the surface shows the position and
        // the ladder's declared content, never the join key.
        id: "00000000-0000-4000-8000-000000000001",
        positionId: "pos-pending",
        effectiveAt: "2026-08-09",
        tierOrder: ["c1", "c2"],
        rungs: [
          { id: "r1", priceUsd: 90_000, sizeUsd: 250 },
          { id: "r2", priceUsd: 85_000, sizeUsd: 250 },
          { id: "r3", priceUsd: 80_000, sizeUsd: 250 },
          { id: "r4", priceUsd: 75_000, sizeUsd: 250 },
        ],
        line: 1,
      },
      {
        kind: "dcaTime",
        positionId: "pos-active",
        effectiveAt: "2026-06-01",
        cadence: "weekly",
        anchorAt: "2026-06-01",
        amountUsd: 25,
        tierOrder: ["c1"],
        line: 2,
      },
      { kind: "noPlan", positionId: "pos-ended", effectiveAt: "2026-07-15", line: 3 },
      {
        kind: "dcaLadder",
        id: "00000000-0000-4000-8000-000000000002",
        positionId: "pos-future",
        effectiveAt: "2026-09-01",
        tierOrder: ["c1"],
        rungs: [{ id: "r1", priceUsd: 60_000, sizeUsd: 100 }],
        line: 5,
      },
    ],
    skipped,
  };
}

const EXISTING = new Set(["pos-active", "pos-ended"]);

/** The one row for `positionId`, so an assertion reads the row and not the page. */
function row(text: string, positionId: string): string {
  const found = text.split("\n").find((line) => line.trim().startsWith(positionId));
  expect(found, `no row rendered for ${positionId}`).toBeDefined();
  return found as string;
}

describe("the plans desk report", () => {
  it("renders all FIVE states from one synthetic sidecar", () => {
    const { text } = formatPlansReport({
      loaded: fiveStateFixture(),
      asOf: AS_OF,
      existingPositionIds: EXISTING,
      sourcePath: SOURCE,
      reconciliations: NO_TRAIL,
    });

    // pending — declared, not yet realized. The day-zero row, never `$0`.
    const pending = row(text, "pos-pending");
    expect(pending).toContain("pending");
    expect(pending).toContain("2026-08-09");
    expect(pending).toContain("4 rung");

    // active — the policy is IN FORCE, which is not a claim about activity.
    const active = row(text, "pos-active");
    expect(active).toContain("active");
    expect(active).toContain("2026-06-01");
    expect(active).toContain("weekly");

    // ended — the explicit terminator won the selection.
    const ended = row(text, "pos-ended");
    expect(ended).toContain("ended");
    expect(ended).toContain("2026-07-15");

    // unreadable — the newest in-window line for this position was skipped. Never
    // collapsed into `none`: "could not be read" is not "has no plan".
    expect(row(text, "pos-unreadable")).toContain("unreadable");

    // none — named by the file, but by a line that is not yet in window.
    expect(row(text, "pos-future")).toContain("none");

    // The file-global count, reported once and never smeared across the rows.
    // `toMatch(/unattributable[^\n]*1/)` also passed for 10, 11, 12, 21 — the count
    // is the assertion, so it is matched exactly.
    expect(text).toContain("unattributable line(s): 1");
  });

  it("distinguishes pending from active by BORN-NESS, not by the line", () => {
    // Same file, same date, one position now on the book: the only thing that may
    // move a row between those two arms.
    const loaded = fiveStateFixture();
    const { text } = formatPlansReport({
      loaded,
      asOf: AS_OF,
      existingPositionIds: new Set([...EXISTING, "pos-pending"]),
      sourcePath: SOURCE,
      reconciliations: NO_TRAIL,
    });
    expect(row(text, "pos-pending")).toContain("active");
  });

  describe("the exit-code contract", () => {
    it("exits 0 when the file loaded and every line was readable", () => {
      const loaded = fiveStateFixture();
      const { exitCode } = formatPlansReport({
        loaded: { ...loaded, skipped: [] },
        asOf: AS_OF,
        existingPositionIds: EXISTING,
        sourcePath: SOURCE,
        reconciliations: NO_TRAIL,
      });
      expect(exitCode).toBe(0);
    });

    it("exits 0 on an ABSENT sidecar — the normal starting state, not a failure", () => {
      const { exitCode, text } = formatPlansReport({
        loaded: { load: { status: "loaded", sourcePath: SOURCE }, plans: [], skipped: [] },
        asOf: AS_OF,
        existingPositionIds: new Set<string>(),
        sourcePath: SOURCE,
        reconciliations: NO_TRAIL,
      });
      expect(exitCode).toBe(0);
      expect(text).toContain(SOURCE);
    });

    it("exits NON-ZERO when any line was skipped, AFTER printing the diagnostics", () => {
      const report = formatPlansReport({
        loaded: fiveStateFixture(),
        asOf: AS_OF,
        existingPositionIds: EXISTING,
        sourcePath: SOURCE,
        reconciliations: NO_TRAIL,
      });
      expect(report.exitCode).not.toBe(0);
      // The diagnostics are in the rendered text, not merely implied by the code.
      expect(report.text).toContain("line 4");
      expect(report.text).toContain("line 6");
    });

    it("exits NON-ZERO when the whole file could not be read", () => {
      const report = formatPlansReport({
        loaded: {
          load: { status: "load-failed", sourcePath: SOURCE, message: "EACCES: permission denied" },
          plans: [],
          skipped: [],
        },
        asOf: AS_OF,
        existingPositionIds: EXISTING,
        sourcePath: SOURCE,
        reconciliations: NO_TRAIL,
      });
      expect(report.exitCode).not.toBe(0);
      expect(report.text).toMatch(/could not be read/);
    });
  });

  it("renders skips as PROSE — line number, bucket, instruction, and NO line content", async () => {
    // Through the REAL loader on a REAL file, because the property under test is
    // that nothing off the disk reaches the output. A hand-built `LoadedPlans` could
    // not fail an implementation that interpolated the raw line.
    const dir = await mkdtemp(join(tmpdir(), "numisma-plans-report-"));
    const path = join(dir, "plans.jsonl");
    const fixtureLines = [
      // A corrupt body carrying a distinctive synthetic figure.
      '{"kind":"dcaLadder","positionId":"pos-corrupt","effectiveAt":"2026-01-01",' +
        '"tierOrder":["c1"],"rungs":[{"id":"r1","priceUsd":0,"sizeUsd":424242.42}]}',
      // A kind this build does not know — the "pull" bucket, not a corruption claim.
      '{"kind":"dcaMegaLadderXYZZY","positionId":"pos-newer","effectiveAt":"2026-01-02"}',
      // Not JSON at all, and unattributable to any position.
      "{ this is not json at all, 987654.32 }",
    ];
    await writeFile(path, `${fixtureLines.join("\n")}\n`, "utf8");

    const loaded = await loadPlans(path);
    const { text, exitCode } = formatPlansReport({
      loaded,
      asOf: AS_OF,
      existingPositionIds: new Set<string>(),
      sourcePath: path,
      reconciliations: NO_TRAIL,
    });

    // Prose: the line NUMBER so the operator can go look, the BUCKET, and the
    // instruction the bucket carries.
    expect(text).toContain("line 1");
    expect(text).toContain("line 2");
    expect(text).toContain("line 3");
    expect(text).toContain("invalid");
    expect(text).toContain("unsupported");
    expect(text).toContain("pull");

    // And NOT the file. Whole lines first, then the individual figures and the
    // unrecognized kind token, none of which may be laundered into a terminal.
    for (const line of fixtureLines) {
      expect(text).not.toContain(line);
    }
    // Field NAMES may appear — the loader's `detail` is fixed prose that names the
    // field an operator must fix ("every rung needs a finite, positive priceUsd").
    // What may never appear is anything that came off the disk.
    for (const leak of ["424242.42", "987654.32", "dcaMegaLadderXYZZY"]) {
      expect(text).not.toContain(leak);
    }
    expect(exitCode).not.toBe(0);
  });
});

/**
 * THE RUNBOOK IS PART OF THE SLICE, so its load-bearing property is asserted rather
 * than remembered: its verification step reads the RENDERED OUTPUT and the EXIT
 * CODE, never the error channel. A runbook that told the operator to watch stderr
 * for a warning would re-introduce the exact failure the exit code exists to remove.
 *
 * The guard is on the INSTRUCTION, not on the word. `plans-cli.ts:65-67` really does
 * write the fold's discards to `process.stderr`, deliberately outside
 * `report.exitCode`, and the runbook is required to say what those lines are and that
 * they never move the verdict — that defends the same property. What it may never do
 * is send the operator to that channel to decide whether the run passed. The failure
 * shape is an instruction, not a location, so the assertion is not scoped to a
 * section.
 */
describe("the plans authoring runbook", () => {
  const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const RUNBOOK = join(REPO_ROOT, "docs", "plans-authoring-runbook.md");

  it("exists on the shelf beside the other runbooks", () => {
    expect(() => readFileSync(RUNBOOK, "utf8")).not.toThrow();
  });

  it("verifies by RENDERED OUTPUT and EXIT CODE, never by watching stderr", () => {
    const text = readFileSync(RUNBOOK, "utf8");
    expect(text).toContain("pnpm plans");
    expect(text).toMatch(/EXIT=0|exit(s)? 0/);
    // The durability half is confirmed by looking at git history, not by a warning.
    expect(text).toContain("git -C ~/Dev/<fund> log -- data/plans.jsonl");
    // No instruction anywhere to read the error channel for the verdict. Naming the
    // stderr lines is allowed — the shell really writes them — so match an instruction
    // verb bound to `stderr` inside one sentence, in either order, rather than the
    // bare word.
    const SENDS_THE_READER_TO_STDERR =
      /(?:watch|check|read|look at|inspect|monitor|scan|grep|tail|verify|confirm)[^.\n]{0,80}stderr|stderr[^.\n]{0,80}(?:to (?:check|confirm|verify|see|know|tell)|for the (?:verdict|warning|result|answer|error))/i;
    expect(text).not.toMatch(SENDS_THE_READER_TO_STDERR);
  });

  it("works the non-ISO date trap through, because a parse-based check misses it", () => {
    const text = readFileSync(RUNBOOK, "utf8");
    expect(text).toContain("08/10/2026");
    expect(text).toContain("string comparison");
  });
});

/**
 * SECTION 0 IS EXECUTED, NOT SPELL-CHECKED — and the distinction is the whole reason
 * this block exists. The precondition check shipped asking about a BARE `plans.jsonl`
 * evaluated at the `<fund>` repo root. The allowlist entry is `!/data/plans.jsonl`,
 * anchored at that root, so the bare path matches nothing, falls through to the
 * leading `*`, and reports `ignored=0` — which the page then reads back to the
 * operator as "the allowlist is still discarding the file" on a checkout that is
 * perfectly correct. It is the FIRST instruction in the FIRST runbook for a file that
 * does not exist yet, so it is read before it is doubted.
 *
 * The tests above could not catch it, because asserting that a page CONTAINS a command
 * says nothing about what that command RETURNS. So these lift BOTH HALVES of section 0's
 * command off the page — the `cd` target AND the path argument, parsed out of the one
 * fenced block section 0 actually carries, so they provably belong to the same command —
 * and run that pair against the real `<fund>` checkout, asserting the exit status the page
 * tells the operator to expect. The mismatch is the bug, so the pair is what is tested:
 * revert the path to the bare form and this goes red, and move the `cd` down into
 * `data/` while keeping the path and it goes red too.
 *
 * What this does NOT cover: the page writes `~/Dev/<fund>` as a documented PLACEHOLDER,
 * and these tests re-point that placeholder at the real checkout rather than expanding it,
 * so a wrong literal repo NAME on the page is out of reach here (nothing in the numisma
 * checkout knows the operator's repo name). The prose around the block — `echo`,
 * `# expect ignored=1`, the remediation paragraph — is read by the string assertions
 * above, not executed here. And only section 0's block is executed; the later `cd` lines
 * in sections 4 and 5 are prose to those tests.
 */
describe("the runbook's precondition check, actually run", () => {
  const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const RUNBOOK = join(REPO_ROOT, "docs", "plans-authoring-runbook.md");

  /** How the page spells the `<fund>` repo root — a placeholder, not a real path. */
  const FUND_ROOT_PLACEHOLDER = "~/Dev/<fund>";

  /**
   * `git check-ignore -q` reports its answer as an EXIT STATUS, and the polarity inverts
   * against every intuition: it exits 0 to say "yes, ignored". Section 0 wants the OTHER
   * one — it prints the raw `$?` and tells the operator to expect `ignored=1`, i.e. the
   * file is NOT discarded. Named both ways so neither this test nor its next reader can
   * quietly flip it.
   */
  const CHECK_IGNORE_STATUS = { pathIsIgnored: 0, pathIsNotIgnored: 1 } as const;

  /**
   * Section 0's fenced `sh` block, verbatim. Every argument these tests run is parsed out
   * of THIS ONE STRING, which is what makes the working directory and the path halves of
   * the command provably the same command — the bug being guarded was the two disagreeing.
   * There is a second `cd ~/Dev/<fund>` further down the page (section 4's append step),
   * so a bare search for the `cd` would be reading a different instruction.
   */
  function sectionZeroBlock(): string {
    const text = readFileSync(RUNBOOK, "utf8");
    const section = /^## 0\.[^\n]*\n([\s\S]*?)(?=^## )/m.exec(text);
    if (section === null) {
      throw new Error("the runbook no longer has a `## 0.` precondition section");
    }
    const block = /^```sh\n([\s\S]*?)^```/m.exec(section[1]!);
    if (block === null) {
      throw new Error("section 0 no longer carries a fenced `sh` block to run");
    }
    return block[1]!;
  }

  /**
   * The path argument section 0 hands to `git check-ignore`. Parsed rather than hardcoded:
   * a hardcoded copy is another string assertion, and would keep passing while the page
   * drifted away beneath it.
   */
  function pathUnderTest(): string {
    const command = /^git check-ignore [^\n]*?--\s+(\S+)/m.exec(sectionZeroBlock());
    if (command === null) {
      throw new Error("section 0's `git check-ignore` command is no longer in its block");
    }
    return command[1]!;
  }

  /**
   * The directory section 0 says to run the check IN, resolved against the real checkout.
   * The page's `cd` target is a placeholder path, so it is re-pointed rather than expanded:
   * the `~/Dev/<fund>` prefix becomes the real root and whatever the page appends to it is
   * appended here too. A page that said `cd ~/Dev/<fund>/data` therefore really does run
   * one directory down, which is how the directory half of the mismatch becomes visible.
   */
  function checkDirUnderTest(root: string): string {
    const cd = /^cd\s+(\S+)/m.exec(sectionZeroBlock());
    if (cd === null) {
      throw new Error("section 0's block no longer says which directory to run the check in");
    }
    const target = cd[1]!;
    expect(
      target.startsWith(FUND_ROOT_PLACEHOLDER),
      `section 0 cd's to \`${target}\`, which is not under the page's own ` +
        `${FUND_ROOT_PLACEHOLDER} placeholder`,
    ).toBe(true);
    return join(root, target.slice(FUND_ROOT_PLACEHOLDER.length));
  }

  /**
   * `~/Dev/<fund>` — the real repo root, which is the PARENT of the data dir. Evaluating at
   * the root is exactly what makes the leading `/` in `!/data/plans.jsonl` bite, which is
   * why the page's own `cd` is asserted to land here and nowhere else.
   *
   * accumulus is a separate private repo (ADR-006) a fresh numisma clone will not have,
   * so this skips with a stated reason instead of going flaky, matching
   * `durable-log-guards.test.ts`.
   */
  function fundRepoRoot(): string | undefined {
    const dataDir = resolveDataDir();
    if (!existsSync(dataDir)) {
      return undefined;
    }
    const root = dirname(dataDir);
    const inRepo = spawnSync("git", ["-C", root, "rev-parse", "--git-dir"], { encoding: "utf8" });
    return inRepo.status === 0 ? root : undefined;
  }

  const root = fundRepoRoot();

  it("asks about the path the allowlist entry is anchored at", () => {
    // Independent of any checkout: `!/data/plans.jsonl` is root-anchored, so the only
    // path that can ever match it is the one carrying the `data/` prefix.
    expect(pathUnderTest()).toBe("data/plans.jsonl");
  });

  it.skipIf(root === undefined)(
    "runs the check from the repo ROOT the root-anchored allowlist entry is relative to",
    () => {
      // `--show-prefix` is the path of the cwd BELOW the repo root, so the empty string is
      // the root itself. Any other value means the page walks the operator somewhere the
      // relative path argument means something else.
      const dir = checkDirUnderTest(root!);
      const prefix = spawnSync("git", ["-C", dir, "rev-parse", "--show-prefix"], {
        encoding: "utf8",
      });
      expect(
        prefix.status,
        `git could not read \`${dir}\`, the directory section 0 cd's into: ${prefix.stderr}`,
      ).toBe(0);
      expect(
        prefix.stdout.trim(),
        "section 0 cd's BELOW the `<fund>` repo root, so its relative path argument no " +
          "longer names the file the root-anchored allowlist entry names",
      ).toBe("");
    },
  );

  it.skipIf(root === undefined)(
    "reports the file as NOT ignored — the `ignored=1` section 0 tells the operator to expect",
    () => {
      const status = spawnSync("git", [
        "-C",
        checkDirUnderTest(root!),
        "check-ignore",
        "-q",
        "--no-index",
        "--",
        pathUnderTest(),
      ]).status;
      expect(
        status,
        `section 0's directory + path pair reports the durable file as IGNORED (status ` +
          `${String(status)}); the page would tell the operator that a correctly ` +
          `allowlisted checkout is discarding it`,
      ).toBe(CHECK_IGNORE_STATUS.pathIsNotIgnored);
    },
  );
});
