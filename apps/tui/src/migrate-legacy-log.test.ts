/**
 * THE MIGRATION SHELL'S OWN CONTRACT (`pnpm migrate:log`).
 *
 * `migrate-legacy-log.ts` is the only tool in the repo that REWRITES the whole durable
 * log, and until now nothing tested it. Its delegate `migrateLegacyLog` is well covered
 * in `event-store.test.ts` (line numbering, the writeLogImage route, the loud refusals),
 * so this file deliberately stays off the domain and pins only what the SHELL owns:
 *
 *   - the operator-authored mapping read (`data/migration-cash-legs.json`) — ENOENT
 *     tolerance, the unwrapped `JSON.parse` failure, and the total absence of any
 *     structural validation on a well-formed-but-wrong mapping;
 *   - the two stdout sentences and the `touched === 0` boundary between them;
 *   - the exit-code mapping (0 on resolve, 1 on any throw, message on stderr);
 *   - `NUMISMA_DATA_DIR` plumbing, including the relative-path rejection.
 *
 * WHY THIS TEST SPAWNS A SUBPROCESS. Nothing is exported: the module is a self-executing
 * `main()` with a trailing `.catch`. Importing it RUNS THE MIGRATION against whatever
 * data dir the test process inherits. Spawning is the only door, and it is the same
 * `spawnSync(tsx, …)` shape `record-fill-cli.test.ts` and `durable-log-guards.test.ts`
 * already use. `input: ""` closes stdin so a shell can never hang on a read.
 *
 * THE CWD/ENV SPLIT THIS FILE EXISTS TO NAME. The log is read from
 * `$NUMISMA_DATA_DIR/events.jsonl`, but `MAPPING_PATH` is the CWD-relative literal
 * `"data/migration-cash-legs.json"` — it does NOT follow `NUMISMA_DATA_DIR`. So every
 * run here controls BOTH `env.NUMISMA_DATA_DIR` and `spawnSync`'s `cwd`, and the two
 * point at DIFFERENT throwaway directories on purpose, so no case can pass by accident
 * of them coinciding.
 *
 * EVERY FIXTURE IS AUTHORED HERE — invented ids, an invented instrument, round decade
 * prices and round balances. Nothing is copied or seeded from real log output, and the
 * real ledger is unreachable: `NUMISMA_DATA_DIR` is a throwaway `mkdtemp` dir in every
 * single run.
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Spawning `tsx` costs a cold TypeScript start; give it headroom under load.
vi.setConfig({ testTimeout: 30_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = apps/tui/src → the repo root is three levels up.
const REPO_ROOT = resolve(HERE, "../../..");

/** Where the shell looks for the operator's mapping — CWD-relative, by design of the code. */
const MAPPING_RELATIVE_PATH = join("data", "migration-cash-legs.json");

/** A synthetic fund: one portfolio, one account, one invented instrument, one open position. */
const GENESIS_SEED = {
  fund: { id: "fund-migrate", name: "Migration Fixture", baseCurrency: "USD" },
  review: { asOf: "2026-03-01", usdMxn: 20 },
  portfolios: [{ id: "vault", name: "Vault" }],
  accounts: [{ id: "synth-usd", name: "Synthetic Venue", platform: "SYNTH", currency: "USD" }],
  instruments: [{ id: "zzz-usd", name: "Synthetic Asset", symbol: "ZZZ", currency: "USD" }],
  reserves: [
    {
      id: "reserve-vault",
      portfolioId: "vault",
      tempo: "Reserve",
      executionMode: "live",
      accountId: "synth-usd",
      currency: "USD",
      amount: 5000,
    },
  ],
  positions: [
    {
      id: "zzz-vault",
      portfolioId: "vault",
      tempo: "Capital",
      executionMode: "live",
      accountId: "synth-usd",
      instrumentId: "zzz-usd",
      direction: "long",
      markPrice: 200,
      currency: "USD",
      lots: [{ quantity: 5, cost: 100, tier: "c1" }],
    },
  ],
};

/** A loadable v2 record: a price mark on the invented instrument. */
function markZzz(price: number, id = "mark-zzz"): string {
  return JSON.stringify({ id, asOf: "2026-03-02", type: "PriceMarked", instrumentId: "zzz-usd", price });
}

/** A v1-shape close of the genesis position: no settlement cash leg, so unloadable. */
const LEGACY_CLOSE_ID = "legacy-close-zzz";
const LEGACY_CLOSE = JSON.stringify({
  id: LEGACY_CLOSE_ID,
  asOf: "2026-03-03",
  type: "PositionClosed",
  positionId: "zzz-vault",
});

/** The leg only the operator could hold: 5 × 200 marked → 1000 proceeds back to the reserve. */
const CASH_LEGS_MAPPING = JSON.stringify({
  [LEGACY_CLOSE_ID]: { settlement: { reserveId: "reserve-vault", proceeds: 1000 } },
});

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

describe("migrate-legacy-log — the shell around the one-shot durable-log rewrite", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs.length = 0;
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-migrate-"));
    createdDirs.push(dir);
    return dir;
  }

  /**
   * A throwaway data dir holding a valid genesis and, when given, the durable-log bytes
   * VERBATIM (so a case can plant an empty log, or one the reader cannot load).
   */
  async function syntheticDataDir(log?: string): Promise<{ dir: string; logPath: string }> {
    const dir = await tempDir();
    await writeFile(join(dir, "genesis.json"), JSON.stringify(GENESIS_SEED), "utf8");
    const logPath = join(dir, "events.jsonl");
    if (log !== undefined) {
      await writeFile(logPath, log, "utf8");
    }
    return { dir, logPath };
  }

  /**
   * A throwaway working directory with a `data/` subdir — where the shell will look for
   * the mapping. `mapping` is written raw (not JSON.stringify'd) so a case can plant
   * bytes that are not JSON at all. Omit it to leave the mapping absent (ENOENT).
   */
  async function workingDir(mapping?: string): Promise<string> {
    const dir = await tempDir();
    await mkdir(join(dir, "data"), { recursive: true });
    if (mapping !== undefined) {
      await writeFile(join(dir, MAPPING_RELATIVE_PATH), mapping, "utf8");
    }
    return dir;
  }

  /**
   * Run the real `migrate-legacy-log.ts` under tsx, with stdin closed. Both knobs are
   * explicit and independent: `dataDir` becomes `NUMISMA_DATA_DIR` (where the log is),
   * `cwd` is where the CWD-relative mapping is looked up.
   */
  function runMigrate(options: { dataDir: string; cwd: string }): RunResult {
    const script = join(REPO_ROOT, "apps", "tui", "src", "migrate-legacy-log.ts");
    const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
    const env = { ...process.env, NUMISMA_DATA_DIR: options.dataDir };
    const result = spawnSync(tsx, [script], {
      encoding: "utf8",
      env,
      cwd: options.cwd,
      input: "",
    });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  /** Every `.tmp` entry in the log's own directory — the scheme stages under a UNIQUE name. */
  async function tempLitter(logPath: string): Promise<string[]> {
    const entries = await readdir(dirname(logPath));
    return entries.filter((entry) => entry.endsWith(".tmp"));
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  describe("the two stdout sentences and the touched === 0 boundary", () => {
    it("reports the rewrite of a clean log as 0 migrated, N unchanged (exit 0)", async () => {
      const log = `${markZzz(200)}\n${markZzz(210, "mark-zzz-2")}\n`;
      const { dir, logPath } = await syntheticDataDir(log);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        `Migration complete: 0 legacy record(s) migrated, 2 unchanged. Log rewritten at ${logPath}.\n`,
      );
      // Nothing goes to stderr on a success path.
      expect(result.stderr).toBe("");
      // The rewrite really happened: both lines came back schemaVersion-stamped.
      const rewritten = (await readFile(logPath, "utf8")).trim().split("\n");
      expect(rewritten).toHaveLength(2);
      expect(rewritten.every((line) => JSON.parse(line).schemaVersion === 2)).toBe(true);
      expect(await tempLitter(logPath)).toEqual([]);
    });

    it("counts a migrated legacy record separately from the unchanged ones (exit 0)", async () => {
      const { dir, logPath } = await syntheticDataDir(`${markZzz(200)}\n${LEGACY_CLOSE}\n`);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir(CASH_LEGS_MAPPING) });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        `Migration complete: 1 legacy record(s) migrated, 1 unchanged. Log rewritten at ${logPath}.\n`,
      );
      expect(result.stderr).toBe("");
      // The operator's supplied leg is what landed on disk — the shell really read the
      // mapping and really handed it down.
      const lines = (await readFile(logPath, "utf8")).trim().split("\n");
      const closed = lines.map((line) => JSON.parse(line)).find((event) => event.id === LEGACY_CLOSE_ID);
      expect(closed.settlement).toEqual({ reserveId: "reserve-vault", proceeds: 1000 });
      expect(await tempLitter(logPath)).toEqual([]);
    });

    it("says 'No durable log to migrate' and writes nothing when the log is absent (exit 0)", async () => {
      const { dir, logPath } = await syntheticDataDir();

      const result = runMigrate({ dataDir: dir, cwd: await workingDir(CASH_LEGS_MAPPING) });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`No durable log to migrate at ${logPath}.\n`);
      expect(result.stderr).toBe("");
      // The `touched === 0` branch on the honest side of the boundary: no log existed
      // before and none was conjured.
      expect(await exists(logPath)).toBe(false);
    });

    /**
     * KNOWN DEFECT — CHARACTERIZED HERE, NOT BLESSED. A FOLLOW-UP ISSUE IS OWED.
     *
     * This test asserts what the tool OBSERVABLY DOES today, and what it does is wrong:
     * it reports "No durable log to migrate" about a log it has just OVERWRITTEN.
     *
     * The mechanism: `readOptional` returns `undefined` only on ENOENT, so an existing
     * but empty (or blank-lines-only) `events.jsonl` reads back as `""` and the early
     * return at `event-store.ts:209-211` is NOT taken. `loadGenesis` runs, the line loop
     * produces no events, and `writeLogImage` is still called — with `"\n"`. The log is
     * replaced by a single newline byte, while `migratedCount + unchangedCount === 0`
     * sends the shell down the `touched === 0` branch and it prints the reassuring
     * "no log" sentence and exits 0.
     *
     * Nothing of value is lost from a log that was already empty, so this is not a live
     * data-loss incident — but the report is a lie about a write that happened, on the
     * one tool in the repo that rewrites the durable log, and the same `undefined`-only
     * ENOENT check is what stands between "empty" and "unreadable". Fixing it is a
     * behavior change and this increment is tests only; the fix belongs in its own
     * increment, with this test inverted to assert the log is left untouched.
     */
    it("KNOWN DEFECT: rewrites an EMPTY log to a single newline while reporting 'No durable log'", async () => {
      const { dir, logPath } = await syntheticDataDir("");

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      expect(result.status).toBe(0);
      // What the operator is told:
      expect(result.stdout).toBe(`No durable log to migrate at ${logPath}.\n`);
      // What actually happened to the file it just told them it did not migrate:
      expect(await readFile(logPath, "utf8")).toBe("\n");
      expect(await tempLitter(logPath)).toEqual([]);
    });

    it("KNOWN DEFECT (same seam): a blank-lines-only log is collapsed to a single newline", async () => {
      const { dir, logPath } = await syntheticDataDir("\n\n\n");

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`No durable log to migrate at ${logPath}.\n`);
      // Blank lines are records to neither half, so the loop yields nothing and the
      // three-byte image is replaced by a one-byte one — again reported as "no log".
      expect(await readFile(logPath, "utf8")).toBe("\n");
    });
  });

  describe("the mapping is read from the CWD, NOT from NUMISMA_DATA_DIR", () => {
    /**
     * The divergence, asserted both ways in one case so neither half can drift: the very
     * same data dir and the very same mapping bytes succeed from a CWD that has
     * `data/migration-cash-legs.json` and fail from one that does not. `MAPPING_PATH` is
     * a CWD-relative literal (`migrate-legacy-log.ts:29`), so running `pnpm migrate:log`
     * from a package directory instead of the repo root makes the operator's mapping
     * silently vanish and degrades the run to the "no mapping" path. That is arguably a
     * latent bug — the tool is not self-locating — but it fails LOUD (the refusal below),
     * so it destroys nothing; it just wastes the operator's time with a refusal that names
     * ids they already supplied.
     */
    it("finds the mapping from a CWD that has data/, and loses it from one that does not", async () => {
      const mappingCwd = await workingDir(CASH_LEGS_MAPPING);
      const barrenCwd = await workingDir();

      // Wrong CWD: the mapping exists on disk, but not under THIS process's CWD.
      const lost = await syntheticDataDir(`${LEGACY_CLOSE}\n`);
      const lostRun = runMigrate({ dataDir: lost.dir, cwd: barrenCwd });
      expect(lostRun.status).toBe(1);
      expect(lostRun.stderr).toMatch(/no supplied cash leg/i);
      expect(lostRun.stdout).toBe("");
      expect(await readFile(lost.logPath, "utf8")).toBe(`${LEGACY_CLOSE}\n`);

      // CONTROL — the same env and the same bytes, only the CWD differs. Without this
      // the refusal above could be a shell that never starts at all.
      const found = await syntheticDataDir(`${LEGACY_CLOSE}\n`);
      const foundRun = runMigrate({ dataDir: found.dir, cwd: mappingCwd });
      expect(foundRun.status).toBe(0);
      expect(foundRun.stdout).toMatch(/1 legacy record\(s\) migrated/);
    });
  });

  describe("mapping-file handling — pure shell logic", () => {
    it("tolerates an absent mapping (ENOENT) and lets the refusal come from downstream", async () => {
      const { dir, logPath } = await syntheticDataDir(`${LEGACY_CLOSE}\n`);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      // ENOENT is deliberately swallowed into an empty Map: the shell does not invent a
      // "mapping file missing" error, it delegates the better message — which ids need a
      // leg — to `migrateLegacyLog`.
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Migration aborted: 1 legacy record\(s\) have no supplied cash leg/);
      expect(result.stderr).toContain(LEGACY_CLOSE_ID);
      expect(result.stderr).toMatch(/supply a settlement leg/);
      expect(result.stderr.endsWith("\n")).toBe(true);
      expect(result.stdout).toBe("");
      // Byte-identical: a refusal writes nothing at all.
      expect(await readFile(logPath, "utf8")).toBe(`${LEGACY_CLOSE}\n`);
      expect(await tempLitter(logPath)).toEqual([]);
    });

    it("surfaces malformed mapping JSON as the RAW SyntaxError — no wrapper, no filename", async () => {
      const log = `${markZzz(200)}\n`;
      const { dir, logPath } = await syntheticDataDir(log);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir("{ not json") });

      expect(result.status).toBe(1);
      // `JSON.parse` throws and the trailing `.catch` prints `error.message` verbatim.
      expect(result.stderr).toMatch(/JSON/);
      // Asserting what it ACTUALLY does, not what would be kind: the operator is never
      // told WHICH file failed to parse, and there is no "could not read the mapping"
      // sentence anywhere. Worth improving; pinned here so a change is a deliberate one.
      expect(result.stderr).not.toContain("migration-cash-legs.json");
      expect(result.stderr).not.toMatch(/mapping/i);
      expect(result.stdout).toBe("");
      // It throws BEFORE the log is touched, so the log is byte-identical.
      expect(await readFile(logPath, "utf8")).toBe(log);
      expect(await tempLitter(logPath)).toEqual([]);
    });

    it("does not validate a well-formed-but-wrong mapping at all — garbage flows downstream", async () => {
      // `Object.entries` is applied to whatever parsed, behind an unchecked
      // `as Record<string, SuppliedCashLeg>`. None of these are a mapping; the shell has
      // no opinion about any of them.
      const log = `${markZzz(200)}\n`;
      for (const mapping of ["[]", '"x"', '{"id": 42}']) {
        const { dir, logPath } = await syntheticDataDir(log);

        const result = runMigrate({ dataDir: dir, cwd: await workingDir(mapping) });

        // No complaint about the mapping; the run completes as if none were supplied.
        // (`"x"` even becomes the entry `"0" -> "x"`, and `{"id": 42}` the entry
        // `"id" -> 42` — a number where a cash leg belongs — with nobody looking.)
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(
          `Migration complete: 0 legacy record(s) migrated, 1 unchanged. Log rewritten at ${logPath}.\n`,
        );
        expect(result.stderr).toBe("");
      }
    });

    it("a wrong-shaped mapping cannot rescue a legacy record — it just is not the leg", async () => {
      const { dir, logPath } = await syntheticDataDir(`${LEGACY_CLOSE}\n`);

      // Structurally valid JSON, keyed by something that is not this event's id.
      const result = runMigrate({ dataDir: dir, cwd: await workingDir('{"id": 42}') });

      // The refusal that arrives is the DOWNSTREAM one about a missing leg, not a shell
      // "your mapping is malformed" — because the shell never checks. A mapping with a
      // typo'd key is indistinguishable here from no mapping at all.
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/no supplied cash leg/i);
      expect(await readFile(logPath, "utf8")).toBe(`${LEGACY_CLOSE}\n`);
    });
  });

  describe("NUMISMA_DATA_DIR plumbing and the exit-code mapping", () => {
    it("rejects a RELATIVE NUMISMA_DATA_DIR as a split-brain ledger (exit 1)", async () => {
      const log = `${markZzz(200)}\n`;
      const { logPath } = await syntheticDataDir(log);
      const cwd = await workingDir(CASH_LEGS_MAPPING);

      const script = join(REPO_ROOT, "apps", "tui", "src", "migrate-legacy-log.ts");
      const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
      const result = spawnSync(tsx, [script], {
        encoding: "utf8",
        env: { ...process.env, NUMISMA_DATA_DIR: "data" },
        cwd,
        input: "",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/split-brain ledger/i);
      expect(result.stderr).toMatch(/must be an absolute path/i);
      expect(result.stdout).toBe("");
      // It refuses at resolution time, so neither the ledger it would have guessed at
      // (`$CWD/data`, which really exists here and holds the mapping) nor the real
      // fixture log is touched.
      expect(await exists(join(cwd, "data", "events.jsonl"))).toBe(false);
      expect(await readFile(logPath, "utf8")).toBe(log);
    });

    it("exits 1 with the abort message on stderr when the migration itself refuses", async () => {
      // A second legacy record with no leg, to pin that the shell surfaces the delegate's
      // ACCUMULATED refusal (both ids in one message) rather than the first failure only.
      const secondLegacy = JSON.stringify({
        id: "legacy-close-zzz-2",
        asOf: "2026-03-04",
        type: "PositionClosed",
        positionId: "zzz-vault",
      });
      const log = `${LEGACY_CLOSE}\n${secondLegacy}\n`;
      const { dir, logPath } = await syntheticDataDir(log);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Migration aborted: 2 legacy record\(s\) have no supplied cash leg/);
      expect(result.stderr).toContain("line 1");
      expect(result.stderr).toContain("line 2");
      expect(result.stdout).toBe("");
      expect(await readFile(logPath, "utf8")).toBe(log);
      expect(await tempLitter(logPath)).toEqual([]);
    });

    it("exits 1 on an unparseable log line, leaving the log byte-identical", async () => {
      const log = `${markZzz(200)}\nthis is not JSON\n`;
      const { dir, logPath } = await syntheticDataDir(log);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir(CASH_LEGS_MAPPING) });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/line 2 is not valid JSON/);
      expect(result.stdout).toBe("");
      expect(await readFile(logPath, "utf8")).toBe(log);
      expect(await tempLitter(logPath)).toEqual([]);
    });

    it("exits 1 when the data dir has no genesis to migrate against", async () => {
      const dir = await tempDir();
      const logPath = join(dir, "events.jsonl");
      const log = `${markZzz(200)}\n`;
      await writeFile(logPath, log, "utf8");

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      // `loadGenesis` reads AFTER the log read, so this is the shell's `.catch` carrying
      // an fs error through the same one exit path — not a bespoke branch.
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/genesis\.json/);
      expect(result.stdout).toBe("");
      expect(await readFile(logPath, "utf8")).toBe(log);
    });
  });
});
