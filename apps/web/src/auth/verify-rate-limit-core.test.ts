import { describe, expect, it } from "vitest";
import {
  formatReport,
  runVerification,
  summarize,
  type Attempt,
  type VerifyConfig,
} from "./verify-rate-limit-core.ts";

/**
 * D5/D10 (2026-07-24 hosted-security grill). The rate limit is the ONE control
 * in the pass that can be fully configured, pass review, and still be fake —
 * `storage: "memory"` looks identical to `storage: "database"` from the config
 * file, and identical again from a single warm lambda. Only firing real
 * sign-in attempts and OBSERVING a 429 distinguishes them.
 *
 * These tests pin the decision logic of that script, injecting fetch + clock so
 * nothing here touches the network: a run that observed a 429 is a PASS, a run
 * that only ever saw 200/400 is a FAIL. The failure mode being defended against
 * is a silent pass, so "no 429 seen" must never be reported as success.
 */

const CONFIG: VerifyConfig = {
  baseUrl: "https://example.invalid",
  requests: 6,
  concurrency: 2,
  email: "rate-limit-probe@invalid.test",
  password: "definitely-not-the-real-password",
};

function attempts(statuses: number[]): Attempt[] {
  return statuses.map((status, i) => ({ ordinal: i + 1, status }));
}

describe("summarize: the pass/fail decision", () => {
  it("PASSES when a 429 was observed, reporting the ordinal it first appeared at", () => {
    const report = summarize(attempts([400, 400, 400, 429, 429, 429]), 1234);

    expect(report.passed).toBe(true);
    expect(report.first429Ordinal).toBe(4);
    expect(report.statusCounts).toEqual({ 400: 3, 429: 3 });
    expect(report.elapsedMs).toBe(1234);
    expect(report.totalRequests).toBe(6);
  });

  it("FAILS when no 429 ever arrived — a silent pass is the failure mode", () => {
    const report = summarize(attempts([200, 400, 400, 200, 400, 400]), 900);

    expect(report.passed).toBe(false);
    expect(report.first429Ordinal).toBeNull();
    expect(report.statusCounts).toEqual({ 200: 2, 400: 4 });
  });

  it("FAILS on an empty run rather than vacuously passing", () => {
    expect(summarize([], 0).passed).toBe(false);
  });

  it("counts transport failures as their own bucket without inventing a pass", () => {
    const report = summarize(
      [
        { ordinal: 1, status: 400 },
        { ordinal: 2, status: null, error: "fetch failed" },
      ],
      10,
    );

    expect(report.passed).toBe(false);
    expect(report.statusCounts).toEqual({ 400: 1, error: 1 });
  });
});

describe("runVerification: drives the injected fetch, never the network", () => {
  it("fires exactly `requests` POSTs at /api/auth/sign-in/email with the fake creds", async () => {
    const seen: { url: string; body: unknown; method: string | undefined }[] =
      [];
    let clock = 1_000;

    const report = await runVerification(CONFIG, {
      fetch: async (url, init) => {
        seen.push({
          url: String(url),
          method: init?.method,
          body: JSON.parse(String(init?.body)),
        });
        clock += 5;
        return new Response("{}", { status: seen.length > 3 ? 429 : 400 });
      },
      now: () => clock,
    });

    expect(seen).toHaveLength(6);
    const first = seen[0]!;
    expect(first.url).toBe("https://example.invalid/api/auth/sign-in/email");
    expect(first.method).toBe("POST");
    expect(first.body).toEqual({
      email: CONFIG.email,
      password: CONFIG.password,
    });
    expect(report.passed).toBe(true);
    expect(report.elapsedMs).toBeGreaterThan(0);
  });

  it("records a rejected fetch as an error attempt instead of throwing", async () => {
    const report = await runVerification(
      { ...CONFIG, requests: 2, concurrency: 1 },
      {
        fetch: async () => {
          throw new Error("ECONNREFUSED");
        },
        now: () => 0,
      },
    );

    expect(report.passed).toBe(false);
    expect(report.statusCounts).toEqual({ error: 2 });
  });
});

describe("formatReport: says out loud what a local pass does NOT prove", () => {
  it("always warns that a single-instance pass does not prove the DB-backed property", () => {
    const text = formatReport(summarize(attempts([400, 429]), 50), CONFIG);

    expect(text).toContain("does not prove");
    expect(text).toContain("storage");
    expect(text).toContain("PASS");
  });

  it("reports FAIL text when no 429 was seen", () => {
    const text = formatReport(summarize(attempts([400, 400]), 50), CONFIG);
    expect(text).toContain("FAIL");
  });
});
