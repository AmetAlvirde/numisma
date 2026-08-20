/**
 * THE FILL SHELL REFUSES A PARTIAL DURABLE LOG (audit finding 2).
 *
 * `record-fill-cli.ts` was a non-test `loadEventLog` call site that did not pair with
 * `assertLogFullyLoaded` — the convention its sibling readers state and follow
 * (`apps/tui/src/event-store.ts`, `apps/price-feed/src/rejection-check.ts`,
 * `packages/event-store/src/{event-store,gap-report-io}.ts`). The one other bare read,
 * `apps/web/src/push/backfill-core.ts`'s `enumerateAnchors`, is tolerable only because
 * each anchor it yields is immediately re-read through the asserting fold path. A single quarantined line
 * therefore made `recordFill` reason over a HALF-READ log: `reconcileFillActs` could
 * read a sidecar `orderFilled` whose log half was the quarantined line and refuse with
 * `torn-fill-act` — whose message tells the operator to HAND-AUTHOR the missing half,
 * compounding the damage — while in the other direction the `duplicate-fill-act` gate
 * weakened and an already-recorded fill could pass.
 *
 * WHY THIS TEST SPAWNS A SUBPROCESS. The seam that was missing the assertion is the
 * SHELL's `loadLogEvents` binding, and both `recordFill` suites inject `loadLogEvents`
 * as a total in-memory reader — they cannot see it. Importing the shell RUNS THE ACT
 * (top-level await), so the only honest way to exercise this wiring is to run it as the
 * operator does, through `NUMISMA_DATA_DIR`, against a SYNTHETIC data dir. Same
 * `spawnSync(tsx, …)` shape the `spine:reset` guards in `durable-log-guards.test.ts`
 * already use.
 *
 * EVERY FIXTURE IS SYNTHETIC — invented instrument, round decade prices, round
 * balances. No real price, quantity, balance or rung appears here, and the real
 * accumulus data dir is never reachable: `NUMISMA_DATA_DIR` is set to a throwaway
 * `mkdtemp` directory for every case.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { serializeOrderRecord, type OrderRecord } from "@numisma/engine";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = apps/tui/src → the repo root is three levels up.
const REPO_ROOT = resolve(HERE, "../../..");

/** A synthetic fund: one portfolio, one account, one instrument, one tiered reserve. */
const GENESIS_SEED = {
  fund: { id: "fund-synthetic", name: "Synthetic", baseCurrency: "USD" },
  review: { asOf: "2026-01-01", usdMxn: 20 },
  portfolios: [{ id: "portfolio-synthetic", name: "Synthetic" }],
  accounts: [
    { id: "account-synthetic", name: "Synthetic Venue", platform: "SYNTH", currency: "USD" },
  ],
  instruments: [
    { id: "instrument-synthetic", name: "Synthetic Asset", symbol: "TEST", currency: "USD" },
  ],
  reserves: [
    {
      id: "reserve-synthetic",
      portfolioId: "portfolio-synthetic",
      tempo: "Capital",
      executionMode: "live",
      accountId: "account-synthetic",
      currency: "USD",
      amount: 10000,
      lots: [{ quantity: 10000, tier: "c1" }],
    },
  ],
  positions: [],
};

/** A descending synthetic ladder of three resting rungs, all against the one reserve. */
function ladderRecords(): OrderRecord[] {
  return [400, 300, 200].map((price) => ({
    id: `rung-${price}`,
    observedAt: "2026-01-02T09:00:00",
    kind: "orderPlaced" as const,
    currency: "USD" as const,
    symbol: "TEST/USD",
    side: "buy" as const,
    price,
    quantity: 10,
    fundingReserveId: "reserve-synthetic",
  }));
}

describe("record-fill-cli — the shell refuses a partial durable log (finding 2)", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs.length = 0;
  });

  /**
   * A throwaway data dir holding a valid genesis, a resting synthetic ladder, and the
   * given durable-log lines verbatim (so a case can plant an unloadable one).
   */
  async function syntheticDataDir(logLines: string[]): Promise<string> {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-fill-cli-"));
    createdDirs.push(dir);
    await writeFile(join(dir, "genesis.json"), JSON.stringify(GENESIS_SEED), "utf8");
    await writeFile(
      join(dir, "orders.jsonl"),
      ladderRecords()
        .map((record) => `${serializeOrderRecord(record)}\n`)
        .join(""),
      "utf8",
    );
    await writeFile(join(dir, "events.jsonl"), logLines.map((line) => `${line}\n`).join(""), "utf8");
    return dir;
  }

  /** Run the real `record-fill-cli.ts` under tsx against `dataDir`, with stdin closed. */
  function runFill(dataDir: string): { status: number | null; stdout: string; stderr: string } {
    const script = join(REPO_ROOT, "apps", "tui", "src", "record-fill-cli.ts");
    const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
    const env = { ...process.env, NUMISMA_DATA_DIR: dataDir };
    const result = spawnSync(tsx, [script], { encoding: "utf8", env, input: "" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  it("refuses (exit 1) on an unloadable log line, before asking the operator anything", async () => {
    const dir = await syntheticDataDir(["this is not JSON"]);

    const result = runFill(dir);

    expect(result.status).toBe(1);
    // The shared `assertLogFullyLoaded` sentence — the same refusal every other reader
    // raises, not a bespoke one this shell invented.
    expect(result.stderr).toMatch(/refusing to fold a partial log/i);
    expect(result.stderr).toContain("line 1");
    // The operator is never walked into the interview over a half-read log — the point
    // of asserting at the READ, not at `loadFolded()` some thirty answers later. The
    // rung listing is the interview's first printed line, so its ABSENCE is the proof.
    expect(result.stdout).not.toMatch(/Resting rungs:/);
  });

  it("MARKS a fold taken over damaged history, before the interview starts", async () => {
    // An authored `Deposit` naming a reserve the synthetic genesis never declares: the
    // fold reads it and drops its cash leg. PRD #323 R7 — recording a fill onto a fold
    // derived from damaged history is when the epistemic marker is worth the most, and
    // it is worth nothing if it lands thirty answers into the interview.
    const dir = await syntheticDataDir([
      JSON.stringify({
        id: "authored-drop-1",
        asOf: "2026-01-02",
        type: "Deposit",
        reserveId: "authored-reserve-never-opened",
        amount: 250,
        tier: "c1",
      }),
    ]);

    const result = runFill(dir);

    // ONE counted line, not an enumeration, and it names no event content.
    expect(result.stderr).toContain("1 event(s)");
    expect(result.stderr).not.toContain("authored-drop-1");
    expect(result.stderr).not.toContain("authored-reserve-never-opened");
    // BEFORE the act: the rung listing is the interview's first printed line, and the
    // marker is on the near side of the operator's decision, not inside it.
    expect(result.stdout).toMatch(/Resting rungs:/);
    // REPORT, NEVER REFUSE — the drop points into append-only history, so it can never
    // extinguish and must not redden this shell's exit code. The run ends 1 only because
    // stdin is closed and the interview is abandoned, exactly as the control case does.
    expect(result.stderr).not.toMatch(/refusing to fold a partial log/i);
  });

  it("gets past the log read on a fully-loadable (here, empty) log", async () => {
    const dir = await syntheticDataDir([]);

    const result = runFill(dir);

    // Control: the refusal above is the QUARANTINED LINE talking, not a data dir this
    // shell cannot start against at all. With a clean log the flow reaches the operator.
    expect(result.stderr).not.toMatch(/refusing to fold a partial log/i);
    expect(result.stdout).toMatch(/Resting rungs:/);
  });
});

/**
 * THE READLINE INTERNAL STOPS REACHING THE OPERATOR (#370, symptom 2).
 *
 * This shell built its readline interface at MODULE SCOPE, which is the shape #346 removed
 * from `import-orders-cli.ts` and never shared. `createInterface` eagerly consumes stdin,
 * so on a pipe the stream had ended before the first question was put and `ask` rejected
 * with `ERR_USE_AFTER_CLOSE` — the outer catch then printed `readline was closed` to the
 * operator verbatim.
 *
 * NO PTY IS NEEDED FOR THIS ONE, which is where #370's framing was too strong: a spawn's
 * stdin is a pipe, and the pipe is exactly what provokes the defect. The suites above
 * already ran through this door with `input: ""` and were printing the internal the whole
 * time. Symptom 1 — Ctrl-D at a REAL terminal — is a different trigger, still open, and
 * nothing here claims to cover it.
 */
describe("record-fill-cli — a run with no terminal refuses in its own voice (#370)", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs.length = 0;
  });

  async function cleanDataDir(): Promise<string> {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-fill-cli-noterm-"));
    createdDirs.push(dir);
    await writeFile(join(dir, "genesis.json"), JSON.stringify(GENESIS_SEED), "utf8");
    await writeFile(
      join(dir, "orders.jsonl"),
      ladderRecords()
        .map((record) => `${serializeOrderRecord(record)}\n`)
        .join(""),
      "utf8",
    );
    await writeFile(join(dir, "events.jsonl"), "", "utf8");
    return dir;
  }

  function runFill(dataDir: string): { status: number | null; stdout: string; stderr: string } {
    const script = join(REPO_ROOT, "apps", "tui", "src", "record-fill-cli.ts");
    const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
    const env = { ...process.env, NUMISMA_DATA_DIR: dataDir };
    const result = spawnSync(tsx, [script], { encoding: "utf8", env, input: "" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  it("never prints readline's own error", async () => {
    const result = runFill(await cleanDataDir());

    // The whole complaint, in one assertion. This was the observed output before the fix.
    expect(result.stderr).not.toContain("readline was closed");
    expect(result.stderr).not.toContain("ERR_USE_AFTER_CLOSE");
  });

  it("names the missing terminal in the shell's voice, and the refusal in the flow's", async () => {
    const result = runFill(await cleanDataDir());

    // TWO SENTENCES, TWO LAYERS: the shell says WHY there is no answer, the flow says
    // WHAT IT DID about it. Neither one alone tells the operator what happened.
    expect(result.stderr).toContain("No terminal on stdin");
    expect(result.stderr).toContain("Run it from a terminal.");
    expect(result.stderr).toContain("REFUSED");
    expect(result.stderr).toContain("no resting rung matches");
    // And it says nothing was written, which is the flow's own closing sentence.
    expect(result.stderr).toContain("Nothing was written to");
    expect(result.status).toBe(1);
    // WHAT THIS SPAWN HONESTLY DOES NOT PIN, in the voice `import-orders-cli.test.ts`
    // uses for the same situation on the sibling shell: the notice is written ONCE PER
    // RUN rather than once per question, and no spawn here can see it. This case briefly
    // carried a count over the notice, which could not fail — a no-terminal run reaches
    // EXACTLY ONE question. `record-fill.ts` asks "Which rung filled?" first, gets the
    // channel's `UNANSWERED`,
    // and refuses as `unknown-rung`; every later question sits past that refusal, and no
    // data-dir state reaches one. Delete the `toldThereIsNoTerminal` flag entirely, write
    // the notice unconditionally on every `ask`, and this file stays green. That is the
    // same verdict the import shell recorded, and it lands the same way here.
    //
    // The guard IS observed, as a unit, in `prompt-channel.test.ts`: nine questions put
    // through a no-terminal channel, one notice counted. That is where the difference
    // between one notice and nineteen is visible, and it needs no process at all.
  });
});
