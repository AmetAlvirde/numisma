/**
 * Verify the D5 rate limit BY ATTACK, not by inspection (D10).
 *
 *   pnpm --filter @numisma/web auth:verify-limit
 *   pnpm --filter @numisma/web auth:verify-limit -- --url https://<preview>.vercel.app
 *   pnpm --filter @numisma/web auth:verify-limit -- --requests 200 --concurrency 16
 *
 * Fires repeated `POST /api/auth/sign-in/email` attempts with a deliberately
 * WRONG password against a deliberately FAKE email, and succeeds only when it
 * observes an HTTP 429. It never needs — and must never be given — the real
 * account's credentials, and it cannot lock the real account out because D5
 * ships no lockout by design (see src/lib/auth.ts).
 *
 * The decision logic lives in `verify-rate-limit-core.ts` (importable and
 * unit-tested with an injected fetch/clock); this file is only the argv + env +
 * console + exit-code wiring, so importing the core never runs the script.
 *
 * Exit code 0 = a 429 was observed. Exit code 1 = it was not. A silent pass is
 * exactly the failure this script defends against, so "nothing happened" is an
 * error, never a success.
 *
 * DO NOT run this against production.
 */
import {
  formatReport,
  runVerification,
  type VerifyConfig,
} from "./verify-rate-limit-core.ts";

/** Local dev server default: this script is a pre-deploy/preview tool. */
const DEFAULT_BASE_URL = "http://localhost:3000";

/**
 * Defaults chosen to be MEANINGFUL rather than polite. A dozen requests against
 * one warm lambda proves nothing about a shared counter; the run has to be big
 * enough and sustained enough to spread across instances.
 */
const DEFAULT_REQUESTS = 150;
const DEFAULT_CONCURRENCY = 10;

/**
 * Never a real address. `.invalid` is reserved by RFC 2606 and can never be
 * registered, so this cannot collide with a real account anywhere.
 */
const PROBE_EMAIL = "rate-limit-probe@numisma.invalid";
const PROBE_PASSWORD = "wrong-password-on-purpose-do-not-fix";

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`expected a positive integer, got "${raw}"`);
  }
  return value;
}

async function main(): Promise<void> {
  const config: VerifyConfig = {
    baseUrl:
      flag("url") ?? process.env.AUTH_VERIFY_BASE_URL ?? DEFAULT_BASE_URL,
    requests: positiveInt(flag("requests"), DEFAULT_REQUESTS),
    concurrency: positiveInt(flag("concurrency"), DEFAULT_CONCURRENCY),
    email: PROBE_EMAIL,
    password: PROBE_PASSWORD,
  };

  console.log(
    `[auth:verify-limit] attacking ${config.baseUrl} with ${config.requests} ` +
      `sign-in attempts (concurrency ${config.concurrency}) using a fake email ` +
      `and a deliberately wrong password. Expecting HTTP 429.`,
  );

  const report = await runVerification(config, {
    fetch: globalThis.fetch,
    now: () => Date.now(),
  });

  console.log(formatReport(report, config));

  if (!report.passed) {
    throw new Error(
      `no HTTP 429 observed across ${report.totalRequests} attempts — ` +
        `the rate limit is not biting`,
    );
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(
      "[auth:verify-limit] failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  },
);
