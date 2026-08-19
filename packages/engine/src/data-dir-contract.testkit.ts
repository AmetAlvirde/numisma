/**
 * The ONE input→outcome table for ADR-006's `dataDir` rule, and the driver that runs it
 * against a door (TEST INPUT ONLY).
 *
 * #369's defect was not that a resolver was wrong. It was that FIVE doors each carried a
 * hand-written copy of one contract, and two of them had already drifted apart from the
 * other three on two of the table's inputs — silently, because nothing exercised the same
 * inputs against all of them. `normalizeDataDirOverride` collapsed the five predicates
 * into one; this collapses the five test suites' overlapping coverage into one table, so
 * the fix cannot be half-undone by a one-sided edit. A door that stops routing through the
 * shared predicate fails HERE, in its own package, naming the input it disagreed on.
 *
 * A table alone would not have caught the original drift — the four packages could each
 * have kept their own copy of it, which is exactly what they had. What makes this load-
 * bearing is that there is ONE copy, imported: `@numisma/engine/testkit`. Every package
 * with a door already depends on `@numisma/engine`, so no new dependency edge is drawn to
 * get it, and the doors live in four different packages precisely because no single
 * package can import all five (the dependency graph forbids it, correctly).
 *
 * Doors report their ROOT, not their final path — `dirname(…)` on the door's side. The
 * table is about the data root and nothing else; which leaf a door appends
 * (`events.jsonl`, `preferences.jsonl`, `orders.jsonl`) is that door's own business and
 * is already pinned by its own suite.
 *
 * NO `/Users/...` LITERAL APPEARS HERE, and none may. `~` expectations are computed from
 * `os.homedir()` at runtime — ADR-006 forbids the hardcoded form, and a committed one
 * would publish the operator's real directory layout in a public repo.
 *
 * Coverage-excluded by `vitest.config.ts`'s `.testkit.ts` glob: it is exercised by the
 * tests that import it, not product code to measure.
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** One row of the table: an input, and the outcome EVERY door must produce for it. */
export type DataDirContractCase =
  | {
      input: string;
      outcome: "throws-blank";
      /** Why this row exists — read by whoever it fails on. */
      why: string;
    }
  | { input: string; outcome: "throws-relative"; why: string }
  | {
      input: string;
      outcome: "root";
      /** The root every door must land on, computed at runtime — never a literal. */
      root: () => string;
      why: string;
    };

/**
 * The table. Every door must agree on every row.
 *
 * The `undefined` row is deliberately NOT here — it is the one input whose correct answer
 * genuinely differs per door (the engine's is the accumulus root; the three delegating
 * doors' is `resolveDataDir()`; price-feed's argument is required and has no `undefined`
 * arm at all). It is driven separately, per door, by `defaultArm` below.
 */
export const DATA_DIR_CONTRACT_CASES: readonly DataDirContractCase[] = [
  {
    input: "",
    outcome: "throws-blank",
    why: "the value an unset shell variable expands to (#348) — a MISCONFIGURED knob, not an absent one",
  },
  {
    input: "   ",
    outcome: "throws-blank",
    why: "blank's most common spelling; `resolve(\"   \")` makes a directory NAMED three spaces, which `=== \"\"` waves through",
  },
  {
    input: "\t\n",
    outcome: "throws-blank",
    why: "the other whitespace spelling",
  },
  {
    input: "~",
    outcome: "root",
    root: () => resolve(homedir()),
    why: "a bare tilde is the home directory itself",
  },
  {
    input: "~/scratch",
    outcome: "root",
    root: () => resolve(join(homedir(), "scratch")),
    why: "#369's ruling: `~` expands at EVERY door, not only at the env knob — it is absolute and homedir-derived, ADR-006's invariant verbatim. Three doors used to produce `<cwd>/~/scratch`, a directory literally named `~`",
  },
  {
    input: "~/scratch/nested",
    outcome: "root",
    root: () => resolve(join(homedir(), "scratch", "nested")),
    why: "expansion is of the leading segment only; the rest of the path rides along",
  },
  {
    input: "~scratch",
    outcome: "throws-relative",
    why: "`~user` (another user's home) is NOT supported syntax — it must be REFUSED, not silently become `<cwd>/~scratch`. The tilde arm is `~` or `~/`, nothing else",
  },
  {
    input: "/tmp/numisma-authored-contract-root",
    outcome: "root",
    root: () => resolve("/tmp/numisma-authored-contract-root"),
    why: "the ordinary accepted case — without it, a door that threw on EVERYTHING would pass every refusal row above",
  },
  {
    input: "/tmp/numisma authored contract root",
    outcome: "root",
    root: () => resolve("/tmp/numisma authored contract root"),
    why: "the predicate is `trim() === \"\"`, not \"has no spaces\" — a real macOS path carries spaces, and refusing those would be a new bug wearing this fix's clothes",
  },
  {
    input: "  /tmp/numisma-authored-contract-root  ",
    outcome: "root",
    root: () => resolve("/tmp/numisma-authored-contract-root"),
    why: "surrounding whitespace is trimmed, so a padded env value resolves to the same store as the bare one rather than to a sibling",
  },
  {
    input: "/tmp/numisma-authored-contract-root/../numisma-authored-contract-root",
    outcome: "root",
    root: () => resolve("/tmp/numisma-authored-contract-root"),
    why: "an absolute path is NORMALIZED, so two spellings of one directory cannot become two stores",
  },
  {
    input: "data",
    outcome: "throws-relative",
    why: "#369's headline case: `pnpm prices:fetch` (CWD = repo root) and a package script (CWD = package dir) would land on two different stores. Two doors used to produce `<cwd>/data` silently",
  },
  {
    input: "./data",
    outcome: "throws-relative",
    why: "the explicitly-relative spelling — same hazard, and the one an author is likeliest to think is safe",
  },
  {
    input: "../data",
    outcome: "throws-relative",
    why: "escaping upward is still CWD-anchored, so it splits the same way",
  },
];

/** A data-dir door: anything that turns a caller-supplied value into a data ROOT. */
export interface DataDirDoor {
  /** How the door is named when a row fails on it. */
  name: string;
  /** Resolve a PRESENT value to its data ROOT (the door strips its own leaf). */
  root(dataDir: string): string;
  /**
   * The door's own voice, so the shared predicate is proven NOT to have flattened the
   * per-door error messages #348 deliberately wrote (a Reserve floor served from a file
   * nothing writes, vs a SECOND genesis seeded beside the job's CWD).
   */
  subject: RegExp;
  /**
   * The `undefined` arm, when the door has one: what it resolves to with nothing
   * configured, and what that must equal. Absent for `resolvePriceFeedPaths`, whose
   * `dataDir` is REQUIRED — it has no default to fall through to, by design.
   */
  defaultArm?: { actual: () => string; expected: () => string };
}

/**
 * Run the whole table against one door. Call it from the door's own package.
 *
 * Pure path algebra throughout — no row touches a filesystem, so no case here can reach
 * a real data dir.
 */
export function assertDataDirContract(door: DataDirDoor): void {
  describe(`${door.name} — the shared dataDir contract table (#369)`, () => {
    for (const testCase of DATA_DIR_CONTRACT_CASES) {
      it(`${JSON.stringify(testCase.input)} → ${testCase.outcome} — ${testCase.why}`, () => {
        if (testCase.outcome === "root") {
          expect(door.root(testCase.input)).toBe(testCase.root());
          return;
        }

        // A door that RETURNS a path where the table says refuse must fail with the
        // offending path in the message, not with a bare "expected a throw" that leaves
        // the reader to work out which wrong store it just pointed at.
        let produced: string | undefined;
        try {
          produced = door.root(testCase.input);
        } catch {
          produced = undefined;
        }
        expect(
          produced,
          `${door.name} must REFUSE ${JSON.stringify(testCase.input)} rather than resolve it`,
        ).toBeUndefined();

        // And the refusal must be this door's own, not some incidental downstream error.
        expect(() => door.root(testCase.input)).toThrow(door.subject);
        expect(() => door.root(testCase.input)).toThrow(
          testCase.outcome === "throws-blank"
            ? /must not be empty|set to an empty value/
            : /absolute path or start with "~\/"/,
        );
      });
    }

    it("never resolves against the process CWD — the whole point of the table", () => {
      // The refusal rows above are each asserted individually; this is the class-level
      // statement, and it names the two paths #369 measured coming out of the permissive
      // doors so a regression reads as itself rather than as a generic mismatch.
      for (const forbidden of [process.cwd(), join(process.cwd(), "data")]) {
        for (const testCase of DATA_DIR_CONTRACT_CASES) {
          let produced: string | undefined;
          try {
            produced = door.root(testCase.input);
          } catch {
            continue;
          }
          expect(
            produced,
            `${door.name}(${JSON.stringify(testCase.input)}) resolved to a CWD-derived root (${forbidden})`,
          ).not.toBe(forbidden);
        }
      }
    });

    const defaultArm = door.defaultArm;
    if (defaultArm === undefined) {
      it("has no `undefined` arm — its dataDir is REQUIRED, by design", () => {
        // Not a skipped row: the ABSENCE is the contract. `resolvePriceFeedPaths` takes a
        // required argument precisely so there is no default for a caller to fall into,
        // and this asserts the table knows that rather than having forgotten the door.
        expect(door.defaultArm).toBeUndefined();
      });
      return;
    }

    it("`undefined` → the door's own default, which is absolute and never CWD-derived", () => {
      const actual = defaultArm.actual();
      expect(actual).toBe(defaultArm.expected());
      expect(isAbsolute(actual)).toBe(true);
      expect(actual).not.toBe(process.cwd());
    });
  });
}
