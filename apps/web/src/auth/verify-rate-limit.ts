/**
 * Verify the D5 rate limit BY ATTACK, not by inspection (D10).
 *
 *   pnpm --filter @numisma/web auth:verify-limit
 *   pnpm --filter @numisma/web auth:verify-limit -- --url https://<deployed-url>
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
 * RUNNING THIS AGAINST PRODUCTION IS CORRECT — it is runbook step 7, and it is
 * the only run that proves anything. This header used to say "DO NOT run this
 * against production", written when the script was a local pre-deploy tool. D10
 * then made deployed verification mandatory and the warning never caught up,
 * leaving the tool forbidding exactly what the runbook mandates. It also
 * contradicted `formatReport`'s own output, which tells the operator that only a
 * deployed multi-instance run shows whether the counter is shared.
 *
 * WHAT A PRODUCTION RUN ACTUALLY COSTS, so the decision is made on facts:
 * Better Auth keys the limit as `${ip}|${path}` (`createRateLimitKey` in
 * @better-auth/core), and `customRules` REPLACES the global rule rather than
 * stacking with it. So one run consumes exactly one bucket — `<your-ip>|
 * /sign-in/email`, at window 300 / max 10 — and the cost is that NEW SIGN-INS
 * from the running machine's IP get 429 for up to five minutes. Nothing else is
 * touched: `/get-session` is a separate key, so an existing session (and the
 * phone view) keeps working straight through the run; `/change-password` is a
 * separate key, so the runbook's rotation step is unaffected; and the fake
 * `.invalid` probe address cannot collide with the real account, which has no
 * lockout to trigger in the first place (D5).
 *
 * PREFER A SECONDARY IP — a phone hotspot or tether. The self-limit then lands
 * on a bucket the cutover is not using, and the only real cost above disappears.
 *
 * NOT A PREVIEW DEPLOYMENT, despite previews being the intuitive "safe" target.
 * ADR-011 D2 puts Deployment Protection on previews and scopes the four app
 * secrets Production-only, "verified unresolvable on Preview" — `AUTH_DATABASE_URL`
 * among them. Since 2026-07-25 the Preview environment holds NO variables at all
 * (git-push deploys, ADR-009 amendment): previews are build smoke checks. The
 * shell still renders and returns 200 while DB-dependent routes REDIRECT and
 * sign-in cannot complete — designed, not broken, and it means a preview looks
 * healthier than it is. A preview therefore cannot reach
 * `numisma_auth` — now by construction, not only by scoping — so the DB-backed
 * counter this script exists to prove has no table to live in, and the protection
 * layer answers 401 before the request reaches Better Auth at all. Both failures
 * surface here as a plain non-429, indistinguishable from a genuinely dead
 * limiter — a FALSE FAIL that reads exactly like a true one. Preview is not the
 * cautious choice; it is the misleading one.
 */
import {
  formatReport,
  runVerification,
  type VerifyConfig,
} from "./verify-rate-limit-core.ts";

/**
 * Local dev server default — a convenience for a smoke run while iterating, NOT
 * the intended target. A localhost PASS proves the limit is enabled and biting
 * and proves nothing about the counter being shared across instances; pass
 * `--url` to verify for real. `formatReport` prints that caveat on every run.
 */
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
