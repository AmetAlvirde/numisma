// Shell reliability suite for the crypto price pipe. No live network (every fetch
// is mocked) and never the live data files (each run uses a fresh temp data dir):
// the happy-path store+emit, the pre-mark-time no-mark case, idempotent re-runs,
// per-symbol failure isolation on malformed payloads, and the request timeout.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPriceFetch } from "./fetch-prices.js";
import { resolvePriceFeedPaths } from "./paths.js";

// 2026-07-03T12:00Z = 06:00 in CDMX on the 3rd → asOf "2026-07-03".
const RUN_INSTANT = new Date("2026-07-03T12:00:00.000Z");
const AS_OF = "2026-07-03";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "price-feed-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** A well-formed Binance 1d kline payload with `close`. */
function klineResponse(close: number): Response {
  const openTime = Date.UTC(2026, 6, 3);
  const closeTime = openTime + 86_399_999;
  const row = [openTime, "0", "0", "0", String(close), "10", closeTime, "0", 0, "0", "0", "0"];
  return new Response(JSON.stringify([row]), { status: 200 });
}

const CLOSES: Record<string, number> = {
  BTCUSDT: 65000,
  ETHUSDT: 3400,
  RENDERUSDT: 8.2,
  GRAMUSDT: 5.5,
};

/** A mock fetch keyed off the symbol in the request URL. */
function mockFetch(overrides: Record<string, () => Response | Promise<Response>> = {}): typeof fetch {
  return ((url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url.toString();
    const symbol = Object.keys(CLOSES).find((s) => href.includes(`symbol=${s}`));
    if (symbol && overrides[symbol]) {
      return Promise.resolve(overrides[symbol]!());
    }
    if (symbol) {
      return Promise.resolve(klineResponse(CLOSES[symbol]!));
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  }) as typeof fetch;
}

async function readInbox(): Promise<{ id: string }[]> {
  const { inbox } = resolvePriceFeedPaths(dataDir);
  return JSON.parse(await readFile(inbox, "utf8"));
}

async function readStore(instrumentId: string): Promise<string> {
  const { pricesDir } = resolvePriceFeedPaths(dataDir);
  return readFile(join(pricesDir, `${instrumentId}.jsonl`), "utf8");
}

describe("runPriceFetch — happy path at/after the mark time", () => {
  it("stores every quote and queues one deterministic-id mark per instrument", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
    });

    expect(result.storedCount).toBe(4);
    expect(result.totalCount).toBe(4);
    expect(result.markEmitted).toBe(true);
    expect(result.emittedCount).toBe(4);
    expect(result.failures).toEqual([]);

    const inbox = await readInbox();
    expect(inbox.map((event) => event.id)).toEqual([
      `pm-btc-${AS_OF}`,
      `pm-eth-${AS_OF}`,
      `pm-render-${AS_OF}`,
      `pm-gram-${AS_OF}`,
    ]);

    const btc = JSON.parse((await readStore("btc")).trim());
    expect(btc).toMatchObject({
      instrumentId: "btc",
      symbol: "BTCUSDT",
      asOf: AS_OF,
      price: 65000,
      source: "binance",
    });
    expect(btc.fetchedAt).toBe(RUN_INSTANT.toISOString());
  });
});

describe("runPriceFetch — before the mark time", () => {
  it("upserts the store but emits no mark", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "23:59" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
    });

    expect(result.storedCount).toBe(4);
    expect(result.markEmitted).toBe(false);
    expect(result.emittedCount).toBe(0);
    // The store is written even though no mark is emitted.
    expect((await readStore("btc")).trim().length).toBeGreaterThan(0);
    // No inbox is created when there is nothing to emit.
    await expect(readInbox()).rejects.toThrow();
  });
});

describe("runPriceFetch — idempotent re-run (spine claim)", () => {
  it("adds 0 new candidates when run twice the same day", async () => {
    const options = {
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch(),
      now: () => RUN_INSTANT,
    };
    const first = await runPriceFetch(options);
    expect(first.emittedCount).toBe(4);

    const second = await runPriceFetch(options);
    expect(second.emittedCount).toBe(0);
    expect(second.skippedCount).toBe(4);

    const inbox = await readInbox();
    expect(inbox).toHaveLength(4);
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
    });

    const merged = await readInbox();
    expect(merged.map((event) => event.id)).toEqual([
      "hand-authored",
      `pm-btc-${AS_OF}`,
      `pm-eth-${AS_OF}`,
      `pm-render-${AS_OF}`,
      `pm-gram-${AS_OF}`,
    ]);
  });
});

describe("runPriceFetch — per-symbol failure isolation (R4)", () => {
  it("keeps partial progress and attributes each malformed-payload failure", async () => {
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00" },
      fetchImpl: mockFetch({
        ETHUSDT: () => new Response("{}", { status: 200 }), // non-array response
        RENDERUSDT: () => new Response("[[]]", { status: 200 }), // missing row fields → NaN close
        GRAMUSDT: () => new Response("nope", { status: 500, statusText: "Server Error" }),
      }),
      now: () => RUN_INSTANT,
    });

    // Only BTC succeeded; the other three each failed attributably.
    expect(result.storedCount).toBe(1);
    expect(result.failures.map((f) => f.instrumentId).sort()).toEqual(["eth", "gram", "render"]);
    expect(result.failures.find((f) => f.instrumentId === "gram")?.message).toMatch(/HTTP 500/);
    expect(result.failures.find((f) => f.instrumentId === "eth")?.message).toMatch(
      /unexpected payload shape/,
    );
    expect(result.failures.find((f) => f.instrumentId === "render")?.message).toMatch(
      /non-positive close/,
    );

    // Partial progress kept: BTC stored and its mark emitted.
    const inbox = await readInbox();
    expect(inbox.map((event) => event.id)).toEqual([`pm-btc-${AS_OF}`]);
  });

  it("attributes a request timeout to the stalled symbol", async () => {
    const stall: () => Promise<Response> = () =>
      new Promise(() => {
        /* never resolves; the AbortController fires the timeout */
      });
    const result = await runPriceFetch({
      config: { dataDir, markTime: "00:00", requestTimeoutMs: 20 },
      fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
        const href = typeof url === "string" ? url : url.toString();
        if (href.includes("symbol=ETHUSDT")) {
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
    });

    void stall;
    const eth = result.failures.find((f) => f.instrumentId === "eth");
    expect(eth?.message).toMatch(/timed out after 20ms/);
    // The other three still succeeded.
    expect(result.storedCount).toBe(3);
  });
});
