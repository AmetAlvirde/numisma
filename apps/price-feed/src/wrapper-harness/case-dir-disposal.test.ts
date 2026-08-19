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

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CASE_DIR_PREFIX, disposeCaseDir, KEEP_CASE_DIRS_ENV } from "./case-dir.testkit.js";

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

afterEach(() => {
  delete process.env[KEEP_CASE_DIRS_ENV];
  while (minted.length > 0) {
    rmSync(minted.pop() as string, { recursive: true, force: true });
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

    it("refuses a correctly-prefixed path that is not in the temp dir", () => {
      const outsideRoot = mkdtempSync(join(tmpdir(), CASE_DIR_PREFIX));
      minted.push(outsideRoot);
      // Prefix-correct in its own basename, but one level deeper than a case dir ever is.
      const impostor = join(outsideRoot, `${CASE_DIR_PREFIX}deeper`);
      mkdirSync(impostor, { recursive: true });

      expect(() => disposeCaseDir(impostor, { failed: false })).toThrow(/refused to remove/);
      expect(existsSync(impostor)).toBe(true);
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
