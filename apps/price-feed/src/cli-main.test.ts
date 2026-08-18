// The `prices:fetch` command body (R3.2–R3.4): the owed / marked / absent report
// and the exit code it produces. Every fixture below is HAND-AUTHORED — no captured
// provider response and no row from the real ledger — and every run is driven
// through `runPriceFetchCli`, which is the ONLY path `cli.ts` takes.
//
// The pin that matters most is the pair: the same stale-bar skip is INFO + exit 0 on
// the live daily path and a FAILURE + exit 1 under an explicit `--as-of`. Both
// halves are asserted, because either one alone would let the other regress.
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { PriceMarkedEvent, PriceSource, Quote } from "@numisma/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPriceFetchCli, type PriceFetchCliDeps } from "./cli-main.js";
import { runPriceFetch, type FetchRunResult, type RunOptions } from "./fetch-prices.js";
import { resolvePriceFeedPaths } from "./paths.js";
import type { RejectionScan } from "./rejection-check.js";

const RECOVERY_AS_OF = "2026-08-14";
const LIVE_AS_OF = "2026-08-17";

/** The 4 crypto rows, authored to match the registry's ids and provider symbols. */
const CRYPTO: ReadonlyArray<readonly [string, string]> = [
  ["btc", "BTCUSDT"],
  ["eth", "ETHUSDT"],
  ["render", "RENDERUSDT"],
  ["gram", "GRAMUSDT"],
];
/** The 9 Twelve Data rows (3 US equities + the 6 MXN-derived USD legs). */
const EQUITIES: ReadonlyArray<readonly [string, string]> = [
  ["aapl", "AAPL"],
  ["googl", "GOOGL"],
  ["tsla", "TSLA"],
  ["eww-mxn", "EWW"],
  ["intc-mxn", "INTC"],
  ["nke-mxn", "NKE"],
  ["nu-mxn", "NU"],
  ["rivn-mxn", "RIVN"],
  ["sbux-mxn", "SBUX"],
];

function quote(instrumentId: string, symbol: string, asOf: string, source: PriceSource): Quote {
  return { instrumentId, symbol, asOf, price: 100, source, fetchedAt: "2026-08-17T15:00:00.000Z" };
}

function mark(instrumentId: string, asOf: string): PriceMarkedEvent {
  return { id: `pm-${instrumentId}-${asOf}`, asOf, type: "PriceMarked", instrumentId, price: 100 };
}

/**
 * An authored `FetchRunResult`. The defaults describe a clean 13-instrument run;
 * each test overrides only the field whose consequence it is asserting, so a report
 * change shows up as one diff rather than a rewritten fixture.
 */
function runResult(overrides: Partial<FetchRunResult> = {}): FetchRunResult {
  const all = [
    ...CRYPTO.map(([id, symbol]) => quote(id, symbol, RECOVERY_AS_OF, "binance")),
    ...EQUITIES.map(([id, symbol]) => quote(id, symbol, RECOVERY_AS_OF, "twelvedata")),
  ];
  return {
    quotes: all,
    asOf: RECOVERY_AS_OF,
    notOwed: [],
    totalCount: all.length,
    storedCount: all.length,
    emittedCount: all.length,
    skippedCount: 0,
    markEmitted: true,
    marks: all.map((q) => mark(q.instrumentId, RECOVERY_AS_OF)),
    failures: [],
    staleMarkSkips: [],
    ...overrides,
  };
}

const CLEAN_SCAN: RejectionScan = { rejections: [], skipped: false };

interface Captured {
  exitCode: number;
  out: string;
  err: string;
  /** The options `runPriceFetch` was actually called with — `undefined` if never called. */
  options: RunOptions | undefined;
}

/** Drive the command with an injected run + scan and capture everything it printed. */
async function invoke(
  argv: readonly string[],
  run: (options: RunOptions) => Promise<FetchRunResult>,
  scan: RejectionScan | Error = CLEAN_SCAN,
): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  let options: RunOptions | undefined;
  const deps: PriceFetchCliDeps = {
    argv,
    run: (received) => {
      options = received;
      return run(received);
    },
    scan: () => (scan instanceof Error ? Promise.reject(scan) : Promise.resolve(scan)),
    log: (line) => out.push(line),
    logError: (line) => err.push(line),
  };
  const exitCode = await runPriceFetchCli(deps);
  return { exitCode, out: out.join("\n"), err: err.join("\n"), options };
}

describe("prices:fetch — with no arguments the live daily path is unchanged", () => {
  it("passes NO asOf to the run and exits 0 on a clean run", async () => {
    const captured = await invoke([], () =>
      Promise.resolve(runResult({ asOf: LIVE_AS_OF, quotes: [], marks: [], totalCount: 13 })),
    );

    // `toStrictEqual`, not `toEqual`: `toEqual` ignores undefined-valued keys, so it
    // would also pass if the CLI started sending `{ asOf: undefined }` — which is a
    // different call than "no asOf at all", and this test's whole claim is the latter.
    expect(captured.options).toStrictEqual({});
    expect(captured.exitCode).toBe(0);
    // No recovery vocabulary leaks onto the daily path.
    expect(captured.out).not.toMatch(/recover/i);
    expect(captured.err).not.toMatch(/ABSENT/);
  });

  it("exits 0 on a SATURDAY whose 9 equities all skipped as stale — INFO, not failure", async () => {
    // The live-path half of the boundary. An equity's newest bar on a Saturday is
    // Friday's; failing the nightly automation on that would be the regression.
    const captured = await invoke([], () =>
      Promise.resolve(
        runResult({
          asOf: "2026-08-15",
          marks: CRYPTO.map(([id]) => mark(id, "2026-08-15")),
          emittedCount: 4,
          staleMarkSkips: EQUITIES.map(([instrumentId, symbol]) => ({
            instrumentId,
            symbol,
            observationDate: RECOVERY_AS_OF,
            asOf: "2026-08-15",
          })),
        }),
      ),
    );

    expect(captured.exitCode).toBe(0);
    expect(captured.err).not.toMatch(/ABSENT/);
  });

  it("exits 0 before the mark time, when a live run legitimately has zero marks", async () => {
    const captured = await invoke([], () =>
      Promise.resolve(
        runResult({ asOf: LIVE_AS_OF, markEmitted: false, marks: [], emittedCount: 0 }),
      ),
    );

    expect(captured.exitCode).toBe(0);
    expect(captured.out).toMatch(/no mark emitted/);
  });

  it("still exits 1 on a live provider failure, as it always did", async () => {
    const captured = await invoke([], () =>
      Promise.resolve(
        runResult({
          asOf: LIVE_AS_OF,
          failures: [{ instrumentId: "tsla", symbol: "TSLA", message: "HTTP 429 Too Many Requests" }],
        }),
      ),
    );

    expect(captured.exitCode).toBe(1);
  });

  it("still exits 1 on a spine pre-check rejection, as it always did", async () => {
    const captured = await invoke(
      [],
      () => Promise.resolve(runResult({ asOf: LIVE_AS_OF })),
      {
        rejections: [
          {
            id: "pm-btc-2026-08-17",
            instrumentId: "btc",
            asOf: LIVE_AS_OF,
            price: 100,
            path: "price",
            reason: "moves more than ±50% from the last close",
          },
        ],
        skipped: false,
      },
    );

    expect(captured.exitCode).toBe(1);
    expect(captured.err).toMatch(/SPINE WOULD REJECT/);
  });
});

describe("prices:fetch --as-of — the three-state report (R3.2)", () => {
  it("exits 0 and names the date, the owed count and the marked count", async () => {
    const captured = await invoke(["--as-of=2026-08-14"], () => Promise.resolve(runResult()));

    expect(captured.options).toEqual({ asOf: RECOVERY_AS_OF });
    expect(captured.exitCode).toBe(0);
    expect(captured.out).toMatch(
      /recovery of 2026-08-14 — 13 owed, 13 marked, 0 absent; 0 not owed/,
    );
    expect(captured.err).not.toMatch(/ABSENT/);
  });

  it("reports a Saturday's 4-of-4 as complete, naming the 9 not owed by their venue", async () => {
    const saturday = "2026-08-15";
    const captured = await invoke(["--as-of", saturday], () =>
      Promise.resolve(
        runResult({
          asOf: saturday,
          quotes: CRYPTO.map(([id, symbol]) => quote(id, symbol, saturday, "binance")),
          totalCount: 4,
          storedCount: 4,
          emittedCount: 4,
          marks: CRYPTO.map(([id]) => mark(id, saturday)),
          notOwed: EQUITIES.map(([instrumentId, symbol]) => ({
            instrumentId,
            symbol,
            source: "twelvedata" as const,
          })),
        }),
      ),
    );

    expect(captured.exitCode).toBe(0);
    expect(captured.out).toMatch(/recovery of 2026-08-15 — 4 owed, 4 marked, 0 absent; 9 not owed/);
    expect(captured.out).toMatch(/not owed \(never attempted\).*aapl/);
  });

  it("exits 1 on an absent instrument, carrying the PROVIDER's own words", async () => {
    const captured = await invoke(["--as-of=2026-08-14"], () =>
      Promise.resolve(
        runResult({
          totalCount: 13,
          storedCount: 12,
          emittedCount: 12,
          marks: runResult().marks.filter((m) => m.instrumentId !== "tsla"),
          failures: [
            {
              instrumentId: "tsla",
              symbol: "TSLA",
              message:
                "HTTP 400 Bad Request — No data is available on the specified dates. Try adjusting the dates.",
            },
          ],
        }),
      ),
    );

    expect(captured.exitCode).toBe(1);
    expect(captured.err).toMatch(/RECOVERY INCOMPLETE — 1 owed instrument\(s\) produced no mark/);
    expect(captured.err).toMatch(/ABSENT {2}tsla/);
    // R1.4's whole point: the provider's sentence, not a bare "HTTP 400".
    expect(captured.err).toMatch(/No data is available on the specified dates/);
    expect(captured.out).toMatch(/recovery of 2026-08-14 — 13 owed, 12 marked, 1 absent/);
  });

  it("says in as many words that the exit code cannot tell a holiday from a fault", async () => {
    const captured = await invoke(["--as-of=2026-08-14"], () =>
      Promise.resolve(
        runResult({
          marks: runResult().marks.filter((m) => m.instrumentId !== "tsla"),
          failures: [{ instrumentId: "tsla", symbol: "TSLA", message: "HTTP 400 Bad Request" }],
        }),
      ),
    );

    expect(captured.out).toMatch(/CANNOT distinguish a market holiday from a provider failure/);
    // …and each absent row still names what it is SUSPECTED to be.
    expect(captured.err).toMatch(/suspected: /);
  });

  it("exits 1 when an owed instrument came back with the WRONG date's bar", async () => {
    // The recovery half of the boundary: the request was pinned to 2026-08-14, so a
    // 2026-08-13 bar means the day did not come back — not an expected weekend skip.
    const captured = await invoke(["--as-of=2026-08-14"], () =>
      Promise.resolve(
        runResult({
          storedCount: 13,
          emittedCount: 12,
          marks: runResult().marks.filter((m) => m.instrumentId !== "aapl"),
          staleMarkSkips: [
            {
              instrumentId: "aapl",
              symbol: "AAPL",
              observationDate: "2026-08-13",
              asOf: RECOVERY_AS_OF,
            },
          ],
        }),
      ),
    );

    expect(captured.exitCode).toBe(1);
    expect(captured.err).toMatch(/ABSENT {2}aapl/);
    expect(captured.err).toMatch(/served a bar dated 2026-08-13, not 2026-08-14/);
  });

  it("exits 1 on an owed instrument that vanished with no reason recorded at all", async () => {
    // Derived from the registry rather than from the failure list, so a bookkeeping
    // gap cannot be reported as a clean recovery of a day that did not come back.
    const captured = await invoke(["--as-of=2026-08-14"], () =>
      Promise.resolve(
        runResult({ marks: runResult().marks.filter((m) => m.instrumentId !== "gram") }),
      ),
    );

    expect(captured.exitCode).toBe(1);
    expect(captured.err).toMatch(/ABSENT {2}gram/);
    expect(captured.err).toMatch(/no reason was recorded/);
  });
});

describe("prices:fetch — refusals render as one sentence, never a stack trace", () => {
  const neverRuns = () => Promise.reject(new Error("runPriceFetch must not be reached"));

  it("refuses an unknown argument before any run happens", async () => {
    const captured = await invoke(["--asof=2026-08-14"], neverRuns);

    expect(captured.exitCode).toBe(1);
    expect(captured.options).toBeUndefined();
    expect(captured.err).toMatch(/--asof=2026-08-14/);
    expect(captured.err).not.toMatch(/\n\s+at /);
  });

  it("refuses --as-of with no value before any run happens", async () => {
    const captured = await invoke(["--as-of"], neverRuns);

    expect(captured.exitCode).toBe(1);
    expect(captured.options).toBeUndefined();
    expect(captured.err).toMatch(/needs a date/i);
  });

  /**
   * Both `runPriceFetch` refusals are driven through the REAL `runPriceFetch`, not a
   * hand-thrown stand-in: what earns the bare rendering is now the error's TYPE, so a
   * fixture `new Error(...)` would assert the fixture rather than the contract. The
   * refusal fires before any IO, so no `dataDir` is touched.
   */
  const realRun = (options: RunOptions) =>
    runPriceFetch({ ...options, now: () => new Date("2026-08-17T15:00:00.000Z") });

  it("renders runPriceFetch's TODAY refusal as one readable message", async () => {
    const captured = await invoke(["--as-of=2026-08-17"], realRun);

    expect(captured.exitCode).toBe(1);
    expect(captured.err).toMatch(/is not in the past/);
    expect(captured.err).toMatch(/daily job/);
    // A stack trace would show as an indented `at …` frame. There must be none.
    expect(captured.err).not.toMatch(/\n\s+at /);
  });

  it("renders runPriceFetch's impossible-date refusal as one readable message", async () => {
    const captured = await invoke(["--as-of=2026-02-30"], realRun);

    expect(captured.exitCode).toBe(1);
    expect(captured.err).toMatch(/2026-02-30/);
    expect(captured.err).toMatch(/not a real calendar date/);
    expect(captured.err).not.toMatch(/\n\s+at /);
  });

  /**
   * The other half of the pair, and the one the type gate exists for: a fault that is
   * NOT an operator refusal keeps its stack, on the recovery path exactly as on the
   * live path. Gating the bare rendering on "an --as-of was given" instead would
   * swallow the stack of a failed `mkdir`, an atomic-write error or a defect in
   * `buildMarks` — on the newer, less-exercised half of the command.
   */
  const bug = () => Promise.reject(new Error("EACCES: permission denied, mkdir '/prices'"));

  it("rethrows an UNEXPECTED fault on the recovery path, stack intact", async () => {
    await expect(invoke(["--as-of=2026-08-14"], bug)).rejects.toThrow(/EACCES/);
  });

  it("rethrows an UNEXPECTED fault on the live path too — unchanged", async () => {
    await expect(invoke([], bug)).rejects.toThrow(/EACCES/);
  });

  it("accepts the pnpm `--` forwarding form and still reaches the run", async () => {
    // pnpm 11 puts the literal separator in argv[0]; `pnpm gap-report -- --write` is
    // this repo's own documented idiom, so an operator will type it here too.
    const captured = await invoke(["--", "--as-of=2026-08-14"], () =>
      Promise.resolve(runResult()),
    );

    expect(captured.options).toStrictEqual({ asOf: RECOVERY_AS_OF });
    expect(captured.exitCode).toBe(0);
  });
});

describe("prices:fetch --as-of — the run writes stored quotes and inbox marks ONLY (R3.4)", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "price-feed-cli-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function walk(dir: string): Promise<string[]> {
    const found: string[] = [];
    for (const name of await readdir(dir)) {
      const full = join(dir, name);
      if ((await stat(full)).isDirectory()) found.push(...(await walk(full)));
      else found.push(relative(dataDir, full));
    }
    return found.sort();
  }

  it("touches the price store and the inbox and nothing else — no heartbeat, no log", async () => {
    // Driven through the REAL `runPriceFetch` (wrapped by the injected `run`) with an authored
    // one-row Binance payload, so the assertion is over what the pipeline actually
    // wrote rather than over what a stub claimed.
    const out: string[] = [];
    const exitCode = await runPriceFetchCli({
      argv: ["--as-of=2026-08-14"],
      config: { dataDir, twelveDataMaxSymbolsPerMinute: 9, twelveDataPauseMs: 0 },
      // The REAL run, with only its network and clock edges stubbed — so the CLI's
      // own option plumbing (`asOf` reaching `runPriceFetch`) is exercised too.
      // (`run` IS injected here; what it wraps is the real `runPriceFetch`.)
      run: (options) =>
        runPriceFetch({
          ...options,
          fetchImpl: authoredRecoveryFetch(),
          now: () => new Date("2026-08-17T15:00:00.000Z"),
          credentials: { twelveDataApiKey: "test-key", banxicoToken: "test-token" },
          sleepImpl: async () => {},
        }),
      log: (line) => out.push(line),
      logError: () => {},
    });

    expect(exitCode).toBe(0);
    const { inbox } = resolvePriceFeedPaths(dataDir);
    const written = await walk(dataDir);
    expect(written).toContain(relative(dataDir, inbox));
    // Exactly the 13 store files plus the inbox — no `job-heartbeat.json`, no
    // `events.jsonl`, no `gap-report.json`, nothing the spine or the wrapper owns.
    expect(written.filter((f) => f.endsWith(".jsonl"))).toHaveLength(13);
    expect(written).toHaveLength(14);
    expect(written.some((f) => f.includes("heartbeat"))).toBe(false);
  });
});

/**
 * An authored date-pinned mock: every bar's date is derived from the REQUEST, so if
 * the command ever stopped passing `asOf` through, the bars would come back misdated
 * and the run would report absences instead of quietly passing.
 */
function authoredRecoveryFetch(): typeof fetch {
  return ((url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("banxico.org.mx")) {
      const window = /\/datos\/(\d{4})-(\d{2})-(\d{2})\//.exec(href)!;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            bmx: {
              series: [
                {
                  idSerie: "SF43718",
                  datos: [{ fecha: `${window[3]}/${window[2]}/${window[1]}`, dato: "18.4407" }],
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );
    }
    if (href.includes("api.binance.com")) {
      const startTime = Number(/[?&]startTime=(\d+)/.exec(href)![1]);
      const row = [startTime, "0", "0", "0", "100", "10", startTime + 86_399_999, "0", 0, "0", "0", "0"];
      return Promise.resolve(new Response(JSON.stringify([row]), { status: 200 }));
    }
    if (href.includes("api.twelvedata.com")) {
      const datetime = decodeURIComponent(/[?&]start_date=([^&]+)/.exec(href)![1]!);
      const symbols = decodeURIComponent(/[?&]symbol=([^&]+)/.exec(href)![1]!).split(",");
      const keyed: Record<string, unknown> = {};
      for (const symbol of symbols) {
        keyed[symbol] = { status: "ok", values: [{ datetime, close: "100" }] };
      }
      const body = symbols.length === 1 ? keyed[symbols[0]!] : keyed;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  }) as typeof fetch;
}
