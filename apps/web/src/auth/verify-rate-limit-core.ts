/**
 * Attack-verification core for D5 (2026-07-24 hosted-security grill, D10).
 *
 * WHY THIS EXISTS AT ALL. Better Auth's `rateLimit` defaults to in-memory
 * storage. On Vercel that is close to worthless — every serverless instance
 * holds its own counter and instances scale out and recycle, so an attacker
 * spread across cold starts gets a fresh budget each time. The dangerous
 * property is that `rateLimit: { enabled: true }` LOOKS finished and passes
 * review while shipping a control that does not work. Inspection cannot tell
 * `storage: "memory"` from `storage: "database"` once both are configured;
 * only firing real sign-in attempts and observing an HTTP 429 can.
 *
 * Every other control in the security pass is verifiable by looking. This one
 * is not, and it is also the one standing between the internet and the fund.
 *
 * This module is the pure/injectable half: `fetch` and the clock come in as
 * deps so the decision logic is unit-testable without touching the network.
 * The process wiring (argv, env, console, exit code) lives in the thin
 * `verify-rate-limit.ts` shell.
 */

/** Everything the run needs to know; all of it comes from argv/env in the shell. */
export interface VerifyConfig {
  /** Origin to attack, e.g. `http://localhost:3000`. No trailing slash needed. */
  baseUrl: string;
  /** How many sign-in attempts to fire in total. */
  requests: number;
  /** How many attempts are in flight at once. */
  concurrency: number;
  /**
   * A deliberately FAKE email. Never the real account: the script must not be
   * able to mutate, lock, or otherwise disturb the one seeded account.
   */
  email: string;
  /** A deliberately WRONG password. The script never needs the real one. */
  password: string;
}

/** One sign-in attempt's outcome. `status: null` means the request never landed. */
export interface Attempt {
  ordinal: number;
  status: number | null;
  error?: string;
}

export interface VerifyReport {
  /** True IFF at least one HTTP 429 was observed. Nothing else counts as proof. */
  passed: boolean;
  totalRequests: number;
  /** 1-based ordinal of the first 429, or null if the limit never bit. */
  first429Ordinal: number | null;
  /** Status code -> count, plus an `error` bucket for transport failures. */
  statusCounts: Record<string, number>;
  elapsedMs: number;
}

export interface VerifyDeps {
  fetch: typeof globalThis.fetch;
  now: () => number;
}

/** Better Auth mounts its handler at /api/auth; sign-in is the path we hammer. */
export const SIGN_IN_PATH = "/api/auth/sign-in/email";

/**
 * The decision. A run PASSES only when a 429 was actually observed — "we fired
 * a lot of requests and nothing bad happened" is precisely the silent pass this
 * script exists to catch, so an all-200/400 run (and an empty run) is a FAIL.
 */
export function summarize(
  attempts: readonly Attempt[],
  elapsedMs: number,
): VerifyReport {
  const statusCounts: Record<string, number> = {};
  let first429Ordinal: number | null = null;

  for (const attempt of attempts) {
    const bucket = attempt.status === null ? "error" : String(attempt.status);
    statusCounts[bucket] = (statusCounts[bucket] ?? 0) + 1;
    if (attempt.status === 429 && first429Ordinal === null) {
      first429Ordinal = attempt.ordinal;
    }
  }

  return {
    passed: first429Ordinal !== null,
    totalRequests: attempts.length,
    first429Ordinal,
    statusCounts,
    elapsedMs,
  };
}

/** One sign-in attempt with the fake credentials. Never throws. */
async function attempt(
  ordinal: number,
  config: VerifyConfig,
  deps: VerifyDeps,
): Promise<Attempt> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}${SIGN_IN_PATH}`;
  try {
    const response = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: config.email,
        password: config.password,
      }),
    });
    return { ordinal, status: response.status };
  } catch (err: unknown) {
    // A refused connection is a failed run, not a crashed one: we still want
    // the distribution printed so the operator can see WHAT went wrong.
    return {
      ordinal,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fire `config.requests` attempts through `config.concurrency` workers.
 *
 * Sustained volume is the whole point: a handful of requests against one warm
 * instance proves nothing, because a per-instance in-memory counter looks
 * exactly like a shared DB-backed one when there is only one instance. The
 * request count has to be high enough, and the run long enough, to land on
 * several lambdas.
 */
export async function runVerification(
  config: VerifyConfig,
  deps: VerifyDeps,
): Promise<VerifyReport> {
  const started = deps.now();
  const attempts: Attempt[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const ordinal = ++next;
      if (ordinal > config.requests) return;
      attempts.push(await attempt(ordinal, config, deps));
    }
  };

  const workers = Math.max(1, Math.min(config.concurrency, config.requests));
  await Promise.all(Array.from({ length: workers }, worker));

  attempts.sort((a, b) => a.ordinal - b.ordinal);
  return summarize(attempts, Math.max(0, deps.now() - started));
}

/**
 * Human-readable result. The caveat is printed in the OUTPUT, not just filed in
 * the docs: an operator who runs this against `localhost` and sees PASS has
 * proved the limit is enabled and biting, and has proved NOTHING about the
 * counter being shared across instances — the property `storage: "database"`
 * exists for only shows up against the deployed multi-instance surface.
 */
export function formatReport(report: VerifyReport, config: VerifyConfig): string {
  const distribution = Object.entries(report.statusCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}=${count}`)
    .join(" ");

  const lines = [
    `[auth:verify-limit] target      ${config.baseUrl}${SIGN_IN_PATH}`,
    `[auth:verify-limit] fired       ${report.totalRequests} attempts ` +
      `(concurrency ${config.concurrency}) in ${report.elapsedMs}ms`,
    `[auth:verify-limit] statuses    ${distribution || "(none)"}`,
    report.passed
      ? `[auth:verify-limit] first 429   at request #${report.first429Ordinal}`
      : `[auth:verify-limit] first 429   NEVER — the limit did not bite`,
    report.passed
      ? `[auth:verify-limit] RESULT: PASS — rate limiting is enabled and returning 429.`
      : `[auth:verify-limit] RESULT: FAIL — no 429 observed. Either rate limiting is ` +
        `off, the window/max are too loose for this run, or the requests never reached the app.`,
    `[auth:verify-limit] CAVEAT: a PASS against a SINGLE local instance does not prove ` +
      `the DB-backed property. In-memory storage returns 429 too when only one instance ` +
      `is serving. Only a run against the deployed, multi-instance surface shows whether ` +
      `the counter is shared — that is what storage: "database" is for.`,
  ];

  return lines.join("\n");
}
