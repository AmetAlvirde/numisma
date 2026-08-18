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
 * already use. `input: ""` closes stdin so a shell can never hang on a read, and every
 * spawn carries an explicit `timeout` — vitest's `testTimeout` cannot preempt a blocking
 * `spawnSync`, so without it a shell that waited would hang the worker rather than fail.
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
 * real ledger is unreachable: the runner's `dataDir` is REQUIRED and becomes
 * `NUMISMA_DATA_DIR` verbatim, so every run names a throwaway `mkdtemp` dir (or, in the
 * one relative-path case, the relative string under test). There is no default — an empty
 * value would resolve to the real accumulus ledger.
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

interface ShellRun {
  status: number | null;
  signal: NodeJS.Signals | null;
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
   * explicit and independent: `dataDir` becomes `NUMISMA_DATA_DIR` VERBATIM (where the log
   * is, or the relative string a case is putting under test), `cwd` is where the
   * CWD-relative mapping is looked up. Both are REQUIRED — there is no default, because an
   * empty `NUMISMA_DATA_DIR` resolves to the real accumulus ledger.
   *
   * EVERY spawn in this file goes through here, including the relative-path case, so the
   * timeout below covers all of them.
   */
  function runMigrate(options: { dataDir: string; cwd: string }): ShellRun {
    const script = join(REPO_ROOT, "apps", "tui", "src", "migrate-legacy-log.ts");
    const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
    const env = { ...process.env, NUMISMA_DATA_DIR: options.dataDir };
    const result = spawnSync(tsx, [script], {
      encoding: "utf8",
      env,
      cwd: options.cwd,
      input: "",
      // `vi.setConfig({ testTimeout })` cannot cover a blocking `spawnSync`: it is a timer
      // on the same thread and cannot preempt the call. Without this, a shell that grew a
      // confirmation prompt — the obvious next change to the one tool that rewrites the
      // durable log — would block the worker indefinitely with no diagnostic instead of
      // failing. The timeout turns that into a KILLED process, which `expectExited` reads.
      timeout: 20_000,
    });
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  /**
   * Asserted on EVERY path: the process ended on its own rather than being killed by the
   * runner's timeout. `migrate:log` reads no input, so a run that waits is already a bug.
   */
  function expectExited(run: ShellRun): void {
    expect(run.signal).toBeNull();
    expect(typeof run.status).toBe("number");
  }

  /** Every `.tmp`/`.lock` entry in a directory — the scheme stages under a UNIQUE name. */
  async function litter(dir: string): Promise<string[]> {
    return (await readdir(dir)).filter(
      (entry) => entry.endsWith(".tmp") || entry.endsWith(".lock"),
    );
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

      expectExited(result);
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
      expect(await litter(dir)).toEqual([]);
    });

    it("counts a migrated legacy record separately from the unchanged ones (exit 0)", async () => {
      const { dir, logPath } = await syntheticDataDir(`${markZzz(200)}\n${LEGACY_CLOSE}\n`);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir(CASH_LEGS_MAPPING) });

      expectExited(result);
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
      expect(await litter(dir)).toEqual([]);
    });

    it("says 'No durable log to migrate' and writes nothing when the log is absent (exit 0)", async () => {
      const { dir, logPath } = await syntheticDataDir();

      const result = runMigrate({ dataDir: dir, cwd: await workingDir(CASH_LEGS_MAPPING) });

      expectExited(result);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`No durable log to migrate at ${logPath}.\n`);
      expect(result.stderr).toBe("");
      // The `touched === 0` branch on the honest side of the boundary: no log existed
      // before and none was conjured.
      expect(await exists(logPath)).toBe(false);
    });

    /**
     * A CONTENTLESS LOG IS THE SAME ANSWER AS A MISSING ONE — the sentence and the
     * untouched bytes both. Fixed under #345; the two cases below are one seam, and this
     * is the note that keeps them fixed.
     *
     * WHAT WENT WRONG BEFORE. `readOptional` returns `undefined` only on ENOENT, so an
     * existing but empty (or blank-lines-only) `events.jsonl` read back as `""` and the
     * early return in `migrateLegacyLog` was NOT taken. `loadGenesis` ran, the line loop
     * produced no events, and `writeLogImage` was still called — with `"\n"`. The log was
     * replaced by a single newline byte, while `migratedCount + unchangedCount === 0` sent
     * the shell down the `touched === 0` branch, so it printed the reassuring "no log"
     * sentence and exited 0: a lie about a write that happened, on the one tool in the
     * repo that rewrites the durable log.
     *
     * WHY THE FIX IS NOT IN `readOptional`, AND MUST NOT MOVE THERE. Its ENOENT-only
     * contract is what every other caller reads it for — "absent" and "present but empty"
     * are different facts, and the price feed's inbox and the preferences copy both lean
     * on the distinction. Widening it to fold `""` into `undefined` would silence this
     * case by destroying the signal that separates an empty log from an unreadable one.
     * The guard belongs in `migrateLegacyLog`, where "nothing to migrate" is a policy
     * this tool owns.
     *
     * BOTH CASES, ONE GUARD. The predicate is "no content once blank lines are
     * discarded", which is the loop's own rule hoisted above the write — so the
     * blank-lines-only log below cannot drift back to being handled separately, or at
     * all.
     */
    it("leaves an EMPTY log untouched and says 'No durable log to migrate' (exit 0, #345)", async () => {
      const { dir, logPath } = await syntheticDataDir("");

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      expectExited(result);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`No durable log to migrate at ${logPath}.\n`);
      expect(result.stderr).toBe("");
      // The report and the disk agree: the file it says it did not migrate is byte-for-byte
      // what it was.
      expect(await readFile(logPath, "utf8")).toBe("");
      expect(await litter(dir)).toEqual([]);
    });

    it("leaves a blank-lines-only log untouched at its original bytes (exit 0, #345)", async () => {
      const { dir, logPath } = await syntheticDataDir("\n\n\n");

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      expectExited(result);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`No durable log to migrate at ${logPath}.\n`);
      expect(result.stderr).toBe("");
      // Blank lines are records to neither half, so this log carries no content — and the
      // guard reads it the same way the loop does. All three bytes survive.
      expect(await readFile(logPath, "utf8")).toBe("\n\n\n");
      expect(await litter(dir)).toEqual([]);
    });

    /**
     * THE ORDERING HALF OF THE #345 GUARD, WHICH THE TWO CASES ABOVE DO NOT PIN. Both of
     * them plant a valid `genesis.json`, so both stay green whether the guard sits above
     * `loadGenesis` (`event-store.ts`) or below it. This case is the one that cares WHERE
     * it sits: with no genesis on disk at all, an empty log exits 0 with the "no log"
     * sentence only if the guard returns FIRST. Move it below the read and this run exits
     * 1 naming `genesis.json` instead — which is exactly the mutation this case exists to
     * catch, and the reason it is worth its spawn.
     *
     * IT IS ALSO A BEHAVIOUR CHANGE THIS PR MADE AND NOTHING ELSE RECORDED. Before #345 an
     * empty log plus a missing genesis DID exit 1 naming `genesis.json`. The change is
     * deliberate and consistent — the case two blocks up, `says 'No durable log to
     * migrate' … when the log is absent`, already returns above the genesis read for an
     * ABSENT log, and #345's whole claim is that a contentless log is the same answer as a
     * missing one. Two shapes cannot be "one seam" and then take different doors out. This
     * case is where that consistency is written down as behaviour rather than as a comment.
     *
     * The contrast case lives at the bottom of this file (`exits 1 when the data dir has no
     * genesis to migrate against`): same missing genesis, but a log WITH CONTENT, which
     * still refuses. Nothing here softens that — a run that has records to migrate still
     * needs the genesis to cross-reference them against.
     */
    it("needs no genesis at all to report an empty log as nothing to migrate (exit 0)", async () => {
      // NOT `syntheticDataDir` — that helper always plants a genesis, which is the whole
      // thing this case must NOT have. A bare temp dir holding one empty file.
      const dir = await tempDir();
      const logPath = join(dir, "events.jsonl");
      await writeFile(logPath, "", "utf8");
      expect(await exists(join(dir, "genesis.json"))).toBe(false);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      expectExited(result);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`No durable log to migrate at ${logPath}.\n`);
      // AND NOTHING ON STDERR: no genesis complaint leaks out alongside the 0. An exit code
      // that says "fine" over a stderr that names a broken file is the worst of both.
      expect(result.stderr).toBe("");
      expect(result.stderr).not.toMatch(/genesis/);
      // Byte-for-byte: the run that says it migrated nothing wrote nothing, and did not
      // conjure a genesis on the way past either.
      expect(await readFile(logPath, "utf8")).toBe("");
      expect(await exists(join(dir, "genesis.json"))).toBe(false);
      expect(await litter(dir)).toEqual([]);
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
      expectExited(lostRun);
      expect(lostRun.status).toBe(1);
      expect(lostRun.stderr).toMatch(/no supplied cash leg/i);
      expect(lostRun.stdout).toBe("");
      expect(await readFile(lost.logPath, "utf8")).toBe(`${LEGACY_CLOSE}\n`);

      // CONTROL — the same env and the same bytes, only the CWD differs. Without this
      // the refusal above could be a shell that never starts at all.
      const found = await syntheticDataDir(`${LEGACY_CLOSE}\n`);
      const foundRun = runMigrate({ dataDir: found.dir, cwd: mappingCwd });
      expectExited(foundRun);
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
      expectExited(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Migration aborted: 1 legacy record\(s\) have no supplied cash leg/);
      expect(result.stderr).toContain(LEGACY_CLOSE_ID);
      expect(result.stderr).toMatch(/supply a settlement leg/);
      expect(result.stderr.endsWith("\n")).toBe(true);
      expect(result.stdout).toBe("");
      // Byte-identical: a refusal writes nothing at all.
      expect(await readFile(logPath, "utf8")).toBe(`${LEGACY_CLOSE}\n`);
      expect(await litter(dir)).toEqual([]);
    });

    it("surfaces malformed mapping JSON as the RAW SyntaxError — no wrapper, no filename", async () => {
      const log = `${markZzz(200)}\n`;
      const { dir, logPath } = await syntheticDataDir(log);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir("{ not json") });

      expectExited(result);
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
      expect(await litter(dir)).toEqual([]);
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
        expectExited(result);
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
      expectExited(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/no supplied cash leg/i);
      expect(await readFile(logPath, "utf8")).toBe(`${LEGACY_CLOSE}\n`);
    });
  });

  describe("NUMISMA_DATA_DIR plumbing and the exit-code mapping", () => {
    it("rejects a RELATIVE NUMISMA_DATA_DIR as a split-brain ledger (exit 1)", async () => {
      // `$CWD/data` really exists here and holds the mapping, so the relative value names
      // a directory the tool could plausibly have used.
      const cwd = await workingDir(CASH_LEGS_MAPPING);

      // Through the file's own runner — `dataDir` is the LITERAL env value, so the
      // relative string goes in here rather than being hand-rolled around the helper and
      // silently missing its timeout.
      const result = runMigrate({ dataDir: "data", cwd });

      expectExited(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/split-brain ledger/i);
      expect(result.stderr).toMatch(/must be an absolute path/i);
      expect(result.stdout).toBe("");
      // The refusal at resolution time IS the whole assertion, and there is deliberately
      // no "and nothing was written" check beside it: none is available here. If the
      // relative value WERE accepted, `$CWD/data` holds no `events.jsonl`, so
      // `readOptional` returns undefined and `migrateLegacyLog` early-returns at
      // `event-store.ts:209-211` — nothing is written anywhere. An absent-file probe or a
      // byte-comparison against a fixture log would therefore both pass under the very
      // mutation they read as guarding. `status === 1` is what actually catches it.
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

      expectExited(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Migration aborted: 2 legacy record\(s\) have no supplied cash leg/);
      expect(result.stderr).toContain("line 1");
      expect(result.stderr).toContain("line 2");
      expect(result.stdout).toBe("");
      expect(await readFile(logPath, "utf8")).toBe(log);
      expect(await litter(dir)).toEqual([]);
    });

    it("exits 1 on an unparseable log line, leaving the log byte-identical", async () => {
      const log = `${markZzz(200)}\nthis is not JSON\n`;
      const { dir, logPath } = await syntheticDataDir(log);

      const result = runMigrate({ dataDir: dir, cwd: await workingDir(CASH_LEGS_MAPPING) });

      expectExited(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/line 2 is not valid JSON/);
      expect(result.stdout).toBe("");
      expect(await readFile(logPath, "utf8")).toBe(log);
      expect(await litter(dir)).toEqual([]);
    });

    it("exits 1 when the data dir has no genesis to migrate against", async () => {
      const dir = await tempDir();
      const logPath = join(dir, "events.jsonl");
      const log = `${markZzz(200)}\n`;
      await writeFile(logPath, log, "utf8");

      const result = runMigrate({ dataDir: dir, cwd: await workingDir() });

      // `loadGenesis` reads AFTER the log read, so this is the shell's `.catch` carrying
      // an fs error through the same one exit path — not a bespoke branch.
      expectExited(result);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/genesis\.json/);
      expect(result.stdout).toBe("");
      expect(await readFile(logPath, "utf8")).toBe(log);
    });
  });
});
