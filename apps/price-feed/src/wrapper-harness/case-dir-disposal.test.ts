/**
 * THE DISPOSER'S OWN TESTS — the one piece of the harness that DELETES, tested apart from
 * everything it deletes for.
 *
 * `disposeCaseDir` is a recursive `rm`. Every other module in this directory fails toward
 * refusing; this one, if it were wrong about which path it was handed, would fail toward
 * removing a directory nobody asked it to remove. So its guard is tested first and by
 * name, with paths that are deliberately NOT case dirs.
 *
 * Every directory here is minted by this file and torn down by this file. Nothing reads a
 * real case dir, and no assertion depends on a wrapper having run.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTRACT_MARK_CONFIG } from "./mark-window.testkit.js";
import {
  CASE_DIR_PREFIX,
  disposeCaseDir,
  KEEP_CASE_DIRS_ENV,
  makeCaseDir,
} from "./case-dir.testkit.js";

/** Dirs this file made, removed whatever the assertions did or did not do to them. */
const minted: string[] = [];

function mintCaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), CASE_DIR_PREFIX));
  minted.push(dir);
  // A file and a nested directory, so "it was removed" means the RECURSIVE removal
  // happened and not merely an `rmdir` of something that was already empty.
  mkdirSync(join(dir, "logs"), { recursive: true });
  writeFileSync(join(dir, "logs", "run.log"), "authored fixture\n", "utf8");
  return dir;
}

/**
 * THE OPT-OUT IS RESET BEFORE EACH CASE, NOT ONLY AFTER ONE. This file documents a variable
 * a human exports while debugging, so a human who is doing exactly that runs the suite with
 * it already in the environment — and an `afterEach`-only reset leaves the FIRST case in
 * this file inheriting it, which turns the disposal cases red for a reason that has nothing
 * to do with the code. The ambient value is put back at the end rather than deleted, because
 * this process does not own the shell it was started from.
 */
const ambientKeep = process.env[KEEP_CASE_DIRS_ENV];

beforeEach(() => {
  delete process.env[KEEP_CASE_DIRS_ENV];
});

afterEach(() => {
  delete process.env[KEEP_CASE_DIRS_ENV];
  while (minted.length > 0) {
    rmSync(minted.pop() as string, { recursive: true, force: true });
  }
});

afterAll(() => {
  if (ambientKeep === undefined) {
    delete process.env[KEEP_CASE_DIRS_ENV];
  } else {
    process.env[KEEP_CASE_DIRS_ENV] = ambientKeep;
  }
});

describe("disposeCaseDir", () => {
  it("removes a passing case's directory, contents and all", () => {
    const dir = mintCaseDir();

    disposeCaseDir(dir, { failed: false });

    expect(existsSync(dir), "a passing case left its directory behind").toBe(false);
  });

  it("is a no-op on a directory that is already gone, so a second call cannot throw", () => {
    const dir = mintCaseDir();
    disposeCaseDir(dir, { failed: false });

    expect(() => disposeCaseDir(dir, { failed: false })).not.toThrow();
  });

  // THE WHOLE REASON THE DISPOSER TAKES A FLAG. These cases assert on files the wrapper
  // wrote — the per-run log, the heartbeat, the sentinels. Deleting them on the way out of
  // a red case deletes the evidence of the red.
  it("KEEPS a failing case's directory, because the post-mortem reads it", () => {
    const dir = mintCaseDir();

    disposeCaseDir(dir, { failed: true });

    expect(existsSync(join(dir, "logs", "run.log")), "the failure evidence was deleted").toBe(true);
  });

  describe(`the ${KEEP_CASE_DIRS_ENV} opt-out`, () => {
    it("keeps a PASSING case's directory when it is set", () => {
      const dir = mintCaseDir();
      process.env[KEEP_CASE_DIRS_ENV] = "1";

      disposeCaseDir(dir, { failed: false });

      expect(existsSync(dir), "the opt-out was set and the directory went anyway").toBe(true);
    });

    // The grammar, pinned: a human typed this variable to keep dirs, so anything that is
    // not an explicit off-word keeps them. Nothing in the suite sets it, so a value the
    // table does not name can only have come from that human.
    for (const value of ["1", "true", "yes", "always", "please", " keep "]) {
      it(`treats \`${value}\` as keep`, () => {
        const dir = mintCaseDir();
        process.env[KEEP_CASE_DIRS_ENV] = value;

        disposeCaseDir(dir, { failed: false });

        expect(existsSync(dir)).toBe(true);
      });
    }

    for (const value of ["", "0", "false", "no", "OFF"]) {
      it(`treats \`${value}\` as off, so the dir still goes`, () => {
        const dir = mintCaseDir();
        process.env[KEEP_CASE_DIRS_ENV] = value;

        disposeCaseDir(dir, { failed: false });

        expect(existsSync(dir)).toBe(false);
      });
    }
  });

  /**
   * CLEANUP DOES NOT GET A VOTE ON THE VERDICT. `rmSync` throws once it exhausts its
   * retries, and this runs from `onTestFinished`, so a throw here would redden a case that
   * had already passed — the timeout cases end with the wrapper's strays still writing
   * inside the case dir, which is exactly how that race is lost. The refusal above still
   * throws, because that one means the caller is wrong; this one means the filesystem was
   * busy, which is not a fact about the code under test.
   *
   * The unremovable directory is authored, not waited for: a case dir the process may
   * traverse but not write makes the recursive unlink fail with `EACCES` on the first try,
   * every time, with no race to lose. Root ignores those bits, so the case states that it
   * is not describing a root run rather than passing vacuously in one.
   */
  it.skipIf(process.getuid?.() === 0)(
    "warns and returns when the removal fails, so a green case stays green",
    () => {
      const dir = mintCaseDir();
      chmodSync(dir, 0o500);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        expect(() => disposeCaseDir(dir, { failed: false })).not.toThrow();
        expect(existsSync(dir), "the removal was supposed to have failed").toBe(true);
        expect(warn, "a directory left on disk without a word is the silent leak").toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0]), "the warning does not name the directory").toContain(dir);
      } finally {
        warn.mockRestore();
        chmodSync(dir, 0o700);
      }
    },
  );

  // ── THE PATH GUARD ────────────────────────────────────────────────────────────────
  //
  // A recursive delete that can be pointed anywhere is not acceptable in a testkit, so it
  // refuses everything that is not a direct child of the temp dir carrying the harness's
  // own prefix. It THROWS rather than returning quietly: a disposer handed the wrong path
  // has a caller that is wrong, and that must be read, not swallowed.
  describe("the path guard", () => {
    it("refuses a temp-dir sibling that does not carry the harness prefix", () => {
      const stranger = mkdtempSync(join(tmpdir(), "not-a-numisma-case-"));
      minted.push(stranger);

      expect(() => disposeCaseDir(stranger, { failed: false })).toThrow(/refused to remove/);
      expect(existsSync(stranger), "the guard threw and deleted the directory anyway").toBe(true);
    });

    it("refuses a case dir's own child, prefixed or not, because that is not a case dir", () => {
      const parent = mkdtempSync(join(tmpdir(), CASE_DIR_PREFIX));
      minted.push(parent);
      // Prefix-correct in its own basename, but one level deeper than a case dir ever is.
      const impostor = join(parent, `${CASE_DIR_PREFIX}deeper`);
      mkdirSync(impostor, { recursive: true });

      expect(() => disposeCaseDir(impostor, { failed: false })).toThrow(/refused to remove/);
      expect(existsSync(impostor)).toBe(true);
    });

    // The case above is still INSIDE the temp tree, and the three literal paths below either
    // miss the prefix or are relative. This is the one that hands the guard an absolute,
    // correctly-prefixed, existing directory whose parent is not the temp dir at all — the
    // shape a caller would produce by building a case dir path against the wrong root.
    it("refuses a correctly-prefixed directory that lives outside the temp tree", () => {
      const stranger = join(process.cwd(), `${CASE_DIR_PREFIX}outside-the-temp-tree`);
      mkdirSync(stranger, { recursive: true });
      minted.push(stranger);

      expect(() => disposeCaseDir(stranger, { failed: false })).toThrow(/refused to remove/);
      expect(existsSync(stranger), "the guard threw and deleted the directory anyway").toBe(true);
    });

    for (const path of ["/", "/tmp", "relative/numisma-wrapper-case-x", ""]) {
      it(`refuses \`${path}\``, () => {
        expect(() => disposeCaseDir(path, { failed: false })).toThrow(/refused to remove/);
      });
    }

    // AND IT REFUSES BEFORE IT ASKS WHETHER TO KEEP. Otherwise the opt-out would be a way
    // to make a bad path look harmless, and the guard would go untested on every machine
    // that had the variable exported.
    it("refuses a bad path even when the keep opt-out would have spared it", () => {
      process.env[KEEP_CASE_DIRS_ENV] = "1";

      expect(() => disposeCaseDir("/", { failed: true })).toThrow(/refused to remove/);
    });
  });
});

/**
 * ── THE WIRING, NOT THE DISPOSER ──────────────────────────────────────────────────────
 *
 * Everything above tests `disposeCaseDir` as a pure function, which leaves the part that
 * actually fixes #390 — the `onTestFinished` registration inside `makeCaseDir` — pinned by
 * nothing. Delete those lines and a disposer suite that tests only the function stays fully
 * green while every one of the ~40 call sites leaks again, exactly as before.
 *
 * So these cases observe the registration from OUTSIDE the test that triggers it. One case
 * mints a dir and stashes its path; the NEXT case asserts the path is gone. Vitest runs the
 * cases of a file sequentially and in source order, so "the next case" is a fact about the
 * runner rather than luck, and by the time it executes, the minting case's
 * `onTestFinished` callbacks have already run.
 *
 * These are the only cases in this file that call the real `makeCaseDir`, so they are also
 * the only ones that pay for its `git init` and its fake bin. Two of them is the price of
 * the seam not being deletable in silence.
 */
describe("makeCaseDir registers its own disposal", () => {
  const CASE_OPTIONS = {
    maxRunSeconds: 5,
    watchdogGraceSeconds: 1,
    mark: CONTRACT_MARK_CONFIG,
  } as const;

  /** Written by the minting case, read by the case after it. */
  let dirOfPassingCase: string | undefined;
  let dirOfSkippedCase: string | undefined;

  // A backstop, not the assertion: if the registration is missing, the observing case fails
  // AND the dir it caught is still on disk, so this file must not become the leak it pins.
  afterAll(() => {
    for (const dir of [dirOfPassingCase, dirOfSkippedCase]) {
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("mints a case dir, and this case does nothing whatever to remove it", () => {
    const dirs = makeCaseDir(CASE_OPTIONS);
    dirOfPassingCase = dirs.caseDir;

    expect(existsSync(dirs.caseDir), "makeCaseDir did not produce a directory").toBe(true);
  });

  it("and the case above ended green, so its directory is already gone", () => {
    expect(dirOfPassingCase, "the minting case did not run before this one").toBeDefined();
    expect(
      existsSync(dirOfPassingCase as string),
      "makeCaseDir minted a dir and nothing removed it when the owning case passed — the " +
        "self-registration is gone and #390 is back",
    ).toBe(false);
  });

  it("mints a case dir and then skips itself mid-body", (context) => {
    const dirs = makeCaseDir(CASE_OPTIONS);
    dirOfSkippedCase = dirs.caseDir;

    context.skip();
  });

  it("and the skipped case's directory is gone too, because a skip has no evidence", () => {
    expect(dirOfSkippedCase, "the skipping case did not run before this one").toBeDefined();
    expect(
      existsSync(dirOfSkippedCase as string),
      "a skipped case kept its directory: its body stopped before it asserted anything, so " +
        "there is no post-mortem to preserve and this is a permanent leak",
    ).toBe(false);
  });
});
