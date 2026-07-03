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
import { runPriceFetch } from "./fetch-prices.js";
import { resolvePriceFeedPaths } from "./paths.js";

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

function klineResponse(close: number): Response {
  const openTime = Date.UTC(2026, 6, 3);
  const closeTime = openTime + 86_399_999;
  const row = [openTime, "0", "0", "0", String(close), "10", closeTime, "0", 0, "0", "0", "0"];
  return new Response(JSON.stringify([row]), { status: 200 });
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
   * `Response` body is parsed and placed under the symbol key (Twelve Data now
   * fetches every equity in ONE comma-separated request, so a per-symbol failure
   * is a `status:"error"` slice, not a per-request HTTP status).
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
        // The equities now ride ONE batched Twelve Data request; a stall aborts the
        // whole batch, so every equity symbol times out attributably (R4) while crypto
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
