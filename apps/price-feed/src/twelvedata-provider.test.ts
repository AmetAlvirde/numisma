// Twelve Data provider suite. No live network (every fetch is mocked): the
// happy-path daily-close parse, the missing-key guard, HTTP failure, Twelve Data's
// 200+status:"error" body, malformed payloads, a non-positive close, and the
// request timeout — each attributed to its symbol rather than aborting the run.
//
// There is ONE fetch under test. The single-symbol wrapper this file used to
// exercise separately was deleted (audit finding 18: zero non-test callers, and it
// invited the per-symbol looping the 8-credit/minute cap punishes), so its cases
// live below as one-element batches — the same code path, since a single-symbol
// request is what Twelve Data answers with the un-keyed body shape.
import { describe, expect, it } from "vitest";
import type { InstrumentRegistryEntry } from "@numisma/engine";
import {
  fetchTwelveDataDailyCloses,
  type EquitiesFetchOptions,
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

/** The one-element batch: the un-keyed single-symbol body shape. */
async function fetchOne(entry: InstrumentRegistryEntry, options: EquitiesFetchOptions) {
  const [result] = await fetchTwelveDataDailyCloses([entry], options);
  return result;
}

describe("fetchTwelveDataDailyCloses — single-symbol happy path", () => {
  it("parses the latest daily close into a ProviderObservation", async () => {
    const result = await fetchOne(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(() => timeSeriesResponse("212.44")),
    });
    expect(result?.error).toBeUndefined();
    expect(result?.observation).toEqual({
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
    await fetchOne(AAPL, { ...OPTS, fetchImpl: spy });
    expect(seen).toContain("symbol=AAPL");
    expect(seen).toContain("apikey=test-key");
  });
});

describe("fetchTwelveDataDailyCloses — single-symbol attributable failures", () => {
  // Each case is an attributed RESULT, never a throw: the whole point of the batched
  // shape is that no single symbol's problem can abort the run.
  it("fails attributably when the API key is missing", async () => {
    const result = await fetchOne(AAPL, {
      ...OPTS,
      apiKey: "",
      fetchImpl: fetchWith(() => timeSeriesResponse("1")),
    });
    expect(result?.observation).toBeUndefined();
    expect(result?.error).toMatch(/TWELVEDATA_API_KEY is not set/);
  });

  it("attributes an HTTP error to the symbol", async () => {
    const result = await fetchOne(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(() => new Response("nope", { status: 500, statusText: "Server Error" })),
    });
    expect(result?.error).toMatch(/Twelve Data AAPL -> HTTP 500/);
  });

  it("surfaces Twelve Data's status:error body (200 with an error message)", async () => {
    const result = await fetchOne(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(
        () =>
          new Response(JSON.stringify({ code: 400, message: "symbol not found", status: "error" }), {
            status: 200,
          }),
      ),
    });
    expect(result?.error).toMatch(/Twelve Data AAPL -> symbol not found/);
  });

  it("rejects a payload with no values row", async () => {
    const result = await fetchOne(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(() => new Response(JSON.stringify({ status: "ok", values: [] }), { status: 200 })),
    });
    expect(result?.error).toMatch(/unexpected payload shape/);
  });

  it("rejects a non-positive / NaN close", async () => {
    const result = await fetchOne(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(() => timeSeriesResponse("nope")),
    });
    expect(result?.error).toMatch(/non-positive close/);
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
    const result = await fetchOne(AAPL, { ...OPTS, timeoutMs: 20, fetchImpl: stall });
    expect(result?.error).toMatch(/timed out after 20ms/);
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

// ---------------------------------------------------------------------------
// The optional target-date window (recovery path). Every fixture below is
// AUTHORED — hand-written shapes, never a recorded response.
//
// The trap this block exists to guard: Twelve Data's `end_date` is EXCLUSIVE, so
// `start_date === end_date` returns the no-data 400 even when the bar exists —
// and that 400 is indistinguishable from "that day did not trade". The window
// must therefore span target..target+1, and the pin below fails if they are equal.
describe("fetchTwelveDataDailyCloses — targetDate window", () => {
  const TARGET = "2026-06-30";

  /** An AUTHORED windowed response: one bar, dated on the target day. */
  function windowedResponse(datetime: string, close: string): Response {
    return new Response(
      JSON.stringify({
        meta: { symbol: "AAPL", interval: "1day" },
        values: [{ datetime, open: "1", high: "2", low: "0.5", close, volume: "10" }],
        status: "ok",
      }),
      { status: 200 },
    );
  }

  function spyOn(res: () => Response): { seen: () => string; fetchImpl: typeof fetch } {
    let seen = "";
    const fetchImpl: typeof fetch = ((url: string | URL | Request) => {
      seen = typeof url === "string" ? url : url.toString();
      return Promise.resolve(res());
    }) as typeof fetch;
    return { seen: () => seen, fetchImpl };
  }

  function paramsOf(url: string): URLSearchParams {
    return new URL(url).searchParams;
  }

  it("returns an observation dated on the target day", async () => {
    // The stub answers as the real API does: only a windowed request yields the
    // target day's bar — an un-windowed one yields the NEWEST bar. So this test
    // is red unless the window actually reached the wire.
    let seen = "";
    const fetchImpl: typeof fetch = ((url: string | URL | Request) => {
      seen = typeof url === "string" ? url : url.toString();
      const windowed = seen.includes(`start_date=${TARGET}`);
      return Promise.resolve(
        windowed ? windowedResponse(TARGET, "198.10") : windowedResponse("2026-07-03", "212.44"),
      );
    }) as typeof fetch;
    const result = await fetchOne(AAPL, { ...OPTS, fetchImpl, targetDate: TARGET });
    expect(result?.error).toBeUndefined();
    expect(result?.observation).toEqual({
      instrumentId: "aapl",
      symbol: "AAPL",
      close: 198.1,
      fetchedAt: NOW.toISOString(),
      observationDate: TARGET,
    });
  });

  /**
   * ⚠️ A DELIBERATE TIGHTENING OF §4 R1.1, which says "keep reading `values[0]`".
   *
   * `values[0]` is right only while the exclusive one-day window is guaranteed to
   * return exactly one row. If that ever slipped, Twelve Data's newest-first default
   * ordering would put the NEIGHBOUR day first — and while the stale-bar gate would
   * correctly withhold the MARK, the quote store is written before that gate, so
   * `<dataDir>/prices/<id>.jsonl` would take the wrong day's price under the target
   * `asOf`. Silent wrong data is the thing this lane exists to close, so on the
   * pinned path the row is chosen BY DATE. The live path is untouched (pinned below).
   */
  function twoRowResponse(): Response {
    // Newest-first, as Twelve Data orders by default: the neighbour day leads.
    return new Response(
      JSON.stringify({
        meta: { symbol: "AAPL", interval: "1day" },
        values: [
          { datetime: "2026-07-01", open: "1", high: "2", low: "0.5", close: "212.44", volume: "10" },
          { datetime: TARGET, open: "1", high: "2", low: "0.5", close: "198.10", volume: "10" },
        ],
        status: "ok",
      }),
      { status: 200 },
    );
  }

  it("selects the row DATED on the target day, not whichever row came first", async () => {
    const result = await fetchOne(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(() => twoRowResponse()),
      targetDate: TARGET,
    });

    expect(result?.error).toBeUndefined();
    expect(result?.observation?.observationDate).toBe(TARGET);
    // The number is the load-bearing half: `values[0]` would store 212.44 under the
    // target date, in the price store, before the stale-bar gate can withhold it.
    expect(result?.observation?.close).toBe(198.1);
  });

  it("fails the symbol, naming the date, when NO row carries the target day", async () => {
    // Same channel a zero-row payload already uses — a symbol-attributable failure
    // that names the date, never a neighbouring bar quietly stored as the target's.
    const result = await fetchOne(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(() => windowedResponse("2026-07-01", "212.44")),
      targetDate: TARGET,
    });

    expect(result?.observation).toBeUndefined();
    expect(result?.error).toMatch(/AAPL/);
    expect(result?.error).toMatch(new RegExp(TARGET));
  });

  it("requests an end_date strictly ONE DAY AFTER start_date (the end is exclusive)", async () => {
    const spy = spyOn(() => windowedResponse(TARGET, "198.10"));
    await fetchOne(AAPL, { ...OPTS, fetchImpl: spy.fetchImpl, targetDate: TARGET });
    const params = paramsOf(spy.seen());
    expect(params.get("start_date")).toBe(TARGET);
    // The guard that catches the trap: an inclusive-looking window is red here.
    expect(params.get("end_date")).not.toBe(params.get("start_date"));
    expect(params.get("end_date")).toBe("2026-07-01");
  });

  it("spans a month boundary correctly rather than by string surgery", async () => {
    const spy = spyOn(() => windowedResponse("2026-02-28", "1.5"));
    await fetchOne(AAPL, { ...OPTS, fetchImpl: spy.fetchImpl, targetDate: "2026-02-28" });
    const params = paramsOf(spy.seen());
    expect(params.get("start_date")).toBe("2026-02-28");
    expect(params.get("end_date")).toBe("2026-03-01");
  });

  it("drops outputsize on the windowed path and keeps the batch shape", async () => {
    const spy = spyOn(() =>
      new Response(
        JSON.stringify({
          AAPL: {
            values: [{ datetime: TARGET, close: "198.10" }],
            status: "ok",
          },
          GOOGL: {
            values: [{ datetime: TARGET, close: "173.25" }],
            status: "ok",
          },
        }),
        { status: 200 },
      ),
    );
    const results = await fetchTwelveDataDailyCloses([AAPL, GOOGL], {
      ...OPTS,
      fetchImpl: spy.fetchImpl,
      targetDate: TARGET,
    });
    const params = paramsOf(spy.seen());
    expect(params.get("outputsize")).toBeNull();
    expect(params.get("symbol")).toBe("AAPL,GOOGL");
    expect(results.map((r) => r.observation?.close)).toEqual([198.1, 173.25]);
    expect(results.map((r) => r.observation?.observationDate)).toEqual([TARGET, TARGET]);
  });

  it("still fans a batch-level status:error out to every symbol", async () => {
    const spy = spyOn(
      () =>
        new Response(JSON.stringify({ status: "error", code: 400, message: "no data is available" }), {
          status: 200,
        }),
    );
    const results = await fetchTwelveDataDailyCloses([AAPL, GOOGL], {
      ...OPTS,
      fetchImpl: spy.fetchImpl,
      targetDate: TARGET,
    });
    expect(results.map((r) => r.error)).toEqual([
      "Twelve Data AAPL -> no data is available",
      "Twelve Data GOOGL -> no data is available",
    ]);
  });
});

// The LIVE 18:00 path, pinned. This block is a large part of the safety argument
// for the recovery change: with no `targetDate` the request must stay byte-identical
// to what production sends today — `outputsize=1`, and no date parameters at all.
describe("fetchTwelveDataDailyCloses — live path pinned (no targetDate)", () => {
  it("still takes values[0] when a live response carries more than one row", async () => {
    // The date-selecting branch must not leak onto the live path: with no target
    // date there is nothing to match against, and `outputsize=1`'s newest bar is
    // whatever leads the array. Reading anything else here would be a behaviour
    // change to the nightly 18:00 job.
    const result = await fetchOne(AAPL, {
      ...OPTS,
      fetchImpl: fetchWith(
        () =>
          new Response(
            JSON.stringify({
              meta: { symbol: "AAPL", interval: "1day" },
              values: [
                { datetime: "2026-07-03", close: "212.44" },
                { datetime: "2026-07-02", close: "198.10" },
              ],
              status: "ok",
            }),
            { status: 200 },
          ),
      ),
    });

    expect(result?.observation?.observationDate).toBe("2026-07-03");
    expect(result?.observation?.close).toBe(212.44);
  });

  it("sends outputsize=1 and NO date params", async () => {
    let seen = "";
    const spy: typeof fetch = ((url: string | URL | Request) => {
      seen = typeof url === "string" ? url : url.toString();
      return Promise.resolve(timeSeriesResponse("212.44"));
    }) as typeof fetch;
    await fetchOne(AAPL, { ...OPTS, fetchImpl: spy });
    expect(seen).toBe(
      "https://api.twelvedata.com/time_series?symbol=AAPL&interval=1day&outputsize=1&apikey=test-key",
    );
  });

  it("sends outputsize=1 and NO date params for a batch", async () => {
    let seen = "";
    const spy: typeof fetch = ((url: string | URL | Request) => {
      seen = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({
            AAPL: { values: [{ datetime: "2026-07-03", close: "1" }], status: "ok" },
            GOOGL: { values: [{ datetime: "2026-07-03", close: "2" }], status: "ok" },
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;
    await fetchTwelveDataDailyCloses([AAPL, GOOGL], { ...OPTS, fetchImpl: spy });
    expect(seen).toBe(
      "https://api.twelvedata.com/time_series?symbol=AAPL,GOOGL&interval=1day&outputsize=1&apikey=test-key",
    );
  });
});
