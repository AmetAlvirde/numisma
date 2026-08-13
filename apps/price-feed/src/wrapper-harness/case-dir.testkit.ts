/**
 * THE CASE DIRECTORY — where a single wrapper run is allowed to have effects, and the
 * only place it is allowed to have them.
 *
 * Every one of the seven `NUMISMA_*` overrides points inside here, and the launcher's
 * isolation contract (S2) refuses to start otherwise. A fresh directory per RUN, not per
 * case: the 12 repetitions of a case must not be able to pass by leaning on each other's
 * leftovers, and a heartbeat carried forward from run 3 into run 4 would make run 4's
 * assertion about a carried field meaningless.
 *
 * ── THE INHERITED `PATH` IS THE LAUNCHD PATH, ON PURPOSE ──────────────────────────────
 * `/usr/bin:/bin:/usr/sbin:/sbin` — exactly the bare, non-login `PATH` launchd hands the
 * job, and the reason the wrapper prepends anything at all. It is also a second,
 * independent safety layer under the sentinel: the real pnpm lives in neither the
 * inherited `PATH` nor the prepend, so even a harness bug that lost the fake could not
 * reach it. The fake arrives ONLY through `NUMISMA_PATH_PREPEND`.
 *
 * ── `HOME` IS INSIDE THE CASE DIR TOO ─────────────────────────────────────────────────
 * Not because the wrapper reads it — all seven of its `$HOME`-derived defaults are
 * overridden — but because `git` does. A real `~/.gitconfig` could bring hooks, signing,
 * or a `core.excludesFile` into a run whose whole purpose is to be uninfluenced by this
 * machine.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFakeBin } from "./fake-bin.testkit.js";

/** The bare, non-login PATH launchd actually hands the job. */
export const LAUNCHD_BARE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

export interface CaseDirs {
  readonly caseDir: string;
  readonly binDir: string;
  readonly repoDir: string;
  readonly dataDir: string;
  readonly logDir: string;
  readonly envFile: string;
  readonly sentinelDir: string;
}

export interface CaseOptions {
  /** The wrapper's wall-clock ceiling for this case, in seconds. */
  readonly maxRunSeconds: number;
  /** How long the watchdog waits after SIGTERM before escalating, in seconds. */
  readonly watchdogGraceSeconds: number;
}

/**
 * Build one run's directory. The data dir is a real (empty, isolated) git repo, because
 * the wrapper's step 3 and step 4 both branch on `git -C "$DATA_DIR" rev-parse --git-dir`
 * and a non-repo would take the "not inside a git repo — skipping commit" branch on every
 * run, leaving the healthy case's most consequential steps unexercised. It holds nothing
 * but its own `.git`, so the commit is the idempotent no-op the wrapper documents.
 */
export function makeCaseDir(options: CaseOptions): CaseDirs {
  const caseDir = mkdtempSync(join(tmpdir(), "numisma-wrapper-case-"));
  const binDir = installFakeBin(caseDir);
  const repoDir = join(caseDir, "repo");
  const dataDir = join(caseDir, "data");
  const logDir = join(caseDir, "logs");
  const homeDir = join(caseDir, "home");
  const envDir = join(caseDir, "env");
  for (const dir of [repoDir, dataDir, logDir, homeDir, envDir]) {
    mkdirSync(dir, { recursive: true });
  }

  // AUTHORED, and deliberately holding nothing that resembles a credential. The wrapper
  // sources this file if it exists, and that `source` is a code path worth exercising —
  // the real file is chmod-600 and outside the repo, and nothing about it is reproduced
  // here beyond the fact that it is a shell file that can be sourced.
  const envFile = join(envDir, "price-feed.env");
  writeFileSync(
    envFile,
    "# Authored fixture for the wrapper harness. No real credential is, or may be, here.\n" +
      "NUMISMA_HARNESS_ENV_FILE_WAS_SOURCED=yes\n",
    "utf8",
  );
  chmodSync(envFile, 0o600);

  // AND IT HAS A COMMIT IN IT. Not decoration: the wrapper's step 3 runs
  // `git add -u -- .`, and in a repo with no tracked file at all git refuses that
  // pathspec and exits 128 — so a virgin `git init` would fail the healthy case at
  // `commit` for a reason that has nothing to do with the wrapper and cannot happen to
  // the real durable log, which has years of history. The tracked file is an EMPTY
  // `events.jsonl`: it is the name the wrapper's own explicit-add loop and its strict
  // post-check both reach for, and being empty it reproduces no real trade data in
  // content or in shape.
  const gitEnv = {
    PATH: LAUNCHD_BARE_PATH,
    HOME: homeDir,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "numisma wrapper harness",
    GIT_AUTHOR_EMAIL: "harness@invalid",
    GIT_COMMITTER_NAME: "numisma wrapper harness",
    GIT_COMMITTER_EMAIL: "harness@invalid",
  };
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", dataDir, ...args], { stdio: ["ignore", "ignore", "pipe"], env: gitEnv });
  };
  execFileSync("git", ["init", "--quiet", "--initial-branch", "main", dataDir], {
    stdio: ["ignore", "ignore", "pipe"],
    env: gitEnv,
  });
  writeFileSync(join(dataDir, "events.jsonl"), "", "utf8");
  git("add", "--", "events.jsonl");
  git("commit", "--quiet", "-m", "authored fixture: an empty durable log");

  return { caseDir, binDir, repoDir, dataDir, logDir, envFile, sentinelDir: join(caseDir, "sentinels") };
}

/**
 * The seven overrides, and nothing that could reach outside the case dir.
 *
 * `NUMISMA_PATH_PREPEND` is the case's fake bin AND NOTHING ELSE. Adding a real directory
 * to this list — even a plausible-looking one — is how this suite becomes a live run
 * against real, private data. The isolation contract refuses it; this is where it would
 * be tempting.
 */
export function caseEnv(dirs: CaseDirs, options: CaseOptions): NodeJS.ProcessEnv {
  return {
    PATH: LAUNCHD_BARE_PATH,
    HOME: join(dirs.caseDir, "home"),
    // Keep this machine's git identity and hooks out of a run that must depend on nothing
    // but its own directory.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "numisma wrapper harness",
    GIT_AUTHOR_EMAIL: "harness@invalid",
    GIT_COMMITTER_NAME: "numisma wrapper harness",
    GIT_COMMITTER_EMAIL: "harness@invalid",
    NUMISMA_REPO_DIR: dirs.repoDir,
    NUMISMA_PRICEFEED_ENV: dirs.envFile,
    NUMISMA_PRICEFEED_LOG_DIR: dirs.logDir,
    NUMISMA_PATH_PREPEND: dirs.binDir,
    NUMISMA_DATA_DIR: dirs.dataDir,
    NUMISMA_PRICEFEED_MAX_RUN_SECONDS: String(options.maxRunSeconds),
    NUMISMA_PRICEFEED_WATCHDOG_GRACE_SECONDS: String(options.watchdogGraceSeconds),
  };
}

/**
 * S6 · A MUTATION CONTROL — a guard nobody has seen fail is a guard nobody should trust.
 *
 * Copies the wrapper into the case dir and applies one named textual change there. **The
 * committed wrapper is never touched**, and the mutated copy never leaves the temp dir.
 *
 * IT FAILS LOUDLY IF THE ANCHOR IS GONE. A mutation whose anchor text has rotted away
 * would silently apply nothing, the case would pass, and the report would read "the guard
 * was seen red" about a run that mutated nothing at all. Throwing is the same fail-closed
 * doctrine `parseIntervals()` in `schedule-window.test.ts` already applies when it throws
 * rather than returning an empty array.
 */
export function mutateWrapper(
  wrapperPath: string,
  caseDir: string,
  mutation: { readonly name: string; readonly anchor: string; readonly replacement: string },
): string {
  const source = readFileSync(wrapperPath, "utf8");
  const occurrences = source.split(mutation.anchor).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `wrapper harness: the mutation "${mutation.name}" found its anchor ${occurrences} times in ` +
        `${wrapperPath}, expected exactly 1. The anchor has rotted, so this guard has stopped ` +
        "guarding — that must break the build, not pass quietly.\n" +
        `anchor: ${mutation.anchor}`,
    );
  }
  const mutatedPath = join(caseDir, "mutated-run-daily-fetch.sh");
  writeFileSync(mutatedPath, source.replace(mutation.anchor, mutation.replacement), "utf8");
  chmodSync(mutatedPath, 0o755);
  return mutatedPath;
}

/**
 * THE CHILD-REAP MUTATION — it inverts assertion 3, which is what slice 1 is really
 * claiming.
 *
 * The wrapper cancels its watchdog by SIGKILLing the subshell AND the `sleep` the subshell
 * forked, because killing the subshell alone leaves the timer orphaned into the run's
 * process group — where it holds launchd's per-label job slot and keeps the log `tee`
 * alive on the inherited pipe. That was observed for real: a HEALTHY run reported
 * "complete" and then sat there with a stray `sleep`, a live `tee` and a held job slot.
 *
 * Drop the child kill and a healthy run leaves a stray `sleep` behind — so a suite that
 * has lost assertion 3 goes green here, and this control is what notices.
 */
export const CHILD_REAP_MUTATION = {
  name: "drop the watchdog child kill from write_heartbeat",
  anchor: '[[ -n "$WATCHDOG_KIDS" ]] && kill -KILL $WATCHDOG_KIDS 2>/dev/null',
  replacement: ': "mutation: the watchdog child kill was removed"',
} as const;
