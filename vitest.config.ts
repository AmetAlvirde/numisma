import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
        // `*.ts`, so the `.tsx` render components (SummaryCard, SectionTable) and
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
      ],
    },
  },
});
