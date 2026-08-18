import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defaultExclude, defineConfig } from "vitest/config";

// Test DISCOVERY is derived from `.gitignore` — deliberately, and it must stay
// derived. Do not "simplify" this into a literal list of directory names.
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
// class: the next agent tool to land gets a line in `.gitignore`, not here.
// `.gitignore` is already the single list of "paths that are not this repo's
// source" (`.agents/ .claude/ .codex/ .cursor/ .opencode/ node_modules/ ...`),
// so discovery reads it instead of keeping a second copy in sync. This mirrors
// the gitignore-aware source walker that replaced the SKIPPED_DIRS denylist.
//
// The parser is deliberately narrow: comments, blanks, and the trailing-slash
// DIRECTORY form only. Negations (`!`), anchored paths, globs and bare entries
// (which may name a file, e.g. `.vercel`) are AMBIGUOUS here, so they are
// SKIPPED rather than mistranslated. Over-excluding would silently delete real
// tests from the suite — a worse outcome than the bug this fixes — while
// under-excluding merely leaves vitest's own defaults doing their job.
function gitignoredDirGlobs(): string[] {
  const gitignore = fileURLToPath(new URL(".gitignore", import.meta.url));
  return readFileSync(gitignore, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    // Trailing-slash directory form only; anything else is skipped (see above).
    .filter((line) => line.endsWith("/"))
    .filter((line) => !/[!*?[\]/]/.test(line.slice(0, -1)))
    .map((line) => `**/${line}**`);
}

export default defineConfig({
  test: {
    // `exclude` REPLACES vitest's defaults rather than merging with them, so
    // `defaultExclude` must be spread first — dropping it would start
    // collecting tests out of node_modules.
    exclude: [...defaultExclude, ...gitignoredDirGlobs()],
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
