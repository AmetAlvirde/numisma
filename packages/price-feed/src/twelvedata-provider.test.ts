// Twelve Data provider suite. No live network (every fetch is mocked): the
// happy-path daily-close parse, the missing-key guard, HTTP failure, Twelve Data's
// 200+status:"error" body, malformed payloads, a non-positive close, and the
// request timeout — each thrown loud and symbol-attributable.
import { describe, expect, it } from "vitest";
import type { InstrumentRegistryEntry } from "@numisma/engine";
import { fetchTwelveDataDailyClose } from "./twelvedata-provider.js";

const AAPL: InstrumentRegistryEntry = {
  instrumentId: "aapl",
  symbol: "AAPL",
  quoteCurrency: "USD",
  source: "twelvedata",
};

const NOW = new Date("2026-07-04T00:05:00.000Z");

function timeSeriesResponse(close: string): Response {
  return new Response(
    JSON.stringify({
      meta: { symbol: "AAPL", interval: "1day" },
      values: [{ datetime: "2026-07-03", open: "1", high: "2", low: "0.5", close, volume: "10" }],
      status: "ok",
    }),
    { status: 200 },
  );
}

function fetchWith(res: () => Response | Promise<Response>): typeof fetch {
  return (() => Promise.resolve(res())) as typeof fetch;
}

const OPTS = { timeoutMs: 5_000, apiKey: "test-key", now: () => NOW };

describe("fetchTwelveDataDailyClose — happy path", () => {
  it("parses the latest daily close into a ProviderObservation", async () => {
    const obs = await fetchTwelveDataDailyClose(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(() => timeSeriesResponse("212.44")),
    });
    expect(obs).toEqual({
      instrumentId: "aapl",
      symbol: "AAPL",
      close: 212.44,
      fetchedAt: NOW.toISOString(),
    });
  });

  it("sends the API key in the request URL", async () => {
    let seen = "";
    const spy: typeof fetch = ((url: string | URL | Request) => {
      seen = typeof url === "string" ? url : url.toString();
      return Promise.resolve(timeSeriesResponse("100"));
    }) as typeof fetch;
    await fetchTwelveDataDailyClose(AAPL, { ...OPTS, fetchImpl: spy });
    expect(seen).toContain("symbol=AAPL");
    expect(seen).toContain("apikey=test-key");
  });
});

describe("fetchTwelveDataDailyClose — loud, attributable failures", () => {
  it("fails loud when the API key is missing", async () => {
    await expect(
      fetchTwelveDataDailyClose(AAPL, { ...OPTS, apiKey: "", fetchImpl: fetchWith(() => timeSeriesResponse("1")) }),
    ).rejects.toThrow(/TWELVEDATA_API_KEY is not set/);
  });

  it("attributes an HTTP error to the symbol", async () => {
    await expect(
      fetchTwelveDataDailyClose(AAPL, {
        ...OPTS,
        fetchImpl: fetchWith(() => new Response("nope", { status: 500, statusText: "Server Error" })),
      }),
    ).rejects.toThrow(/Twelve Data AAPL -> HTTP 500/);
  });

  it("surfaces Twelve Data's status:error body (200 with an error message)", async () => {
    await expect(
      fetchTwelveDataDailyClose(AAPL, {
        ...OPTS,
        fetchImpl: fetchWith(
          () =>
            new Response(JSON.stringify({ code: 400, message: "symbol not found", status: "error" }), {
              status: 200,
            }),
        ),
      }),
    ).rejects.toThrow(/Twelve Data AAPL -> symbol not found/);
  });

  it("rejects a payload with no values row", async () => {
    await expect(
      fetchTwelveDataDailyClose(AAPL, {
        ...OPTS,
        fetchImpl: fetchWith(() => new Response(JSON.stringify({ status: "ok", values: [] }), { status: 200 })),
      }),
    ).rejects.toThrow(/unexpected payload shape/);
  });

  it("rejects a non-positive / NaN close", async () => {
    await expect(
      fetchTwelveDataDailyClose(AAPL, { ...OPTS, fetchImpl: fetchWith(() => timeSeriesResponse("nope")) }),
    ).rejects.toThrow(/non-positive close/);
  });

  it("attributes a request timeout to the symbol", async () => {
    const stall: typeof fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch;
    await expect(
      fetchTwelveDataDailyClose(AAPL, { ...OPTS, timeoutMs: 20, fetchImpl: stall }),
    ).rejects.toThrow(/timed out after 20ms/);
  });
});
