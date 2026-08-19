import { defaultExclude, defineConfig } from "vitest/config";

import { gitignoredPathGlobs } from "./ops/testkit/gitignored-path-globs.ts";

// Test DISCOVERY is derived from what GIT IGNORES — deliberately, and it must
// stay derived. Do not "simplify" this into a literal list of directory names.
//
// Why: vitest's default excludes cover node_modules/dist/.git/.cache, but not
// `.claude/`, which this repo's execution model fills with ONE GIT WORKTREE PER
// LANE (`.claude/worktrees/<lane>`). Each worktree is a *different branch*.
// Without this, a repo-root `vitest run` collected every worktree's copy of the
// suite — measured at 312 files where the branch itself has 156 — so the merge
// gate (the full suite, run in the main checkout) was executing other lanes'
// unmerged work-in-progress and reporting the verdict as this branch's. One
// lane's broken WIP turns the gate red on an unrelated PR.
//
// A hardcoded `"**/.claude/**"` would close today's instance and none of the
// class: the next agent tool to land gets a line in `.gitignore`, not here. Git
// already knows the whole answer — nested `.gitignore` files, negations,
// anchored paths, `.git/info/exclude`, the global excludes file — so discovery
// ASKS IT rather than keeping a second copy in sync, or (as this config used to)
// re-implementing a slice of gitignore syntax by parsing the root file's text.
// This mirrors the gitignore-aware source walker that replaced the SKIPPED_DIRS
// denylist; both now ask the same question of the same tool.
//
// WHY THE EXCLUDE FORM AND NOT AN INCLUDE FORM. Deriving vitest's `include` from
// `git ls-files` instead would mean re-implementing vitest's default include
// pattern (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) as a hand-maintained filter — a
// new list of exactly the kind this lane retires, failing toward green when a
// `.spec.ts` silently stops being collected. The exclude form leaves vitest's own
// `include` authoritative and computes nothing but "what does git ignore".
//
// The machinery lives in `ops/testkit/gitignored-path-globs.ts`, with the
// entry→glob translation exposed as a pure function so it can be tested at all: a
// private function in a config file has no importer, and this is the one piece of
// discovery machinery that fails toward green — a widened glob deletes tests and
// the shortened suite still passes. `gitignored-path-globs.test.ts` pins the
// escaping with authored fixtures and asserts, with picomatch, that no test file
// git knows about is eaten.

export default defineConfig({
  test: {
    // `exclude` REPLACES vitest's defaults rather than merging with them, so
    // `defaultExclude` must be spread first — dropping it would start
    // collecting tests out of node_modules.
    exclude: [...defaultExclude, ...gitignoredPathGlobs()],

    // THE TEST BUDGET, STATED ONCE. Vitest's default is 5000 ms and this repo does
    // not fit in it. The tui and price-feed suites spawn REAL subprocesses (`tsx`,
    // the price-feed wrapper shell) and build REAL git repos in temp dirs, so a case
    // whose body costs ~75 ms alone costs 1.4-2.0 s under full-suite parallel load —
    // a 19-27x inflation that leaves roughly 2.4x of headroom against the default.
    //
    // THIS IS A DECLARED BUDGET, NOT A BUMP TO SILENCE A RED. 30_000 is the number
    // this repo had ALREADY converged on, eleven times over: ten test files each
    // carried their own `vi.setConfig({ testTimeout: 30_000 })` and CI passed
    // `--testTimeout=30000` on the command line. One budget, eleven statements of
    // it — and local runs got NONE of them for the price-feed suites, so a local
    // run was STRICTER than CI. That divergence is the bug: a loaded machine could
    // red locally on a case CI would never fail, which is a false red, and a false
    // red is chased. Stating it here makes the budget one fact, applies it to every
    // suite, and holds as the suite grows and on slower hardware.
    //
    // WHAT IT COSTS: a genuinely hung test now takes 30 s to fail instead of 5 s.
    // That is the trade CI has been making all along and it is the right one — a
    // hang is a bug that will be found regardless, a false red is one that burns a
    // session.
    //
    // WHAT IT DOES NOT DO: it cannot preempt a BLOCKING synchronous body.
    // `testTimeout` is a timer on the same thread, so a `spawnSync` that never
    // returns runs past any value set here. That is why the spawning tests pass
    // their own `timeout` to the spawn — see `apps/tui/src/migrate-legacy-log.test.ts`.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Measure the Node-runnable code only. The Bun-only openTUI wiring
      // (app.ts, mount-app.ts, smoke-openTui.ts, smoke-startup-openTui.ts) never
      // executes under Node's vitest run, so instrumenting it would only report
      // it as dead 0% and make the number dishonest. That path is guarded by the
      // openTUI smokes (`pnpm smoke:tui`, `pnpm smoke:startup`) instead. See
      // apps/tui/README.md for the split.
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        // Test-only shared fixtures/helpers extracted from split test files:
        // exercised by the tests that import them, not product code to measure.
        "**/*.fixtures.ts",
        // Test-only substrate/helpers (e.g. the throwaway-Postgres testkit that
        // slices #123/#127 share): exercised by the integration tests that
        // import them, not product code to measure. See docs/coverage-rationale.md.
        "**/*.testkit.ts",
        "**/*.d.ts",
        // Thin script entries: top-level orchestration over already-tested
        // functions, no unit to assert. See docs/coverage-rationale.md.
        "apps/tui/src/report.ts",
        "apps/tui/src/spine.ts",
        "apps/tui/src/spine-reset.ts",
        // Same category: the orders/migration CLI shells. Each is pure
        // dependency-injection wiring — it binds the real fs, the real data dir, the
        // real fold and a real readline prompt to a flow module that holds every
        // decision and every refusal. They are unmeasurable for a reason stronger
        // than thinness: IMPORTING THE SHELL RUNS THE ACT (top-level await / a
        // self-executing `main()`), so a test cannot load one to assert it without
        // performing a real import, a real fill, a real cancel, or a real in-place
        // rewrite of the durable log. That is precisely why the flow lives in its own
        // module — `record-fill-cli.ts` says so in its own header — and those modules
        // ARE measured. See docs/coverage-rationale.md §1.
        "apps/tui/src/import-orders-cli.ts",
        "apps/tui/src/record-fill-cli.ts",
        "apps/tui/src/cancel-order-cli.ts",
        "apps/tui/src/migrate-legacy-log.ts",
        // Thin price-feed CLI entry: top-level console/exit-code wiring over the
        // tested `runPriceFetch`, no unit to assert.
        "apps/price-feed/src/cli.ts",
        // Bun-only openTUI wiring: never executes under Node's vitest run, so
        // instrumenting it would only report dead 0%. Guarded by the openTUI
        // smokes (`pnpm smoke:tui`, `pnpm smoke:startup`).
        "apps/tui/src/app.ts",
        "apps/tui/src/mount-app.ts",
        "apps/tui/src/smoke-openTui.ts",
        "apps/tui/src/smoke-startup-openTui.ts",
        // apps/web coverage posture (PRD #121 / slice #122). The include glob is
        // `*.ts`, so the `.tsx` render components (SummaryCard, SectionTable, and the
        // ladder's FillPath + PriceDropPathChart) and
        // the route/router `.tsx` files are already outside instrumentation — a
        // deliberate decision, not an accident: they are RTL-shaped render surfaces,
        // not Node-unit-testable, and this increment does not add an RTL toolchain
        // (see docs/coverage-rationale.md). What remains excluded below is the
        // apps/web `.ts` dead weight — framework wiring, a generated file, and a
        // self-executing script — that would otherwise report dishonest 0%.
        // `contract.ts` IS measured (contract.test.ts); `lib/dashboard.ts` stays
        // measured too — it is real, reachable behavior tested in slice #124, not
        // dead weight. `push/push-core.ts` (the pure derivation + real upsert
        // extracted from the script) is measured too (slice #127) — only the thin
        // self-exec `push.ts` wrapper stays excluded. See docs/coverage-rationale.md §6.
        "apps/web/src/routeTree.gen.ts",
        "apps/web/src/lib/auth.ts",
        "apps/web/src/lib/auth-client.ts",
        "apps/web/src/lib/query.ts",
        "apps/web/src/routes/api/auth/$.ts",
        "apps/web/src/push/push.ts",
        // Same category as push.ts: the self-exec `backfill` shell is argv +
        // credential + console + exit-code wiring over `backfill-core.ts`, which
        // IS measured (backfill-core.test.ts drives the whole loop with no DB).
        "apps/web/src/push/backfill.ts",
        // Same category again: the gap-report shell is argv + console + exit-code
        // wiring over `gap-report-core.ts`, which IS measured — its argument
        // validation, window bound and exit contract are unit-tested with an
        // injected clock and a throwaway store, no database and no environment.
        "apps/web/src/push/gap-report.ts",
        // Self-executing provisioning/auth CLI scripts (same category as
        // push.ts): top-level main().then(..., process.exit) over the tested
        // provision.ts builders / vendored SQL. No unit to assert as written;
        // provision.ts's pure builders ARE measured (provision.test.ts) and the
        // DB-applying provisionProjection() is exercised by the gated
        // integration test. See docs/coverage-rationale.md §6.
        "apps/web/src/projection/provision-projection.ts",
        "apps/web/src/auth/apply-auth-schema.ts",
        // Self-executing single-tenant seed CLI (slice #125): top-level
        // main().then(..., process.exit) that writes the ONE account through
        // Better Auth's internal adapter. Same category as apply-auth-schema.ts
        // — no unit to assert as written; the single-tenant invariant it serves
        // (server-side signup disabled) IS tested (lib/single-tenant.test.ts).
        "apps/web/src/auth/seed-account.ts",
        // Self-executing rate-limit attack script (D5/D10): argv + env +
        // console + exit-code wiring over the tested `verify-rate-limit-core.ts`
        // (which IS measured — its decision logic is the thing that matters and
        // is unit-tested with an injected fetch/clock, no network).
        "apps/web/src/auth/verify-rate-limit.ts",
      ],
    },
  },
});
