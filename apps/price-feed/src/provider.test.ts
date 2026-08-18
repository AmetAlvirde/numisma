// The shared `fetchJson` envelope. No live network — every response below is an
// AUTHORED fixture, never a recorded provider run. The subject here is R1.4: a
// non-ok HTTP status must carry the provider's own sentence in the bare `reason`,
// while never becoming a throw and never disturbing the ok, timeout or
// transport-error paths.
import { describe, expect, it } from "vitest";
import { fetchJson } from "./provider.js";

function fetchWith(res: () => Response | Promise<Response>): typeof fetch {
  return (() => Promise.resolve(res())) as typeof fetch;
}

/** A JSON error body under whichever key the fixture wants to exercise. */
function errorBody(payload: unknown, status: number, statusText: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

const OPTS = { timeoutMs: 5_000 };

describe("fetchJson — non-ok status carries the provider's own words", () => {
  it("appends a string `message`", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() =>
        errorBody({ message: "No data is available on the specified dates" }, 400, "Bad Request"),
      ),
    });
    expect(result).toEqual({
      ok: false,
      reason: "HTTP 400 Bad Request — No data is available on the specified dates",
    });
  });

  it("appends a string `msg` when there is no `message`", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => errorBody({ code: -1121, msg: "Invalid symbol." }, 400, "Bad Request")),
    });
    expect(result).toEqual({ ok: false, reason: "HTTP 400 Bad Request — Invalid symbol." });
  });

  it("appends a string `error` when there is neither `message` nor `msg`", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => errorBody({ error: "token no valido" }, 403, "Forbidden")),
    });
    expect(result).toEqual({ ok: false, reason: "HTTP 403 Forbidden — token no valido" });
  });

  it("prefers `message` over `msg` and `error` when several keys are present", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() =>
        errorBody({ error: "third", msg: "second", message: "first" }, 400, "Bad Request"),
      ),
    });
    expect(result).toEqual({ ok: false, reason: "HTTP 400 Bad Request — first" });
  });

  it("ignores a non-string value under a preferred key and falls through", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => errorBody({ message: { nested: true }, msg: "usable" }, 400, "Bad Request")),
    });
    expect(result).toEqual({ ok: false, reason: "HTTP 400 Bad Request — usable" });
  });

  it("falls back to a trimmed snippet of a non-JSON body", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(
        () => new Response("  rate limit exceeded  ", { status: 429, statusText: "Too Many Requests" }),
      ),
    });
    expect(result).toEqual({ ok: false, reason: "HTTP 429 Too Many Requests — rate limit exceeded" });
  });

  it("falls back to the raw body when the JSON carries none of the three keys", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => errorBody({ detail: "quota" }, 402, "Payment Required")),
    });
    expect(result).toEqual({ ok: false, reason: 'HTTP 402 Payment Required — {"detail":"quota"}' });
  });

  it("keeps the bare reason when the body is empty", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => new Response("", { status: 503, statusText: "Service Unavailable" })),
    });
    expect(result).toEqual({ ok: false, reason: "HTTP 503 Service Unavailable" });
  });

  it("keeps the bare reason when the body is whitespace only", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => new Response("   \n\t  ", { status: 500, statusText: "Internal Server Error" })),
    });
    expect(result).toEqual({ ok: false, reason: "HTTP 500 Internal Server Error" });
  });

  it("falls through a preferred key holding only whitespace", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => errorBody({ message: "   ", msg: "the real one" }, 400, "Bad Request")),
    });
    // Whitespace is not the provider's sentence: it must not win the preference
    // order, and it must never leave a dangling separator with nothing after it.
    expect(result).toEqual({ ok: false, reason: "HTTP 400 Bad Request — the real one" });
  });

  it("caps the appended text so an HTML interstitial cannot flood the log", async () => {
    const flood = `<html>${"x".repeat(5_000)}</html>`;
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => new Response(flood, { status: 502, statusText: "Bad Gateway" })),
    });
    if (result.ok) throw new Error("expected a failure result");
    expect(result.reason.startsWith("HTTP 502 Bad Gateway — <html>xxx")).toBe(true);
    expect(result.reason.length).toBeLessThanOrEqual(256);
  });

  it("caps a long value recovered from a preferred key too", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => errorBody({ message: "y".repeat(5_000) }, 400, "Bad Request")),
    });
    if (result.ok) throw new Error("expected a failure result");
    expect(result.reason.startsWith("HTTP 400 Bad Request — yyy")).toBe(true);
    expect(result.reason.length).toBeLessThanOrEqual(256);
  });
});

describe("fetchJson — a non-ok status never becomes a throw", () => {
  it("returns the bare fallback when the error body read itself throws", async () => {
    let readAttempted = false;
    const exploding = () => {
      // `pull`, not `start`: `start` runs at construction, so a probe there would
      // read `true` even if the body were never touched — the test would pass
      // whether or not the guarded read exists.
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          readAttempted = true;
          controller.error(new TypeError("terminated"));
        },
      });
      return new Response(body, { status: 500, statusText: "Internal Server Error" });
    };
    // A rejected read must be swallowed: `fetchJson` resolves, it does not reject.
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(exploding),
    });
    expect(readAttempted).toBe(true);
    expect(result).toEqual({ ok: false, reason: "HTTP 500 Internal Server Error" });
  });

  it("does not reject when the error body is a truncated JSON document", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(
        () =>
          new Response('{"message": "cut off here', {
            status: 400,
            statusText: "Bad Request",
            headers: { "content-type": "application/json" },
          }),
      ),
    });
    if (result.ok) throw new Error("expected a failure result");
    expect(result.reason.startsWith("HTTP 400 Bad Request")).toBe(true);
  });
});

describe("fetchJson — the compatible prefix", () => {
  it("keeps `HTTP <status> <statusText>` first and byte-identical", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => errorBody({ message: "explained" }, 403, "Forbidden")),
    });
    if (result.ok) throw new Error("expected a failure result");
    expect(/^HTTP 403 Forbidden/.test(result.reason)).toBe(true);
  });
});

describe("fetchJson — the untouched paths", () => {
  it("returns the decoded body on the ok path", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(
        () =>
          new Response(JSON.stringify({ values: [{ close: "1.5" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    });
    expect(result).toEqual({ ok: true, body: { values: [{ close: "1.5" }] } });
  });

  it("reports a non-JSON body on an OK response as an ordinary failure, not a throw", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: fetchWith(() => new Response("<html>maintenance</html>", { status: 200 })),
    });
    if (result.ok) throw new Error("expected a failure result");
    expect(result.reason).not.toContain("HTTP 200");
  });

  it("keeps the timeout reason unchanged", async () => {
    const stall: typeof fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch;
    const result = await fetchJson("https://example.invalid/x", { timeoutMs: 20, fetchImpl: stall });
    expect(result).toEqual({ ok: false, reason: "request timed out after 20ms" });
  });

  it("keeps the transport-error reason unchanged", async () => {
    const result = await fetchJson("https://example.invalid/x", {
      ...OPTS,
      fetchImpl: (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: "getaddrinfo ENOTFOUND" });
  });
});
