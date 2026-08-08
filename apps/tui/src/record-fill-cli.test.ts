/**
 * THE FILL SHELL REFUSES A PARTIAL DURABLE LOG (audit finding 2).
 *
 * `record-fill-cli.ts` was the one non-test `loadEventLog` call site in the repo that
 * did not pair with `assertLogFullyLoaded` — the convention every other reader states
 * and follows (`apps/tui/src/event-store.ts`, `apps/price-feed/src/rejection-check.ts`,
 * `packages/event-store/src/{event-store,gap-report-io}.ts`). A single quarantined line
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeOrderRecord, type OrderRecord } from "@numisma/engine";

// Spawning `tsx` costs a cold TypeScript start; give it headroom under load.
vi.setConfig({ testTimeout: 30_000 });

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

  it("gets past the log read on a fully-loadable (here, empty) log", async () => {
    const dir = await syntheticDataDir([]);

    const result = runFill(dir);

    // Control: the refusal above is the QUARANTINED LINE talking, not a data dir this
    // shell cannot start against at all. With a clean log the flow reaches the operator.
    expect(result.stderr).not.toMatch(/refusing to fold a partial log/i);
    expect(result.stdout).toMatch(/Resting rungs:/);
  });
});
