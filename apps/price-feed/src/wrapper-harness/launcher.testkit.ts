/**
 * S1 · THE LAUNCHER — the process boundary of the wrapper harness (PRD #314 §4).
 *
 * It owns starting `ops/price-feed/run-daily-fetch.sh` CORRECTLY and returning a run
 * record. Nothing downstream touches a process API, which is what keeps every case
 * honest about the two things that are easy to get subtly wrong.
 *
 * ── IT INVOKES `/bin/bash <wrapper>` EXPLICITLY ───────────────────────────────────────
 * Not the shebang's `env bash`. That is what the launchd plist does, and what runs in
 * production is `/bin/bash` 3.2.57 — a GPLv2 bash from 2007 with no `${var^^}`, no
 * associative arrays, and a different `trap` inheritance story than bash 5. Running the
 * suite against a Homebrew bash 5 would test a shell the job never uses. The observed
 * version is RECORDED in every run record so a newer `/bin/bash` landing on this machine
 * later cannot silently change what is under test.
 *
 * ── IT STARTS THE CHILD IN ITS OWN SESSION ────────────────────────────────────────────
 * `detached: true` is `setsid`, and **it is the single most important line in the
 * harness.** Without it the wrapper is not its own process-group leader, its own
 * leader check prints `watchdog DISABLED (not a process-group leader: …)`, the watchdog
 * no-ops, and every timeout case in every later slice passes while testing nothing. The
 * suite asserts `watchdog armed:` on the healthy case precisely so that dropping this
 * line goes RED rather than quiet.
 *
 * ── THE NON-LEADER LAUNCH IS A REAL CONFIGURATION, NOT AN OMISSION ────────────────────
 * Case 7 — the suite's anti-vacuity control — needs the wrapper to run WITHOUT being its
 * group leader. It gets there through an intermediate `/bin/bash` that is itself detached
 * and does NOT `exec`: the intermediate leads the group, the wrapper is an ordinary
 * member of it. Simply dropping `detached` would put the wrapper in VITEST's process
 * group, where "zero processes remaining in the run's pgid" is unassertable — the third
 * and historically highest-value assertion would have to be waived for exactly the case
 * that exists to prove the suite is not vacuous. This way the pgid is still a group the
 * harness owns alone, and the assertion triple applies uniformly.
 *
 * ── THE PGID IS KNOWN WITHOUT ASKING ──────────────────────────────────────────────────
 * In both shapes the spawned child IS the group leader, so the run's pgid is its pid. No
 * `ps` race at startup, and the residue scan has a stable key even for a run that exited
 * before the first poll.
 */

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseHeartbeat, type JobHeartbeat } from "@numisma/event-store";
import { assertIsolated } from "./isolation.testkit.js";

/** The shell the plist invokes, and therefore the only shell this suite tests against. */
export const LAUNCH_SHELL = "/bin/bash";

export interface RunRecord {
  /** Exactly what `/bin/bash --version` reported, first line. Recorded, never inferred. */
  readonly bashVersion: string;
  /** The run's process group. The spawned child leads it, so this is its pid. */
  readonly pgid: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Parsed by the SAME reader the TUI uses — the oracle, not a second parser. */
  readonly heartbeat: JobHeartbeat | undefined;
  readonly heartbeatRaw: string | undefined;
  /** The per-run log file's contents, which is what the wrapper's `tee` actually wrote. */
  readonly logText: string;
  /** What the harness captured off the child's stdio, kept separate from the log file. */
  readonly stdout: string;
  /** Whether the watchdog left its calling card — the TERM handler's own discriminator. */
  readonly watchdogFired: boolean;
  /** `pid command` for anything still in the run's pgid when the settle window closed. */
  readonly pgidResidue: readonly string[];
  /** How long the pgid took to empty. Recorded so 0.1s → 4.9s is visible, not merely passing. */
  readonly settleMs: number;
  readonly durationMs: number;
}

export interface LaunchOptions {
  readonly caseDir: string;
  readonly wrapperPath: string;
  readonly env: NodeJS.ProcessEnv;
  /**
   * `true` (production shape) makes the wrapper its own session and group leader.
   * `false` runs it as a non-leading member of a group the harness still owns — case 7.
   */
  readonly groupLeader: boolean;
  /** How long the pgid may take to empty before the residue is reported as-is. */
  readonly settleDeadlineMs: number;
  /** A hard cap so a wedged run cannot wedge the suite. Exceeding it is a failure, not a pass. */
  readonly maxWaitMs: number;
}

/** Read once per process: `/bin/bash --version`'s first line, verbatim. */
export function observedBashVersion(): string {
  return execFileSync(LAUNCH_SHELL, ["--version"], { encoding: "utf8" }).split("\n")[0] ?? "";
}

/** `pid command` for every process currently in `pgid`, the harness's own excluded by construction. */
export function processesInPgid(pgid: number): string[] {
  let table: string;
  try {
    table = execFileSync("ps", ["-A", "-o", "pid=,pgid=,command="], { encoding: "utf8" });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const line of table.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match && Number(match[2]) === pgid) {
      found.push(`${match[1]} ${match[3]}`);
    }
  }
  return found;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** The per-run log the wrapper's `tee` wrote, plus the watchdog's calling card beside it. */
function readRunLog(logDir: string): { logText: string; watchdogFired: boolean } {
  if (!existsSync(logDir)) {
    return { logText: "", watchdogFired: false };
  }
  const entries = readdirSync(logDir);
  const logText = entries
    .filter((name) => name.startsWith("price-feed-") && name.endsWith(".log"))
    .map((name) => readFileSync(join(logDir, name), "utf8"))
    .join("");
  return { logText, watchdogFired: entries.some((name) => name.endsWith(".watchdog-fired")) };
}

/**
 * Launch the wrapper and observe it. **The isolation contract is asserted here, on every
 * launch** — not by the caller, because a caller that could choose to skip it eventually
 * will, and the cost of skipping it once is a real commit against the durable event log.
 */
export async function launchWrapper(options: LaunchOptions): Promise<RunRecord> {
  assertIsolated(options.env, options.caseDir);

  const logDir = options.env.NUMISMA_PRICEFEED_LOG_DIR ?? "";
  const dataDir = options.env.NUMISMA_DATA_DIR ?? "";

  // THE NON-LEADER SHAPE MUST NOT `exec`. bash short-circuits `bash -c '"$0"'` into an
  // exec of the single command, which would hand the group leadership straight back to
  // the wrapper and quietly turn case 7 into a second copy of case 1. Capturing the
  // status in a variable and exiting on it keeps a real fork in between, and forwards the
  // wrapper's exit code unchanged.
  const args = options.groupLeader
    ? [options.wrapperPath]
    : ["-c", 'rc=0; "$0" "$@" || rc=$?; exit "$rc"', LAUNCH_SHELL, options.wrapperPath];

  const startedAt = Date.now();
  const child = spawn(LAUNCH_SHELL, args, {
    cwd: options.caseDir,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pgid = child.pid ?? -1;
  if (pgid <= 0) {
    throw new Error("wrapper harness: the launch produced no pid");
  }

  let captured = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (captured += chunk));
  child.stderr.on("data", (chunk: string) => (captured += chunk));

  const exited = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const cap = setTimeout(() => {
        // Reap the whole group before failing: leaving it behind would poison every later
        // case's residue assertion with this run's wreckage.
        try {
          process.kill(-pgid, "SIGKILL");
        } catch {
          /* already gone */
        }
        reject(
          new Error(
            `wrapper harness: the run exceeded the harness cap of ${options.maxWaitMs}ms. ` +
              "That is a failure of the case, never a pass — the wrapper's own watchdog was " +
              "supposed to bound this.",
          ),
        );
      }, options.maxWaitMs);
      child.on("error", (error) => {
        clearTimeout(cap);
        reject(error);
      });
      child.on("exit", (code, signal) => {
        clearTimeout(cap);
        resolve({ code, signal });
      });
    },
  );
  const durationMs = Date.now() - startedAt;

  // THE SETTLE WINDOW, bounded in BOTH directions. Asserting emptiness the instant the
  // shell exits gives a false red on the timeout path, where the watchdog is deliberately
  // left alive to serve its grace and group-SIGKILL. Waiting with unbounded patience gives
  // a false green: the historical stray `sleep` DID eventually exit — after holding
  // launchd's per-label job slot through the next fire. So poll to a deadline and record
  // what it cost.
  const settleStartedAt = Date.now();
  let residue = processesInPgid(pgid);
  while (residue.length > 0 && Date.now() - settleStartedAt < options.settleDeadlineMs) {
    await sleep(25);
    residue = processesInPgid(pgid);
  }
  const settleMs = Date.now() - settleStartedAt;

  const { logText, watchdogFired } = readRunLog(logDir);
  const heartbeatPath = join(dataDir, "job-heartbeat.json");
  const heartbeatRaw = existsSync(heartbeatPath) ? readFileSync(heartbeatPath, "utf8") : undefined;

  return {
    bashVersion: observedBashVersion(),
    pgid,
    exitCode: exited.code,
    signal: exited.signal,
    heartbeat: parseHeartbeat(heartbeatRaw),
    heartbeatRaw,
    logText,
    stdout: captured,
    watchdogFired,
    pgidResidue: residue,
    settleMs,
    durationMs,
  };
}
