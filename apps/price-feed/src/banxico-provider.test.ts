// Banxico SF43718 (USD/MXN FIX) provider suite. No live network (every fetch is
// mocked): the happy-path parse (dd/MM/yyyy → YYYY-MM-DD, MXN-per-USD rate), the
// missing-token guard, HTTP failure, malformed payloads, a missing/`N/E` rate, and
// the request timeout — each thrown loud so the *-mxn derivations can fail cleanly.
import { describe, expect, it } from "vitest";
import { fetchBanxicoFix } from "./banxico-provider.js";

function fixResponse(dato: string, fecha = "03/07/2026"): Response {
  return new Response(
    JSON.stringify({
      bmx: { series: [{ idSerie: "SF43718", titulo: "FIX", datos: [{ fecha, dato }] }] },
    }),
    { status: 200 },
  );
}

function fetchWith(res: () => Response | Promise<Response>): typeof fetch {
  return (() => Promise.resolve(res())) as typeof fetch;
}

const OPTS = { timeoutMs: 5_000, token: "test-token" };

describe("fetchBanxicoFix — happy path", () => {
  it("parses the latest FIX rate and normalizes the date to YYYY-MM-DD", async () => {
    const fix = await fetchBanxicoFix({ ...OPTS, fetchImpl: fetchWith(() => fixResponse("18.7654")) });
    expect(fix).toEqual({ rate: 18.7654, date: "2026-07-03" });
  });

  it("sends the token in the Bmx-Token header, never the URL", async () => {
    let seenHeaders: Record<string, string> = {};
    let seenUrl = "";
    const spy: typeof fetch = ((url: string | URL | Request, init?: RequestInit) => {
      seenUrl = typeof url === "string" ? url : url.toString();
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(fixResponse("18.5"));
    }) as typeof fetch;
    await fetchBanxicoFix({ ...OPTS, fetchImpl: spy });
    expect(seenHeaders["Bmx-Token"]).toBe("test-token");
    expect(seenUrl).not.toContain("test-token");
  });
});

describe("fetchBanxicoFix — loud failures", () => {
  it("fails loud when the token is missing", async () => {
    await expect(
      fetchBanxicoFix({ ...OPTS, token: "", fetchImpl: fetchWith(() => fixResponse("18.5")) }),
    ).rejects.toThrow(/BANXICO_TOKEN is not set/);
  });

  it("attributes an HTTP error", async () => {
    await expect(
      fetchBanxicoFix({
        ...OPTS,
        fetchImpl: fetchWith(() => new Response("nope", { status: 403, statusText: "Forbidden" })),
      }),
    ).rejects.toThrow(/Banxico SF43718 -> HTTP 403/);
  });

  it("rejects a payload missing the bmx envelope", async () => {
    await expect(
      fetchBanxicoFix({
        ...OPTS,
        fetchImpl: fetchWith(() => new Response(JSON.stringify({ error: "boom" }), { status: 200 })),
      }),
    ).rejects.toThrow(/unexpected payload shape/);
  });

  it("rejects a payload with an empty series", async () => {
    await expect(
      fetchBanxicoFix({
        ...OPTS,
        fetchImpl: fetchWith(() => new Response(JSON.stringify({ bmx: { series: [] } }), { status: 200 })),
      }),
    ).rejects.toThrow(/no FIX observation/);
  });

  it("rejects a missing observation (empty datos)", async () => {
    await expect(
      fetchBanxicoFix({
        ...OPTS,
        fetchImpl: fetchWith(
          () =>
            new Response(JSON.stringify({ bmx: { series: [{ idSerie: "SF43718", datos: [] }] } }), {
              status: 200,
            }),
        ),
      }),
    ).rejects.toThrow(/no FIX observation/);
  });

  it("rejects a non-numeric / N/E rate", async () => {
    await expect(
      fetchBanxicoFix({ ...OPTS, fetchImpl: fetchWith(() => fixResponse("N/E")) }),
    ).rejects.toThrow(/non-positive FIX rate/);
  });

  it("rejects an unexpected date format", async () => {
    await expect(
      fetchBanxicoFix({ ...OPTS, fetchImpl: fetchWith(() => fixResponse("18.5", "2026-07-03")) }),
    ).rejects.toThrow(/unexpected FIX date format/);
  });

  it("attributes a non-JSON 200 to the series instead of throwing a bare SyntaxError", async () => {
    // Regression guard for #110's finding 2 — see twelvedata-provider.test.ts. Banxico
    // was always caught by the orchestrator, but unlabelled: the decode threw before
    // any provider prefix was applied.
    await expect(
      fetchBanxicoFix({
        ...OPTS,
        fetchImpl: fetchWith(() => new Response("<html>maintenance</html>", { status: 200 })),
      }),
    ).rejects.toThrow(/^Banxico SF43718 -> /);
  });

  it("attributes a request timeout", async () => {
    const stall: typeof fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch;
    await expect(
      fetchBanxicoFix({ ...OPTS, timeoutMs: 20, fetchImpl: stall }),
    ).rejects.toThrow(/timed out after 20ms/);
  });

  it("attributes a timeout that strikes during the BODY read, not just the fetch", async () => {
    // The JSON decode moved INSIDE `fetchJson`'s guarded region, so the R4
    // AbortController now bounds the body read too — `clearTimeout` no longer fires
    // before the decode begins. The stall above rejects at the FETCH stage and never
    // reaches this path: here the headers arrive fine (200) and the body is what
    // never completes. The abort must still surface as the timeout reason with the
    // provider's own label, not as the transport's raw wording.
    const stallBody: typeof fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"bmx":'));
          init?.signal?.addEventListener("abort", () => {
            // The shape undici surfaces for a mid-body abort: a DOMException whose
            // `name` is `AbortError` and which satisfies `instanceof Error`.
            controller.error(new DOMException("This operation was aborted", "AbortError"));
          });
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
      );
    }) as typeof fetch;

    await expect(
      fetchBanxicoFix({ ...OPTS, timeoutMs: 20, fetchImpl: stallBody }),
    ).rejects.toThrow(/^Banxico SF43718 -> request timed out after 20ms$/);
  });
});

describe("fetchBanxicoFix — target date", () => {
  function urlSpy(res: () => Response | Promise<Response>): {
    fetchImpl: typeof fetch;
    url: () => string;
  } {
    let seen = "";
    const fetchImpl: typeof fetch = ((url: string | URL | Request) => {
      seen = typeof url === "string" ? url : url.toString();
      return Promise.resolve(res());
    }) as typeof fetch;
    return { fetchImpl, url: () => seen };
  }

  it("pins the live path to /datos/oportuno when no targetDate is given", async () => {
    const spy = urlSpy(() => fixResponse("18.5"));
    await fetchBanxicoFix({ ...OPTS, fetchImpl: spy.fetchImpl });
    expect(spy.url()).toBe(
      "https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno",
    );
  });

  it("requests /datos/<target>/<target> — the same date on both ends", async () => {
    const spy = urlSpy(() => fixResponse("18.9012", "14/08/2026"));
    await fetchBanxicoFix({ ...OPTS, targetDate: "2026-08-14", fetchImpl: spy.fetchImpl });
    expect(spy.url()).toBe(
      "https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/2026-08-14/2026-08-14",
    );
    expect(spy.url()).not.toContain("oportuno");
  });

  it("returns the observation for the requested date from an authored single-datum payload", async () => {
    // Authored fixture — an invented FIX rate, not a recorded Banxico response.
    const fix = await fetchBanxicoFix({
      ...OPTS,
      targetDate: "2026-08-14",
      fetchImpl: fetchWith(() => fixResponse("18.9012", "14/08/2026")),
    });
    expect(fix).toEqual({ rate: 18.9012, date: "2026-08-14" });
  });

  it("still throws the no-observation refusal when the target date has no published FIX", async () => {
    // Banxico omits `datos` entirely on an unpublished date (a weekday holiday under
    // the owed-set filter). The refusal must stay loud, never a silent neighbour day.
    await expect(
      fetchBanxicoFix({
        ...OPTS,
        targetDate: "2026-09-16",
        fetchImpl: fetchWith(
          () =>
            new Response(JSON.stringify({ bmx: { series: [{ idSerie: "SF43718" }] } }), {
              status: 200,
            }),
        ),
      }),
    ).rejects.toThrow(/no FIX observation/);
  });
});
