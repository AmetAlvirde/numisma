// Shell reliability suite for the full price pipe (crypto + US equities + derived
// MXN). No live network (every fetch is mocked) and never the live data files
// (each run uses a fresh temp data dir): the happy-path store+emit across all 13
// instruments plus the FIX, the derived `USD × FIX` MXN marks with the `usdMxn`
// snapshot, the pre-mark-time no-mark case, idempotent re-runs, per-symbol failure
// isolation, and the loud missing/stale-FIX behavior.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPriceFetch as runPriceFetchRaw, type RunOptions } from "./fetch-prices.js";
import { resolvePriceFeedPaths } from "./paths.js";

// Default a no-op sleep so Twelve Data pacing never waits a real minute in the
// suite (the default 8/min cap chunks the 9 equities into [8, 1] with a 60s pause).
// A test that asserts pacing passes its own sleepImpl — spread last, so it wins.
const runPriceFetch = (options: RunOptions = {}) =>
  runPriceFetchRaw({ sleepImpl: async () => {}, ...options });

// 2026-07-03T12:00Z = 06:00 in CDMX on the 3rd → asOf "2026-07-03".
const RUN_INSTANT = new Date("2026-07-03T12:00:00.000Z");
const AS_OF = "2026-07-03";
const CREDENTIALS = { twelveDataApiKey: "test-key", banxicoToken: "test-token" };

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "price-feed-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const CRYPTO_CLOSES: Record<string, number> = {
  BTCUSDT: 65000,
  ETHUSDT: 3400,
  RENDERUSDT: 8.2,
  GRAMUSDT: 5.5,
};

const EQUITY_CLOSES: Record<string, number> = {
  AAPL: 212.5,
  GOOGL: 178.25,
  TSLA: 240,
  EWW: 62.5,
  INTC: 34.2,
  NKE: 78.4,
  NU: 12.6,
  RIVN: 15.5,
  SBUX: 95.3,
};

const FIX_RATE = 18.5;

// Build one Binance 1d kline row for the UTC day `openTime` starts, with `close`.
function klineRow(openTime: number, close: number): unknown[] {
  const closeTime = openTime + 86_399_999;
  return [openTime, "0", "0", "0", String(close), "10", closeTime, "0", 0, "0", "0", "0"];
}

// The real Binance shape: the newest TWO 1d klines ascending as [completed D,
// running D+1]. The completed candle (day AS_OF) carries `close`; the running
// candle (D+1) carries a clearly different close so a test can prove the settled
// one is chosen, never the running spot reading. The provider takes rows[0].
function klineResponse(close: number): Response {
  const completed = klineRow(Date.UTC(2026, 6, 3), close);
  const running = klineRow(Date.UTC(2026, 6, 4), close + 1000);
  return new Response(JSON.stringify([completed, running]), { status: 200 });
}

function fixResponse(rate: string, fecha = "03/07/2026"): Response {
  return new Response(
    JSON.stringify({ bmx: { series: [{ idSerie: "SF43718", datos: [{ fecha, dato: rate }] }] } }),
    { status: 200 },
  );
}

interface Overrides {
  /**
   * Keyed by provider symbol (e.g. ETHUSDT, EWW) or "FIX". A crypto/FIX override
   * returns the whole `Response` for that (single) request. A Twelve Data equity
   * override injects that symbol's SLICE into the batched keyed response — its
   * `Response` body is parsed and placed under the symbol key (Twelve Data fetches
   * equities in PACED comma-separated batches, so a per-symbol failure is a
   * `status:"error"` slice, not a per-request HTTP status).
   */
  [key: string]: () => Response | Promise<Response>;
}

/**
 * Build the ONE batched Twelve Data response: parse the comma-separated `symbol=`
 * list and return the keyed `{ AAPL: {values…}, … }` map (the un-keyed shape for a
 * lone symbol, per the provider contract). An overridden symbol contributes its own
 * parsed slice so a single equity can fail (`status:"error"`) while the rest succeed.
 */
async function twelveDataBatchResponse(href: string, overrides: Overrides): Promise<Response> {
  const match = /[?&]symbol=([^&]+)/.exec(href);
  const symbols = match ? decodeURIComponent(match[1]!).split(",") : [];
  const keyed: Record<string, unknown> = {};
  for (const symbol of symbols) {
    if (overrides[symbol]) {
      keyed[symbol] = await (await overrides[symbol]!()).json();
    } else if (symbol in EQUITY_CLOSES) {
      keyed[symbol] = { status: "ok", values: [{ datetime: AS_OF, close: String(EQUITY_CLOSES[symbol]) }] };
    } else {
      keyed[symbol] = { status: "error", message: "not found" };
    }
  }
  const body = symbols.length === 1 ? keyed[symbols[0]!] : keyed;
  return new Response(JSON.stringify(body), { status: 200 });
}

/** A mock fetch that routes by host and the symbol(s) in the request URL. */
function mockFetch(overrides: Overrides = {}): typeof fetch {
  return ((url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("banxico.org.mx")) {
      return Promise.resolve(overrides.FIX ? overrides.FIX() : fixResponse(String(FIX_RATE)));
    }
    if (href.includes("api.binance.com")) {
      const symbol = Object.keys(CRYPTO_CLOSES).find((s) => href.includes(`symbol=${s}`));
      if (symbol && overrides[symbol]) return Promise.resolve(overrides[symbol]!());
      if (symbol) return Promise.resolve(klineResponse(CRYPTO_CLOSES[symbol]!));
      return Promise.resolve(new Response("[]", { status: 200 }));
    }
    if (href.includes("api.twelvedata.com")) {
      return twelveDataBatchResponse(href, overrides);
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  }) as typeof fetch;
}

interface InboxEvent {
  id: string;
  instrumentId?: string;
  price?: number;
  usdMxn?: number;
}

async function readInbox(): Promise<InboxEvent[]> {
  const { inbox } = resolvePriceFeedPaths(dataDir);
  return JSON.parse(await readFile(inbox, "utf8"));
}

async function readStore(instrumentId: string): Promise<string> {
  const { pricesDir } = resolvePriceFeedPaths(dataDir);
  return readFile(join(pricesDir, `${instrumentId}.jsonl`), "utf8");
}

describe("runPriceFetch — happy path across every provider (at/after mark time)", () => {
  it("stores all 13 quotes and queues one deterministic-id mark per instrument", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    expect(result.totalCount).toBe(13);
    expect(result.storedCount).toBe(13);
    expect(result.markEmitted).toBe(true);
    expect(result.emittedCount).toBe(13);
    expect(result.failures).toEqual([]);

    const inbox = await readInbox();
    expect(inbox.map((event) => event.id)).toEqual([
      `pm-btc-${AS_OF}`,
      `pm-eth-${AS_OF}`,
      `pm-render-${AS_OF}`,
      `pm-gram-${AS_OF}`,
      `pm-aapl-${AS_OF}`,
      `pm-googl-${AS_OF}`,
      `pm-tsla-${AS_OF}`,
      `pm-eww-mxn-${AS_OF}`,
      `pm-intc-mxn-${AS_OF}`,
      `pm-nke-mxn-${AS_OF}`,
      `pm-nu-mxn-${AS_OF}`,
      `pm-rivn-mxn-${AS_OF}`,
      `pm-sbux-mxn-${AS_OF}`,
    ]);
  });

  it("marks *-mxn at USD × FIX with the usdMxn snapshot; the store keeps the USD leg", async () => {
    await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    const inbox = await readInbox();
    const eww = inbox.find((event) => event.id === `pm-eww-mxn-${AS_OF}`);
    // 62.5 USD × 18.5 FIX = 1156.25 MXN, with the FIX carried as usdMxn.
    expect(eww).toMatchObject({ instrumentId: "eww-mxn", price: 1156.25, usdMxn: FIX_RATE });

    // A direct US equity mark carries no usdMxn.
    const aapl = inbox.find((event) => event.id === `pm-aapl-${AS_OF}`);
    expect(aapl).toMatchObject({ instrumentId: "aapl", price: 212.5 });
    expect(aapl?.usdMxn).toBeUndefined();

    // The disposable store holds the raw USD leg for eww-mxn, never the derived MXN.
    const stored = JSON.parse((await readStore("eww-mxn")).trim());
    expect(stored).toMatchObject({ instrumentId: "eww-mxn", symbol: "EWW", price: 62.5, source: "twelvedata" });
  });
});

describe("runPriceFetch — before the mark time", () => {
  it("upserts the store (all 13) but emits no mark and fetches no FIX", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "23:59" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    expect(result.storedCount).toBe(13);
    expect(result.markEmitted).toBe(false);
    expect(result.emittedCount).toBe(0);
    expect(result.failures).toEqual([]);
    expect((await readStore("aapl")).trim().length).toBeGreaterThan(0);
    await expect(readInbox()).rejects.toThrow();
  });
});

describe("runPriceFetch — idempotent re-run (spine claim)", () => {
  it("adds 0 new candidates when run twice the same day", async () => {
    const options = {
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    };
    const first = await runPriceFetch(options);
    expect(first.emittedCount).toBe(13);

    const second = await runPriceFetch(options);
    expect(second.emittedCount).toBe(0);
    expect(second.skippedCount).toBe(13);

    expect(await readInbox()).toHaveLength(13);
  });

  it("never clobbers a hand-authored pending inbox event", async () => {
    const { inbox } = resolvePriceFeedPaths(dataDir);
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(inbox), { recursive: true });
    await writeFile(inbox, JSON.stringify([{ id: "hand-authored", type: "Deposit" }], null, 2));

    await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    const merged = await readInbox();
    expect(merged).toHaveLength(14);
    expect(merged[0]!.id).toBe("hand-authored");
    expect(merged.some((event) => event.id === `pm-sbux-mxn-${AS_OF}`)).toBe(true);
  });
});

describe("runPriceFetch — per-symbol failure isolation (R4)", () => {
  it("keeps partial progress and attributes each malformed-payload failure", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch({
        ETHUSDT: () => new Response("{}", { status: 200 }), // non-array response
        // One equity's slice comes back as a Twelve Data `status:"error"` inside the
        // batched response — attributable to just that symbol, the rest of the batch ok.
        AAPL: () =>
          new Response(JSON.stringify({ status: "error", message: "symbol halted" }), { status: 200 }),
      }),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    // 11 of 13 succeeded; the two bad symbols each failed attributably.
    expect(result.storedCount).toBe(11);
    expect(result.failures.map((f) => f.instrumentId).sort()).toEqual(["aapl", "eth"]);
    expect(result.failures.find((f) => f.instrumentId === "aapl")?.message).toMatch(/symbol halted/);
    expect(result.failures.find((f) => f.instrumentId === "eth")?.message).toMatch(
      /unexpected payload shape/,
    );

    // Partial progress kept: the other marks still emitted (incl. derived MXN).
    const inbox = await readInbox();
    expect(inbox.map((e) => e.id)).not.toContain(`pm-eth-${AS_OF}`);
    expect(inbox.map((e) => e.id)).toContain(`pm-eww-mxn-${AS_OF}`);
    expect(inbox).toHaveLength(11);
  });
});

describe("runPriceFetch — missing/stale FIX fails *-mxn loudly (ADR-005)", () => {
  it("fails every *-mxn derivation when the FIX is unavailable, keeping USD marks", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch({
        FIX: () => new Response("down", { status: 503, statusText: "Service Unavailable" }),
      }),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    // All 13 USD legs still stored (the store never depends on the FIX).
    expect(result.storedCount).toBe(13);
    // The FIX outage + all six *-mxn derivations fail, attributably.
    const failedIds = result.failures.map((f) => f.instrumentId).sort();
    expect(failedIds).toEqual([
      "eww-mxn",
      "intc-mxn",
      "nke-mxn",
      "nu-mxn",
      "rivn-mxn",
      "sbux-mxn",
      "usd-mxn-fix",
    ]);
    expect(result.failures.find((f) => f.instrumentId === "usd-mxn-fix")?.message).toMatch(/HTTP 503/);
    expect(result.failures.find((f) => f.instrumentId === "eww-mxn")?.message).toMatch(/unavailable/);

    // Only the 7 direct USD marks emit; no underived MXN mark is written.
    expect(result.emittedCount).toBe(7);
    const inbox = await readInbox();
    expect(inbox.map((e) => e.id)).not.toContain(`pm-eww-mxn-${AS_OF}`);
    expect(inbox.map((e) => e.id)).toContain(`pm-btc-${AS_OF}`);
  });

  it("fails *-mxn derivations loudly when the FIX is stale, never reusing an old rate", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00", fixMaxStaleDays: 4 },
      fetchImpl: mockFetch({
        // A FIX dated well before the mark day, outside the freshness window.
        FIX: () => fixResponse("18.5", "25/06/2026"),
      }),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    expect(result.emittedCount).toBe(7);
    const mxnFailures = result.failures.filter((f) => f.instrumentId.endsWith("-mxn"));
    expect(mxnFailures).toHaveLength(6);
    expect(mxnFailures[0]?.message).toMatch(/stale/);
    const inbox = await readInbox();
    expect(inbox.map((e) => e.id)).not.toContain(`pm-nke-mxn-${AS_OF}`);
  });
});

describe("runPriceFetch — request timeout attribution (R4)", () => {
  it("attributes a stalled batched equities request to every equity symbol", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00", requestTimeoutMs: 20 },
      fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
        const href = typeof url === "string" ? url : url.toString();
        // The equities ride PACED batched Twelve Data requests; a stall aborts each
        // chunk, so every equity symbol times out attributably (R4) while crypto
        // still completes — a stalled provider can never hang or silently drop the run.
        if (href.includes("api.twelvedata.com")) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          });
        }
        return mockFetch()(url as string, init);
      }) as typeof fetch,
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    expect(result.failures.find((f) => f.instrumentId === "tsla")?.message).toMatch(
      /timed out after 20ms/,
    );
    // All 9 Twelve Data symbols timed out; the 4 crypto quotes still stored.
    expect(result.failures).toHaveLength(9);
    expect(result.storedCount).toBe(4);
  });
});

describe("runPriceFetch — Twelve Data pacing under the free-tier credit cap", () => {
  // Record the symbol list of every Twelve Data request so we can assert the batches.
  function recordingFetch(batches: string[][]): typeof fetch {
    return ((url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("api.twelvedata.com")) {
        const match = /[?&]symbol=([^&]+)/.exec(href);
        batches.push(decodeURIComponent(match![1]!).split(","));
        return twelveDataBatchResponse(href, {});
      }
      return mockFetch()(url as string);
    }) as typeof fetch;
  }

  it("chunks the 9 equity symbols into ≤8-credit windows with one 60s pause between", async () => {
    const batches: string[][] = [];
    const sleeps: number[] = [];

    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00", twelveDataMaxSymbolsPerMinute: 8, twelveDataPauseMs: 60_000 },
      fetchImpl: recordingFetch(batches),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    // 9 symbols, 8/min cap → two windows of 8 + 1; NEVER a single 9-credit request.
    expect(batches.map((b) => b.length)).toEqual([8, 1]);
    expect(batches.every((b) => b.length <= 8)).toBe(true);
    // Exactly one pause, BETWEEN the two chunks (never after the last).
    expect(sleeps).toEqual([60_000]);
    // Pacing changes timing, not coverage: all 13 still stored and marked.
    expect(result.storedCount).toBe(13);
    expect(result.emittedCount).toBe(13);
    expect(result.failures).toEqual([]);
  });

  it("makes one request and never pauses when the cap fits every symbol (paid tier)", async () => {
    const batches: string[][] = [];
    const sleeps: number[] = [];

    await runPriceFetch({
      config: { dataDir, markTime: "00:00", twelveDataMaxSymbolsPerMinute: 60 },
      fetchImpl: recordingFetch(batches),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    // A cap ≥ the equity count collapses to one batch and disables pacing entirely.
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(9);
    expect(sleeps).toEqual([]);
  });
});

describe("runPriceFetch — crypto marks the settled UTC candle, gated uniformly", () => {
  it("marks the completed candle's close, never the running D+1 candle", async () => {
    await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    const inbox = await readInbox();
    const btc = inbox.find((event) => event.id === `pm-btc-${AS_OF}`);
    // klineResponse pairs the completed close (65000) with a running D+1 close of
    // 66000. The mark must carry the settled candle, never the live running one.
    expect(btc?.id).toBe(`pm-btc-${AS_OF}`);
    expect(btc?.price).toBe(CRYPTO_CLOSES.BTCUSDT);
    expect(btc?.price).not.toBe(CRYPTO_CLOSES.BTCUSDT! + 1000);
  });

  it("cleanly skips a crypto bar whose completed candle predates asOf — INFO, no mark, no failure", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch({
        // RENDER's completed candle is a prior UTC day (a late/missed fire): its
        // observationDate ("2026-07-02") ≠ asOf, so the uniform gate skips it.
        RENDERUSDT: () =>
          new Response(
            JSON.stringify([klineRow(Date.UTC(2026, 6, 2), 8.2), klineRow(Date.UTC(2026, 6, 3), 8.3)]),
            { status: 200 },
          ),
      }),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    // RENDER is a clean INFO skip: recorded once in staleMarkSkips, never a failure.
    expect(result.failures.map((f) => f.instrumentId)).not.toContain("render");
    expect(result.staleMarkSkips.map((s) => s.instrumentId)).toEqual(["render"]);
    expect(result.staleMarkSkips[0]).toMatchObject({
      instrumentId: "render",
      symbol: "RENDERUSDT",
      observationDate: "2026-07-02",
      asOf: AS_OF,
    });
    // No render mark; the other 12 instruments still marked.
    const inbox = await readInbox();
    expect(inbox.map((e) => e.id)).not.toContain(`pm-render-${AS_OF}`);
    expect(inbox).toHaveLength(12);
  });

  it("treats a thin (<2-row) Binance payload as a per-symbol failure (R4), others unaffected", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch({
        // A single-row payload has no settled candle to mark — attributable failure.
        GRAMUSDT: () =>
          new Response(JSON.stringify([klineRow(Date.UTC(2026, 6, 3), 5.5)]), { status: 200 }),
      }),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    expect(result.failures.map((f) => f.instrumentId)).toContain("gram");
    expect(result.failures.find((f) => f.instrumentId === "gram")?.message).toMatch(
      /expected >=2 klines, got 1/,
    );
    // Isolation: the thin symbol fails alone; the other 12 store and mark.
    expect(result.storedCount).toBe(12);
    const inbox = await readInbox();
    expect(inbox.map((e) => e.id)).not.toContain(`pm-gram-${AS_OF}`);
    expect(inbox.map((e) => e.id)).toContain(`pm-btc-${AS_OF}`);
  });

  it("at the real 18:00-CDMX fire (00:00 UTC), the completed UTC candle aligns with asOf and crypto marks", async () => {
    // Pin the invariant the crypto gate rests on IN PRODUCTION: the real fire is
    // 18:00 CDMX = 00:00 UTC the next day. At that instant Binance's completed 1d
    // candle (the UTC day that just closed, Jul 22) lines up with the CDMX-anchored
    // asOf "by construction" — and the candle dates here are computed from the fire
    // instant, NOT pinned to asOf, so a broken offset (changed markTime, reinstated
    // DST, Binance row-order flip) would surface as a skip instead of staying green.
    const FIRE = new Date("2026-07-23T00:00:00.000Z"); // = 18:00 CDMX on 2026-07-22
    const result = await runPriceFetch({
      config: { dataDir, markTime: "18:00", timeZone: "America/Mexico_City" },
      now: () => FIRE,
      fetchImpl: mockFetch({
        // What Binance returns at 00:00 UTC: [completed Jul 22, running Jul 23].
        // The completed candle's UTC day (2026-07-22) must equal the CDMX-anchored asOf.
        BTCUSDT: () =>
          new Response(
            JSON.stringify([
              klineRow(Date.UTC(2026, 6, 22), 65000),
              klineRow(Date.UTC(2026, 6, 23), 66000),
            ]),
            { status: 200 },
          ),
      }),
      credentials: CREDENTIALS,
    });

    // asOf is the CDMX calendar day of the fire = 2026-07-22, and it equals the
    // completed candle's UTC day → BTC marks, never lands in staleMarkSkips. (The
    // other default mocks are pinned to Jul 3 and simply skip at this instant; the
    // assertions concern BTC's alignment at the real boundary alone.)
    const inbox = await readInbox();
    expect(inbox.map((e) => e.id)).toContain("pm-btc-2026-07-22");
    expect(result.staleMarkSkips.map((s) => s.instrumentId)).not.toContain("btc");
  });

  it("routes crypto and equity through ONE gate — a misaligned bar of each lands in staleMarkSkips", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch({
        // A misaligned crypto bar (completed candle on a prior UTC day)…
        ETHUSDT: () =>
          new Response(
            JSON.stringify([klineRow(Date.UTC(2026, 6, 2), 3400), klineRow(Date.UTC(2026, 6, 3), 3500)]),
            { status: 200 },
          ),
        // …and a misaligned equity bar (Twelve Data slice dated a prior trading day).
        AAPL: () =>
          new Response(
            JSON.stringify({ status: "ok", values: [{ datetime: "2026-07-02", close: "212.5" }] }),
            { status: 200 },
          ),
      }),
      now: () => RUN_INSTANT,
      credentials: CREDENTIALS,
    });

    // The twelvedata-only special case is gone: both flow through the same gate.
    expect(result.staleMarkSkips.map((s) => s.instrumentId).sort()).toEqual(["aapl", "eth"]);
    expect(result.failures).toEqual([]);
    const inbox = await readInbox();
    expect(inbox.map((e) => e.id)).not.toContain(`pm-eth-${AS_OF}`);
    expect(inbox.map((e) => e.id)).not.toContain(`pm-aapl-${AS_OF}`);
  });
});
