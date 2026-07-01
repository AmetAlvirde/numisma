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
      // packages/tui/README.md for the split.
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        // Test-only shared fixtures/helpers extracted from split test files:
        // exercised by the tests that import them, not product code to measure.
        "**/*.fixtures.ts",
        "**/*.d.ts",
        // Thin script entries: top-level orchestration over already-tested
        // functions, no unit to assert. See docs/coverage-rationale.md.
        "packages/tui/src/report.ts",
        "packages/tui/src/spine.ts",
        "packages/tui/src/spine-reset.ts",
        // Bun-only openTUI wiring: never executes under Node's vitest run, so
        // instrumenting it would only report dead 0%. Guarded by the openTUI
        // smokes (`pnpm smoke:tui`, `pnpm smoke:startup`).
        "packages/tui/src/app.ts",
        "packages/tui/src/mount-app.ts",
        "packages/tui/src/smoke-openTui.ts",
        "packages/tui/src/smoke-startup-openTui.ts",
      ],
    },
  },
});
