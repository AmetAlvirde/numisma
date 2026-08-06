// Twelve Data provider suite. No live network (every fetch is mocked): the
// happy-path daily-close parse, the missing-key guard, HTTP failure, Twelve Data's
// 200+status:"error" body, malformed payloads, a non-positive close, and the
// request timeout — each thrown loud and symbol-attributable.
import { describe, expect, it } from "vitest";
import type { InstrumentRegistryEntry } from "@numisma/engine";
import {
  fetchTwelveDataDailyClose,
  fetchTwelveDataDailyCloses,
} from "./twelvedata-provider.js";

const AAPL: InstrumentRegistryEntry = {
  instrumentId: "aapl",
  symbol: "AAPL",
  quoteCurrency: "USD",
  source: "twelvedata",
};

const GOOGL: InstrumentRegistryEntry = {
  instrumentId: "googl",
  symbol: "GOOGL",
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
      observationDate: "2026-07-03",
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

describe("fetchTwelveDataDailyCloses — batched multi-symbol fetch (rate-limit fix)", () => {
  // A batch of >1 symbol comes back keyed by symbol, each value the same
  // { values, status } shape a single-symbol request returns un-keyed.
  function batchResponse(bySymbol: Record<string, unknown>): Response {
    return new Response(JSON.stringify(bySymbol), { status: 200 });
  }

  it("packs every symbol into ONE request and parses each keyed result", async () => {
    let seen = "";
    const spy: typeof fetch = ((url: string | URL | Request) => {
      seen = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        batchResponse({
          AAPL: { status: "ok", values: [{ datetime: "2026-07-03", close: "212.44" }] },
          GOOGL: { status: "ok", values: [{ datetime: "2026-07-03", close: "178.25" }] },
        }),
      );
    }) as typeof fetch;

    const results = await fetchTwelveDataDailyCloses([AAPL, GOOGL], { ...OPTS, fetchImpl: spy });

    // One request carrying both symbols (comma-joined), not two.
    expect(seen).toContain("symbol=AAPL,GOOGL");
    expect(results).toEqual([
      { entry: AAPL, observation: { instrumentId: "aapl", symbol: "AAPL", close: 212.44, fetchedAt: NOW.toISOString(), observationDate: "2026-07-03" } },
      { entry: GOOGL, observation: { instrumentId: "googl", symbol: "GOOGL", close: 178.25, fetchedAt: NOW.toISOString(), observationDate: "2026-07-03" } },
    ]);
  });

  it("attributes ONE bad symbol to that instrument while the rest of the batch succeeds", async () => {
    const results = await fetchTwelveDataDailyCloses([AAPL, GOOGL], {
      ...OPTS,
      fetchImpl: fetchWith(() =>
        batchResponse({
          AAPL: { status: "ok", values: [{ datetime: "2026-07-03", close: "212.44" }] },
          GOOGL: { status: "error", message: "symbol not found" },
        }),
      ),
    });

    const aapl = results.find((r) => r.entry.instrumentId === "aapl");
    const googl = results.find((r) => r.entry.instrumentId === "googl");
    expect(aapl?.observation?.close).toBe(212.44);
    expect(aapl?.error).toBeUndefined();
    expect(googl?.observation).toBeUndefined();
    expect(googl?.error).toMatch(/Twelve Data GOOGL -> symbol not found/);
  });

  it("fails EVERY symbol attributably on a request-level failure (bad key / HTTP)", async () => {
    const results = await fetchTwelveDataDailyCloses([AAPL, GOOGL], {
      ...OPTS,
      // A batch-level rejection comes back as a top-level status:error.
      fetchImpl: fetchWith(
        () => new Response(JSON.stringify({ code: 401, message: "invalid api key", status: "error" }), { status: 200 }),
      ),
    });
    expect(results.map((r) => r.observation)).toEqual([undefined, undefined]);
    expect(results[0]?.error).toMatch(/Twelve Data AAPL -> invalid api key/);
    expect(results[1]?.error).toMatch(/Twelve Data GOOGL -> invalid api key/);
  });

  it("carries the bar's observationDate from the row datetime", async () => {
    const [result] = await fetchTwelveDataDailyCloses([AAPL], {
      ...OPTS,
      // A single-symbol batch returns the un-keyed shape; a datetime with a time part
      // is truncated to its date.
      fetchImpl: fetchWith(
        () => new Response(JSON.stringify({ status: "ok", values: [{ datetime: "2026-07-02 15:30:00", close: "200" }] }), { status: 200 }),
      ),
    });
    expect(result?.observation?.observationDate).toBe("2026-07-02");
  });

  it("fails EVERY symbol attributably on a non-JSON 200 instead of aborting the run", async () => {
    // Regression guard for #110's finding 2. `res.json()` used to sit OUTSIDE the
    // guarded region, so a 200 carrying a maintenance page or a Cloudflare
    // interstitial threw a bare SyntaxError that escaped this function entirely and
    // aborted the whole fetch run — contradicting its own docstring promise that one
    // bad symbol can never do that. It is an ordinary attributed result now.
    const results = await fetchTwelveDataDailyCloses([AAPL, GOOGL], {
      ...OPTS,
      fetchImpl: fetchWith(
        () => new Response("<html>scheduled maintenance</html>", { status: 200 }),
      ),
    });
    expect(results.map((r) => r.observation)).toEqual([undefined, undefined]);
    expect(results[0]?.error).toMatch(/^Twelve Data AAPL -> /);
    expect(results[1]?.error).toMatch(/^Twelve Data GOOGL -> /);
  });

  it("attributes a malformed symbol (lone surrogate) instead of throwing a URIError", async () => {
    // `encodeURIComponent` throws `URIError: URI malformed` on a lone surrogate, so
    // building the request URL is a failure channel of its own. It must land as an
    // attributed per-entry result like every other failure here — never a throw that
    // escapes and aborts the whole run.
    const BROKEN: InstrumentRegistryEntry = { ...AAPL, instrumentId: "broken", symbol: "\uD800" };
    let called = false;
    const spy: typeof fetch = (() => {
      called = true;
      return Promise.resolve(timeSeriesResponse("1"));
    }) as typeof fetch;

    const results = await fetchTwelveDataDailyCloses([BROKEN, GOOGL], { ...OPTS, fetchImpl: spy });

    expect(called).toBe(false);
    expect(results.map((r) => r.observation)).toEqual([undefined, undefined]);
    expect(results[0]?.error).toMatch(/^Twelve Data \uD800 -> /);
    expect(results[1]?.error).toMatch(/^Twelve Data GOOGL -> /);
  });

  it("returns [] for an empty entry list without touching the network", async () => {
    let called = false;
    const spy: typeof fetch = (() => {
      called = true;
      return Promise.resolve(timeSeriesResponse("1"));
    }) as typeof fetch;
    expect(await fetchTwelveDataDailyCloses([], { ...OPTS, fetchImpl: spy })).toEqual([]);
    expect(called).toBe(false);
  });
});
