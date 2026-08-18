// Binance public-REST provider suite. No live network (every fetch is mocked) and
// every payload below is AUTHORED here — never a recorded real response.
import { describe, expect, it } from "vitest";
import type { InstrumentRegistryEntry } from "@numisma/engine";
import { fetchBinanceDailyClose } from "./binance-provider.js";

const BTC: InstrumentRegistryEntry = {
  instrumentId: "btc",
  symbol: "BTCUSDT",
  quoteCurrency: "USD",
  source: "binance",
};

function fetchWith(res: () => Response | Promise<Response>): typeof fetch {
  return (() => Promise.resolve(res())) as typeof fetch;
}

/** Records the URL the provider asked for and answers with an authored body. */
function recordingFetch(body: unknown): { calls: string[]; impl: typeof fetch } {
  const calls: string[] = [];
  const impl = ((url: string) => {
    calls.push(String(url));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return { calls, impl };
}

/**
 * An authored Binance 1d kline row:
 * `[openTime, open, high, low, close, volume, closeTime, …]`. Only the openTime and
 * the close are load-bearing here; the rest are plausible filler of the right arity.
 */
function kline(openTimeMs: number, close: string): unknown[] {
  return [
    openTimeMs,
    "60000.00",
    "61000.00",
    "59000.00",
    close,
    "1234.5",
    openTimeMs + 86_399_999,
    "75000000.0",
    987,
    "600.0",
    "36000000.0",
    "0",
  ];
}

const OPTS = { timeoutMs: 5_000 };
const NOW = () => new Date("2026-08-17T18:00:00.000Z");

// The UTC day under recovery, computed here independently of the provider's own
// date arithmetic so this suite cannot agree with a bug in it.
const TARGET = "2026-08-12";
const TARGET_START = Date.UTC(2026, 7, 12, 0, 0, 0, 0);
const TARGET_END = Date.UTC(2026, 7, 12, 23, 59, 59, 999);

describe("fetchBinanceDailyClose — live path (no targetDate)", () => {
  it("asks for the newest two klines and marks the settled one", async () => {
    // Pins the 18:00 production request. [completed D, running D+1] ascending: the
    // provider must take rows[0], never the running candle.
    const { calls, impl } = recordingFetch([
      kline(Date.UTC(2026, 7, 16), "63000.10"),
      kline(Date.UTC(2026, 7, 17), "99999.99"),
    ]);
    const obs = await fetchBinanceDailyClose(BTC, { ...OPTS, fetchImpl: impl, now: NOW });
    expect(calls).toEqual([
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=2",
    ]);
    expect(obs.close).toBe(63000.1);
    expect(obs.observationDate).toBe("2026-08-16");
    expect(obs.fetchedAt).toBe("2026-08-17T18:00:00.000Z");
  });

  it("still refuses a single-row payload on the live path — no settled candle", async () => {
    // The `>= 2` rule is a SETTLEMENT PROXY on this path: one row means the only
    // candle on offer may be the still-running one. It must survive R1.3 intact.
    const { impl } = recordingFetch([kline(Date.UTC(2026, 7, 17), "63000.10")]);
    await expect(
      fetchBinanceDailyClose(BTC, { ...OPTS, fetchImpl: impl, now: NOW }),
    ).rejects.toThrow(/^Binance BTCUSDT -> expected >=2 klines, got 1$/);
  });
});

describe("fetchBinanceDailyClose — date-pinned path", () => {
  it("windows the request to the target UTC day in epoch milliseconds", async () => {
    const { calls, impl } = recordingFetch([kline(TARGET_START, "58500.25")]);
    await fetchBinanceDailyClose(BTC, {
      ...OPTS,
      fetchImpl: impl,
      now: NOW,
      targetDate: TARGET,
    });
    const url = calls[0] ?? "";
    expect(url).toContain(`startTime=${TARGET_START}`);
    expect(url).toContain(`endTime=${TARGET_END}`);
    // The window replaces `limit=2`; asking for both would re-admit a running candle.
    expect(url).not.toContain("limit=");
  });

  it("marks a SINGLE-row windowed payload as the target date's observation", async () => {
    // Spec §8.2: a date-pinned window for one past UTC day returns exactly ONE row.
    // The `>= 2` settlement proxy must not fire here — R2.3's past-date guard makes
    // that candle complete by construction — or every crypto recovery is rejected.
    const { impl } = recordingFetch([kline(TARGET_START, "58500.25")]);
    const obs = await fetchBinanceDailyClose(BTC, {
      ...OPTS,
      fetchImpl: impl,
      now: NOW,
      targetDate: TARGET,
    });
    expect(obs.observationDate).toBe(TARGET);
    expect(obs.close).toBe(58500.25);
    expect(obs.instrumentId).toBe("btc");
  });

  it("names the date when the windowed payload has ZERO rows", async () => {
    const { impl } = recordingFetch([]);
    await expect(
      fetchBinanceDailyClose(BTC, { ...OPTS, fetchImpl: impl, now: NOW, targetDate: TARGET }),
    ).rejects.toThrow(new RegExp(`^Binance BTCUSDT -> .*${TARGET}`));
  });
});

describe("fetchBinanceDailyClose — loud failures", () => {
  it("attributes a non-JSON 200 to the symbol instead of throwing a bare SyntaxError", async () => {
    // Regression guard for #110's finding 2 — see twelvedata-provider.test.ts. The
    // decode used to run outside the guarded region, so a 200 carrying a maintenance
    // page or a Cloudflare interstitial threw before Binance's prefix was applied.
    await expect(
      fetchBinanceDailyClose(BTC, {
        ...OPTS,
        fetchImpl: fetchWith(() => new Response("<html>maintenance</html>", { status: 200 })),
      }),
    ).rejects.toThrow(/^Binance BTCUSDT -> /);
  });

  it("keeps a non-ok status symbol-attributable with its HTTP prefix", async () => {
    await expect(
      fetchBinanceDailyClose(BTC, {
        ...OPTS,
        targetDate: TARGET,
        fetchImpl: fetchWith(
          () => new Response(JSON.stringify({ msg: "no data" }), { status: 400 }),
        ),
      }),
    ).rejects.toThrow(/^Binance BTCUSDT -> HTTP 400/);
  });
});
