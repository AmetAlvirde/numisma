/**
 * THE CANCEL SHELL'S OWN CONTRACT — argv, env and exit codes, not the flow.
 *
 * `cancel-order-cli.ts` is 43 lines of wiring with a top-level `if`/`else`, a top-level
 * `await` and no exports: importing it RUNS THE ACT, so spawning it is the only door.
 * `cancelOrder` itself — all seven rejection reasons — is already covered in
 * `apps/tui/src/cancel-order.test.ts` through an injected IO bag, and nothing here
 * re-tests those. What is covered here is only what the injected-bag suite structurally
 * cannot see:
 *
 *   - the `!orderId` usage branch, which returns BEFORE `cancelOrder` and before
 *     `resolveOrdersPath()` is ever called;
 *   - the positional mapping — that `argv[3]` really is the stamp and reaches the domain,
 *     and that its absence means "now";
 *   - `NUMISMA_DATA_DIR` → `resolveOrdersPath()` plumbing across the process boundary;
 *   - the exit-code mapping (usage → 1, rejected → 1, cancelled → 0);
 *   - the header's stated NO-TTY contract (`cancel-order-cli.ts:11-13`): "the whole
 *     assertion is in argv, so this is scriptable and does not need a TTY". Nothing
 *     pinned that, so every case runs with stdin CLOSED (`input: ""`) and stdio piped.
 *
 * EVERY FIXTURE IS SYNTHETIC — invented rung ids, round decade prices, round quantities.
 * No real order, price or balance appears here, and the real accumulus data dir is never
 * reachable: `NUMISMA_DATA_DIR` points at a throwaway `mkdtemp` directory in every case.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatObservedAt, serializeOrderRecord, type OrderRecord } from "@numisma/engine";

// Spawning `tsx` costs a cold TypeScript start; give it headroom under load.
vi.setConfig({ testTimeout: 30_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = apps/tui/src → the repo root is three levels up.
const REPO_ROOT = resolve(HERE, "../../..");

/** The exact sentence the usage branch prints — pinned character-for-character. */
const USAGE = "usage: pnpm orders:cancel <orderId> [YYYY-MM-DDTHH:MM:SS]\n";

/** A synthetic descending ladder of two resting rungs. */
function ladderRecords(): OrderRecord[] {
  return [300, 200].map((price) => ({
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

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

describe("cancel-order-cli — the shell's argv, env and exit-code contract", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs.length = 0;
  });

  /**
   * A throwaway data dir holding ONLY `orders.jsonl` — this act reads nothing else: no
   * genesis, no event log, no plans, no fold.
   */
  async function syntheticDataDir(): Promise<string> {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-cancel-cli-"));
    createdDirs.push(dir);
    await writeFile(
      join(dir, "orders.jsonl"),
      ladderRecords()
        .map((record) => `${serializeOrderRecord(record)}\n`)
        .join(""),
      "utf8",
    );
    return dir;
  }

  function ordersPath(dataDir: string): string {
    return join(dataDir, "orders.jsonl");
  }

  /** Run the real `cancel-order-cli.ts` under tsx, stdin CLOSED and stdio piped. */
  function runCancel(
    args: string[],
    options: { dataDir?: string; dataDirEnv?: string; cwd?: string } = {},
  ): Run {
    const script = join(REPO_ROOT, "apps", "tui", "src", "cancel-order-cli.ts");
    const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
    const env = {
      ...process.env,
      NUMISMA_DATA_DIR: options.dataDirEnv ?? options.dataDir ?? "",
    };
    const result = spawnSync(tsx, [script, ...args], {
      encoding: "utf8",
      env,
      input: "",
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  async function readOrders(dataDir: string): Promise<string> {
    return readFile(ordersPath(dataDir), "utf8");
  }

  /** The appended line's parsed record — the LAST non-blank line of the sidecar. */
  function lastRecord(raw: string): Record<string, unknown> {
    const lines = raw.split("\n").filter((line) => line.trim() !== "");
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
  }

  // ── The control: the refusals below are the SHELL talking, not a shell that cannot
  // start at all. ───────────────────────────────────────────────────────────────────
  it("cancels a resting rung: exit 0, one appended line, and NO TTY anywhere", async () => {
    const dir = await syntheticDataDir();
    const before = await readOrders(dir);

    const result = runCancel(["rung-300", "2026-01-03T10:00:00"], { dataDir: dir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cancelled rung-300");
    expect(result.stderr).toBe("");

    // The header's claim (`:11-13`) made mechanical: stdin was CLOSED and stdout/stderr
    // were pipes, not a terminal, and the act still completed. Nothing waits on a prompt.
    const after = await readOrders(dir);
    expect(after.startsWith(before)).toBe(true);
    const appended = lastRecord(after);
    expect(appended).toMatchObject({ id: "rung-300", kind: "orderCancelled", currency: "USD" });
  });

  // ── The usage branch: it returns before the domain and before path resolution. ─────
  it("prints the usage sentence to STDERR and exits 1 when orderId is absent", async () => {
    const dir = await syntheticDataDir();
    const before = await readOrders(dir);

    const result = runCancel([], { dataDir: dir });

    expect(result.status).toBe(1);
    // Exact, and on the ERROR channel — a usage line on stdout would pollute a pipeline.
    expect(result.stderr).toBe(USAGE);
    expect(result.stdout).toBe("");
    // `resolveOrdersPath()` is INSIDE the else-branch, so a usage refusal never names a
    // path — the absence of the temp dir in stderr is what proves the early return.
    expect(result.stderr).not.toContain(dir);
    expect(await readOrders(dir)).toBe(before);
  });

  it("treats an EMPTY-STRING orderId as absent — same usage sentence, same exit 1", async () => {
    const dir = await syntheticDataDir();
    const before = await readOrders(dir);

    // `!orderId` is one falsiness check covering both `undefined` and `""`.
    const result = runCancel([""], { dataDir: dir });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(USAGE);
    expect(result.stdout).toBe("");
    expect(await readOrders(dir)).toBe(before);
  });

  // ── THE DIVERGENCE. ───────────────────────────────────────────────────────────────
  it(
    "DIVERGES on a whitespace-only orderId: it clears the shell's truthiness check and is " +
      "refused by the DOMAIN instead — a different sentence for the same operator mistake",
    async () => {
      const dir = await syntheticDataDir();
      const before = await readOrders(dir);

      // `" "` is truthy, so the shell's `!orderId` guard passes it through; `cancelOrder`
      // TRIMS (`cancel-order.ts:103-105`) and rejects with `no-order-id`. An operator
      // whose shell expanded an unset variable to a space sees a REFUSED banner naming a
      // path, while an operator who passed nothing at all sees a usage line. Same
      // mistake, two code paths, two messages — pinned here so neither drifts silently.
      const result = runCancel([" "], { dataDir: dir });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("REFUSED — no order id was given");
      // NOT the usage sentence — that is the whole point of this case.
      expect(result.stderr).not.toContain(USAGE.trim());
      expect(result.stdout).toBe("");
      expect(await readOrders(dir)).toBe(before);
    },
  );

  it("the two 'no id' messages are genuinely different text", async () => {
    const dir = await syntheticDataDir();

    const absent = runCancel([], { dataDir: dir });
    const blank = runCancel([" "], { dataDir: dir });

    // Same exit code, same operator intent, different sentences. Both exit 1, so a
    // script cannot tell them apart; only the text can.
    expect(absent.status).toBe(blank.status);
    expect(absent.stderr).not.toBe(blank.stderr);
  });

  // ── The positional mapping. ───────────────────────────────────────────────────────
  it("maps argv[3] to observedAt: the supplied stamp lands VERBATIM in the appended line", async () => {
    const dir = await syntheticDataDir();

    const result = runCancel(["rung-200", "2026-03-04T05:06:07"], { dataDir: dir });

    expect(result.status).toBe(0);
    // Verbatim, not re-formatted, not re-stamped — this is what proves argv[3] is the
    // stamp positional rather than something the shell reorders or ignores.
    expect(lastRecord(await readOrders(dir)).observedAt).toBe("2026-03-04T05:06:07");
    expect(result.stdout).toContain("retired 2026-03-04T05:06:07");
  });

  it("omitting argv[3] stamps NOW, inside the window the test itself brackets", async () => {
    const dir = await syntheticDataDir();

    const before = formatObservedAt(new Date());
    const result = runCancel(["rung-200"], { dataDir: dir });
    const after = formatObservedAt(new Date());

    expect(result.status).toBe(0);
    // `YYYY-MM-DDTHH:MM:SS` sorts lexicographically, so bracketing the spawn is a real
    // bound on `io.now()` (`cancel-order.ts:122`) without freezing global time.
    const stamped = lastRecord(await readOrders(dir)).observedAt as string;
    expect(stamped >= before).toBe(true);
    expect(stamped <= after).toBe(true);
  });

  it("ignores argv[4] and beyond — there is no flag parsing in this shell", async () => {
    const dir = await syntheticDataDir();

    const result = runCancel(["rung-300", "2026-03-04T05:06:07", "--force", "extra"], {
      dataDir: dir,
    });

    // A shell that grew flags would either consume or reject these; this one reads two
    // positionals and stops.
    expect(result.status).toBe(0);
    expect(lastRecord(await readOrders(dir)).observedAt).toBe("2026-03-04T05:06:07");
  });

  // ── The env plumbing. ─────────────────────────────────────────────────────────────
  it("routes NUMISMA_DATA_DIR through resolveOrdersPath — stderr names the resolved path", async () => {
    const dir = await syntheticDataDir();
    const before = await readOrders(dir);

    // Every domain refusal goes through one `reject()` helper that prints "Nothing was
    // written to <ordersPath>" (`cancel-order.ts:84-91`), so ANY refusal is a probe of
    // the path the parent's env produced in the CHILD process.
    const result = runCancel(["rung-does-not-exist"], { dataDir: dir });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(ordersPath(dir));
    expect(result.stderr).toContain(`Nothing was written to ${ordersPath(dir)}.`);
    expect(await readOrders(dir)).toBe(before);
  });

  it("refuses a RELATIVE NUMISMA_DATA_DIR (exit 1) rather than splitting the ledger", async () => {
    const dir = await syntheticDataDir();
    const before = await readOrders(dir);

    for (const relative of ["data", "."]) {
      // `.` is the sharp one: with cwd = the fixture dir, ACCEPTING it would resolve to
      // this very `orders.jsonl` and the cancellation would SUCCEED. The byte-identical
      // assertion below is therefore load-bearing, not vacuous.
      const result = runCancel(["rung-300", "2026-01-03T10:00:00"], {
        dataDirEnv: relative,
        cwd: dir,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("split-brain ledger");
      expect(result.stderr).toContain("NUMISMA_DATA_DIR must be an absolute path");
      expect(result.stdout).toBe("");
      expect(await readOrders(dir)).toBe(before);
    }
  });

  // ── The exit-code mapping, and the write-nothing posture. ─────────────────────────
  it("maps all three outcomes: usage → 1, rejected → 1, cancelled → 0", async () => {
    const dir = await syntheticDataDir();

    expect(runCancel([], { dataDir: dir }).status).toBe(1);
    // `not-resting`: the rung is retired by the first call, so the second is refused.
    expect(runCancel(["rung-300", "2026-01-03T10:00:00"], { dataDir: dir }).status).toBe(0);
    const again = runCancel(["rung-300", "2026-01-04T10:00:00"], { dataDir: dir });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("REFUSED —");
  });

  it("leaves no temp or lock litter beside the sidecar after a successful append", async () => {
    const dir = await syntheticDataDir();

    expect(runCancel(["rung-200", "2026-01-03T10:00:00"], { dataDir: dir }).status).toBe(0);

    // Over the DIRECTORY, not a guessed `${path}.tmp`: the staging name is unique per
    // write, so probing one literal name would pass vacuously.
    const leftovers = (await readdir(dir)).filter(
      (entry) => entry.endsWith(".tmp") || entry.endsWith(".lock"),
    );
    expect(leftovers).toEqual([]);
  });
});
