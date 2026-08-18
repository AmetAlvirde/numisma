/**
 * THE IMPORT SHELL'S OWN CONTRACT — argv, exit codes, env plumbing, readline lifecycle.
 *
 * `import-orders-cli.ts` is wiring, and every one of its own decisions was untested: the
 * usage branch, the THREE-WAY exit-code mapping it performs over the flow's outcome, the
 * one env var it resolves three independent paths from, and the `finally` that closes the
 * prompt. The flow it delegates to — `importBitgetOpenOrders` and its twelve refusal
 * reasons — is covered by eight sibling suites (`import-orders.test.ts` and friends), and
 * NOTHING HERE RE-TESTS THAT TAXONOMY. Where a refusal appears below it is being used as a
 * probe for the shell's wiring: which PATH the message names, which CHANNEL it went to,
 * which exit code the shell chose for it.
 *
 * THE MOST IMPORTANT LINE IN THIS FILE is the `imported-partial` case. That branch exits
 * ZERO deliberately, under a fifteen-line rationale citing ADR-014 and #183 — nothing was
 * REFUSED, so exiting 1 would tell a caller the run failed when it did not — and it names
 * its own re-trigger: if the import is ever automated or piped, the exit code becomes the
 * only surface left and the branch must be revisited BEFORE that lands. A documented,
 * deliberate, fragile decision with no test under it is one refactor away from silently
 * becoming a 1, so it is pinned here by a test whose name says why the code is 0.
 *
 * WHY IT SPAWNS. The shell is top-level `if`/`else` with top-level `await` — no `main`, no
 * exports — so importing it RUNS THE IMPORT. Spawning `tsx` against the source is the only
 * door, the same shape `record-fill-cli.test.ts` uses. `input` is always supplied so the
 * readline prompt gets EOF or an authored answer instead of hanging, and every runner call
 * carries a `timeout` so a shell that failed to close its prompt surfaces as a KILLED
 * process rather than as a stuck suite. A spawn's stdin is a PIPE, never a terminal, which
 * is not merely an incidental property of this harness — since #346 it is the condition the
 * last block below tests, and the reason `no-reserve-declared` is assertable at all.
 *
 * EVERY FIXTURE IS AUTHORED — invented ids, an invented instrument, round decade prices,
 * round balances. Nothing is seeded from, or shaped by, a real export, a real ladder or a
 * real ledger, and the real data dir is unreachable: `NUMISMA_DATA_DIR` is set explicitly
 * on EVERY run, always to a throwaway `mkdtemp` directory.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BITGET_OPEN_ORDERS_HEADER,
  canonicalDecimal,
  serializeOrderRecord,
  synthesizeOrderId,
  type OrderRecord,
} from "@numisma/engine";

// Spawning `tsx` costs a cold TypeScript start; give it headroom under load.
vi.setConfig({ testTimeout: 30_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = apps/tui/src → the repo root is three levels up.
const REPO_ROOT = resolve(HERE, "../../..");

/** A synthetic fund: one portfolio, one account, one instrument, one live reserve. */
const GENESIS_SEED = {
  fund: { id: "fund-authored", name: "Authored", baseCurrency: "USD" },
  review: { asOf: "2026-01-01", usdMxn: 20 },
  portfolios: [{ id: "portfolio-authored", name: "Authored" }],
  accounts: [
    { id: "account-authored", name: "Authored Venue", platform: "SYNTH", currency: "USD" },
  ],
  instruments: [
    { id: "instrument-authored", name: "Authored Asset", symbol: "TEST", currency: "USD" },
  ],
  reserves: [
    {
      id: "reserve-authored",
      portfolioId: "portfolio-authored",
      tempo: "Capital",
      executionMode: "live",
      accountId: "account-authored",
      currency: "USD",
      amount: 10000,
      lots: [{ quantity: 10000, tier: "c1" }],
    },
  ],
  positions: [],
};

const HEADER = BITGET_OPEN_ORDERS_HEADER.join(",");

/** One export row, authored column by column in the venue's own order. */
function exportRow(cells: {
  timestamp: string;
  price: string;
  quantity: string;
  filled: string;
  status: string;
}): string {
  return [
    cells.timestamp,
    "TEST/USDT",
    "GTC",
    "Limit",
    "Buy",
    cells.price,
    cells.quantity,
    "-- / --",
    "4000",
    cells.filled,
    cells.quantity,
    "0%",
    cells.status,
    "Cancel",
  ].join(",");
}

/** The id the parser will synthesize for a row — computed the way the parser computes it. */
function authoredId(price: string, observedAt: string): string {
  return synthesizeOrderId({
    venue: "bitget",
    symbol: "TESTUSDT",
    side: "buy",
    // `canonicalDecimal` is total; these are authored, well-formed decimals.
    price: canonicalDecimal(price) ?? price,
    observedAt,
  });
}

/** A rung the venue shows 4 of 10 filled — an id already on file, further filled since. */
const RESTATED_STAMP = "2026-01-02T09:00:00";
const RESTATED_ROW = exportRow({
  timestamp: "2026-01-02 09:00:00",
  price: "400",
  quantity: "10",
  filled: "4",
  status: "Partially Filled",
});
const RESTATED_ID = authoredId("400", RESTATED_STAMP);

/** A row nobody can read — an unreadable PRICE, which `leavesRungUnweighed` counts. */
const UNREADABLE_ROW = exportRow({
  timestamp: "2026-01-02 09:30:00",
  price: "not-a-price",
  quantity: "10",
  filled: "0",
  status: "unfilled",
});

/** A rung the file has never seen — the one shape that reaches the funding interview. */
const FRESH_ROW = exportRow({
  timestamp: "2026-01-02 10:00:00",
  price: "300",
  quantity: "10",
  filled: "0",
  status: "unfilled",
});

/** The placement line `RESTATED_ROW` restates: same size, a SMALLER observed partial. */
function placementOnFile(): OrderRecord {
  return {
    id: RESTATED_ID,
    observedAt: RESTATED_STAMP,
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TESTUSDT",
    side: "buy",
    price: 400,
    quantity: 10,
    observedFilledQuantity: 2,
    fundingReserveId: "reserve-authored",
  };
}

interface ShellRun {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

// NOT "readline", WHICH THIS TITLE USED TO CLAIM. Every case here is a `spawnSync` with a
// piped stdin, so `process.stdin.isTTY` is falsy in all of them and the `isTTY` guard in
// `ask` returns before `createInterface` is ever called. No case in this file constructs a
// readline interface, and therefore none can observe one being closed. What IS pinned is
// the no-terminal branch in front of it — the notice, its placement at the first
// unanswerable question, and the empty answer the domain then refuses on.
describe("import-orders-cli — the shell's own contract (argv, exit codes, env, no-terminal stdin)", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs.length = 0;
  });

  /** A throwaway data dir. `files` is written verbatim, so a case can plant a bad one. */
  async function dataDir(files: Record<string, string> = {}): Promise<string> {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-import-cli-"));
    createdDirs.push(dir);
    await writeFile(join(dir, "genesis.json"), JSON.stringify(GENESIS_SEED), "utf8");
    await writeFile(join(dir, "events.jsonl"), "", "utf8");
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, "utf8");
    }
    return dir;
  }

  /** Write an export beside the data dir and return its path. */
  async function exportFile(dir: string, rows: readonly string[]): Promise<string> {
    const path = join(dir, "open-orders-export.csv");
    await writeFile(path, [HEADER, ...rows].join("\n") + "\n", "utf8");
    return path;
  }

  /**
   * Run the real `import-orders-cli.ts` under tsx. `dataDir` is REQUIRED — the real
   * accumulus dir must never be reachable from here, so the env var is always set.
   */
  function runImport(
    args: readonly string[],
    options: { dataDir: string; input?: string },
  ): ShellRun {
    const script = join(REPO_ROOT, "apps", "tui", "src", "import-orders-cli.ts");
    const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
    const env = { ...process.env, NUMISMA_DATA_DIR: options.dataDir };
    const result = spawnSync(tsx, [script, ...args], {
      encoding: "utf8",
      env,
      input: options.input ?? "",
      // A shell that never closed its readline would block here forever; the timeout
      // turns that into a KILLED process, which `expectExited` reads as a failure.
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
   * THE TERMINATION ASSERTION, MADE ON EVERY PATH: the process ended on its own rather than
   * being killed by the runner's timeout, which arrives as a signal instead of a status.
   *
   * IT IS NOT A READLINE-LIFECYCLE ASSERTION, WHICH IS WHAT THIS DOC USED TO IMPLY. The
   * `finally { rl?.close() }` in the shell is never exercised from here: no case in this
   * file has a TTY on stdin, so `rl` is `undefined` on every one of them and deleting the
   * whole `finally` block leaves all of them green. The close is correct — verified by hand
   * against a real pty — and it is what keeps a REAL interview from leaving stdin open, but
   * both halves of its lifecycle, the `createInterface` and the `close`, are observable only
   * from a terminal, and a spawned test cannot stand in one. What this function actually
   * holds down is that no path here HANGS — which, on a piped stdin, is a claim about the
   * no-terminal branch returning promptly rather than about an interface being closed.
   */
  function expectExited(run: ShellRun): void {
    expect(run.signal).toBeNull();
    expect(typeof run.status).toBe("number");
  }

  /** Every `.tmp`/`.lock` entry in a directory — the staging name is UNIQUE per write. */
  async function litter(dir: string): Promise<string[]> {
    return (await readdir(dir)).filter(
      (entry) => entry.endsWith(".tmp") || entry.endsWith(".lock"),
    );
  }

  it("prints usage to STDERR and exits 1 with no argument, touching no data dir", async () => {
    const dir = await dataDir();
    const before = (await readdir(dir)).sort();

    const run = runImport([], { dataDir: dir });

    expectExited(run);
    expect(run.status).toBe(1);
    // The channel is the assertion: usage is a refusal to run, not output.
    expect(run.stderr).toBe("usage: pnpm orders:import <path/to/open-orders-export.csv>\n");
    expect(run.stdout).toBe("");
    // No readline is constructed on this branch and the data dir is never resolved, let
    // alone written — no sidecar appears, and no temp sibling of one either.
    expect((await readdir(dir)).sort()).toEqual(before);
  });

  it("treats an EMPTY first argument as no argument at all", async () => {
    const dir = await dataDir();

    // `!csvPath` covers both shapes; a truthiness test is the reason `""` is not a path
    // this shell then tries to read.
    const run = runImport([""], { dataDir: dir });

    expectExited(run);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("usage: pnpm orders:import");
    expect(run.stdout).toBe("");
  });

  it("exits 0 on imported-partial because NOTHING WAS REFUSED, not 1 (ADR-014, #183)", async () => {
    // THE PIN ON THE SHELL'S MOST DELIBERATE DECISION. `imported-partial` is a SUCCESS
    // carrying a qualification — one row nobody could read — and the branch exits 0 under
    // a rationale that says so at length. A caller reading the exit code is told the run
    // did not fail, because it did not. If this ever has to become 1 (the rationale names
    // the trigger: an automated or piped import, where the code is the only surface left),
    // that is a decision to be made deliberately — this test is what makes it deliberate.
    const dir = await dataDir({
      "orders.jsonl": `${serializeOrderRecord(placementOnFile())}\n`,
    });
    const csv = await exportFile(dir, [UNREADABLE_ROW, RESTATED_ROW]);

    const run = runImport([csv], { dataDir: dir });

    expectExited(run);
    expect(run.status).toBe(0);
    // The qualification is real and reported — this is not a clean run mislabelled.
    expect(run.stdout).toMatch(/INCOMPLETE — 1 row\(s\)/);
    expect(run.stdout).toMatch(/1 observation\(s\) recorded/);
    // And the unreadable row was reported on the error channel, where per-row problems go.
    expect(run.stderr).toContain(`${csv}:2 skipped`);
    // The operator was never taken into the interview: every readable rung was already on
    // file, so there was nothing to attribute.
    //
    // THE PROOF IS THE MISSING NO-TERMINAL NOTICE, not the missing prompt text. Asserting
    // that `Funding reserve for this batch` never reaches stdout was the obvious probe and
    // it went vacuous under #346: that string exists only as the argument handed to `ask`
    // (`import-orders-funding-declaration.ts:68`), and a spawned run takes the no-terminal
    // branch, which returns "" WITHOUT writing the question anywhere. The absence proved
    // nothing — it holds on a run that asked and on a run that did not. The notice does
    // discriminate: `ask` writes it the first time it is called on a stdin that is no
    // terminal, so stderr staying clean of it is the observable fact that NO QUESTION WAS
    // PUT AT ALL. Its twin is the no-terminal block below, where a run that DOES reach the
    // funding question writes exactly that notice — same probe, opposite sign.
    expect(run.stderr).not.toMatch(/No terminal on stdin/);
  });

  it("exits 0 on imported and leaves no temp sibling beside the sidecar it wrote", async () => {
    const plans = "this line is authored, and this import must not touch it\n";
    const dir = await dataDir({
      "orders.jsonl": `${serializeOrderRecord(placementOnFile())}\n`,
      "plans.jsonl": plans,
    });
    const csv = await exportFile(dir, [RESTATED_ROW]);

    const run = runImport([csv], { dataDir: dir });

    expectExited(run);
    expect(run.status).toBe(0);
    // The same run WITHOUT the unreadable row: nothing qualified, so no notice.
    expect(run.stdout).not.toMatch(/INCOMPLETE/);
    expect(run.stdout).toMatch(/Imported .*: 0 order\(s\) appended/);
    // The restatement landed as its own line — the shell bound a real filesystem, so the
    // sidecar on disk is the evidence the wiring was end-to-end.
    expect(await readFile(join(dir, "orders.jsonl"), "utf8")).toContain("orderFillObserved");
    // Over the DIRECTORY, never a guessed `${path}.tmp`: the staging sibling is uniquely
    // named per write, so probing one literal name would pass vacuously.
    expect(await litter(dir)).toEqual([]);
    // A WEAK GUARD, KEPT AND LABELLED AS ONE. The plans sidecar is read-only on this path
    // (#286), but this comparison is not what proves it: `loadInForceLadders` has exactly
    // one call site (`import-orders.ts:596`), inside `if (admitted.length > 0)` and AFTER
    // `declareFunding` — i.e. behind the interview wall a non-interactive spawn cannot get
    // past. This case admits nothing, so `plans.jsonl` is never OPENED, and an unread file
    // cannot fail a byte-comparison. (The proof: the fixture below is not JSON, yet stderr
    // on this run is empty — a read would have printed `:1 skipped (invalid)`.)
    //
    // It is kept only as a cheap tripwire for a write on some OTHER path that this run
    // does reach. It would NOT catch the natural #286 follow-on — writing the accepted
    // rung pick back after `:596` — which needs a test that can answer the interview.
    expect(await readFile(join(dir, "plans.jsonl"), "utf8")).toBe(plans);
  });

  it("exits 1 when the flow refuses, and the refusal names the resolved orders path", async () => {
    const dir = await dataDir();
    const missing = join(dir, "never-exported.csv");

    const run = runImport([missing], { dataDir: dir });

    expectExited(run);
    // The third arm of the mapping: rejected → 1, against imported / imported-partial → 0.
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`REFUSED — could not read ${missing}`);
    // THE WIRING, not the taxonomy: the sentence names the orders path THIS shell
    // resolved, so a refusal cannot be reported about some other file than the one the
    // run would have written.
    expect(run.stderr).toContain(`Nothing was written to ${join(dir, "orders.jsonl")}.`);
    expect(run.stdout).toBe("");
  });

  it("refuses a RELATIVE NUMISMA_DATA_DIR through the shell's outer catch, exit 1", async () => {
    const dir = await dataDir();
    const csv = await exportFile(dir, [FRESH_ROW]);

    // `resolveOrdersPath()` throws INSIDE the try, so this path exercises the outer catch:
    // the message reaches stderr and the run exits 1. It does NOT exercise the `finally`'s
    // `rl?.close()` in any meaningful sense — stdin here is a pipe, no question was ever
    // put, and `rl` is `undefined`, so the optional call is a no-op. What the `finally`
    // costs on this path is exactly the nothing the `?.` was written to cost.
    const run = runImport([csv], { dataDir: "data" });

    expectExited(run);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/split-brain ledger/);
    expect(run.stdout).toBe("");
  });

  it("moves the resolved data-dir paths with NUMISMA_DATA_DIR, never the default root", async () => {
    // TWO DIRS, ONE KNOB. The refusal sentence names the ORDERS path this shell resolved,
    // so running the same refusal under two different values shows the resolution
    // FOLLOWING the env var rather than merely happening to sit somewhere plausible.
    //
    // THE OTHER TWO RESOLVERS SIT BEHIND THE PROMPT and STILL cannot be reached from a
    // spawned run: #346 made a piped run refuse the interview rather than answer it, which
    // moved the wall without removing it — see the no-terminal block below — so what is
    // pinned here is the reachable one plus the negative that matters: no run falls back
    // to the real accumulus root. `resolvePlansPath` and `resolveEventStorePaths` share
    // `resolveDataDir` with `resolveOrdersPath`, and that agreement is pinned at the
    // resolver (`packages/preferences/src/plans-reliable.test.ts`, the data-dir drift
    // test) rather than re-derived here through an interview this harness cannot answer.
    const first = await dataDir();
    const second = await dataDir();

    const one = runImport([join(first, "never-exported.csv")], { dataDir: first });
    const two = runImport([join(second, "never-exported.csv")], { dataDir: second });

    expectExited(one);
    expectExited(two);
    expect(one.stderr).toContain(`Nothing was written to ${join(first, "orders.jsonl")}.`);
    expect(two.stderr).toContain(`Nothing was written to ${join(second, "orders.jsonl")}.`);
    expect(one.stderr).not.toContain(second);
    expect(one.stderr).not.toMatch(/accumulus/);
    expect(two.stderr).not.toMatch(/accumulus/);
  });

  describe("a stdin that is no terminal — the interview has nowhere to happen (#346)", () => {
    // THE CASE THIS BLOCK REPLACED asserted `readline was closed`, a readline internal that
    // reached the operator verbatim: `createInterface` was constructed at module scope and
    // eagerly consumed a piped stdin, so the stream had already ended by the time the first
    // question was put. The shell now builds the interface AT the first question, and when
    // stdin is no terminal it never builds one at all — it says so in its own voice and
    // returns an empty answer, which is the one honest answer an unattended run can give.
    //
    // WHAT THAT UNLOCKS is the first test in this repo of `no-reserve-declared`
    // (`import-orders.ts:588`). That refusal fires only when `declareFunding` returns
    // undefined, which happens only on an empty batch answer — so before this change it was
    // reachable exclusively from a TTY, i.e. from nowhere a test can stand. The shell
    // returning "" rather than throwing is what puts it under a spawn.

    it("names the missing terminal, lets the FLOW refuse, exits 1, writes nothing", async () => {
      const dir = await dataDir();
      // A fresh rung: nothing on file to compare it against, so it is ADMITTED and the
      // flow reaches the funding interview. The only export shape that gets this far.
      const csv = await exportFile(dir, [FRESH_ROW]);

      const run = runImport([csv], { dataDir: dir });

      expectExited(run);
      expect(run.status).toBe(1);
      // THE SHELL'S SENTENCE — a consequence, not a rule, and not a readline internal.
      expect(run.stderr).toContain(
        "No terminal on stdin: this import is an interview — it asks which reserve funds " +
          "the batch — and there is nowhere to conduct it, so every question goes " +
          "unanswered. Run it from a terminal.",
      );
      // WHAT IT HONESTLY DOES NOT PIN, in the voice this file uses for that: the notice is
      // written ONCE PER RUN rather than once per question, and no spawn can see it. This
      // used to carry a `toHaveLength(1)` count over the notice, which could not fail — a
      // no-terminal run puts EXACTLY ONE question. `import-orders.ts:586` asks the funding
      // batch question, gets "", and `:588` refuses the whole import; every later question
      // (the override pass, the rung walk) sits past that refusal, and no export shape,
      // argv, or data-dir state reaches one. Delete the `toldThereIsNoTerminal` flag
      // entirely, write the notice unconditionally, and all nine cases here stay green.
      // The flag is kept anyway — it is a boolean, and the rung walk on the far side of the
      // funding wall can put thirty questions, which is the shape that makes the difference
      // between one notice and thirty legible. Counting a one-element set proved none of it.
      // AND THE FLOW'S OWN SENTENCE, on the flow's own channel, in the flow's own voice —
      // `no-reserve-declared`, asserted end-to-end for the first time. Two refusals, two
      // layers, one story: the shell says why there was no answer, the domain says what it
      // did about it.
      expect(run.stderr).toContain(
        "REFUSED — no funding reserve was declared for this batch",
      );
      expect(run.stderr).toContain(`Nothing was written to ${join(dir, "orders.jsonl")}.`);
      // THE INTERNAL IS GONE FROM THIS PATH — the piped, non-TTY one, which is the path
      // every unattended caller and every test in this file takes, and where a readline
      // constructed anywhere would bring `readline was closed` straight back.
      //
      // SAID PRECISELY, BECAUSE THE BROADER CLAIM IS FALSE. This is not "no readline
      // internal ever reaches the operator again". At a REAL terminal, Ctrl-D on the
      // funding question still surfaces Node's own `Aborted with Ctrl+D` on stderr with
      // exit 1 — no shell sentence, no `no-reserve-declared`. Reproduced by hand on this
      // commit (`printf '\004' | script -q /dev/null tsx …`). A BLANK LINE at the same
      // terminal refuses correctly, in both voices, so this is a gap in the TTY branch
      // rather than a regression of the fix: what #346 killed is a piped run reporting a
      // readline internal instead of naming the missing terminal, and that is dead. The
      // Ctrl-D case is tracked separately; nothing here should be widened to cover it.
      expect(run.stderr).not.toMatch(/readline was closed/);
      // Refused means refused: no sidecar, and no staging sibling of one either.
      expect(await readdir(dir)).not.toContain("orders.jsonl");
      expect(await litter(dir)).toEqual([]);
    });

    it("stays SILENT about the terminal on a run that never asks a question", async () => {
      // THE PAYOFF OF BUILDING LAZILY, stated as behaviour the operator can see. Every
      // readable rung here is already on file, so nothing is admitted and no question is
      // ever put — and a shell that announced the missing terminal at STARTUP, rather than
      // at the first unanswerable question, would scold a run that had nothing to ask.
      //
      // The mutation this is pinned against is moving the NOTICE out of `ask` and up to
      // the shell's opening lines: this case goes red, the case above stays green — which
      // is exactly the difference between "lazy" and "loud".
      //
      // WHAT IT HONESTLY DOES NOT PIN, said out loud so nobody reads more into it: moving
      // `createInterface` itself back to module scope leaves all nine cases green, because
      // the `isTTY` guard returns before `rl` is ever touched and a spawned stdin is never
      // a terminal. The interface's laziness is a STRUCTURAL claim — it is what lets the
      // `finally` close only what was built — and no test standing outside a TTY can
      // observe it. The guard, the notice's placement, and the empty-answer composition
      // are the three things these two cases actually hold down.
      const dir = await dataDir({
        "orders.jsonl": `${serializeOrderRecord(placementOnFile())}\n`,
      });
      const csv = await exportFile(dir, [RESTATED_ROW]);

      const run = runImport([csv], { dataDir: dir });

      expectExited(run);
      expect(run.status).toBe(0);
      expect(run.stderr).not.toMatch(/No terminal on stdin/);
      expect(run.stderr).not.toMatch(/readline was closed/);
      // It really did the work — this is a successful import, not a silent early exit.
      expect(run.stdout).toMatch(/Imported .*: 0 order\(s\) appended/);
    });
  });
});
