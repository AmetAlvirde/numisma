import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Measure the Node-runnable code only. The Bun-only openTUI wiring
      // (app.ts, mount-app.ts, smoke-openTui.ts) never executes under Node's
      // vitest run, so instrumenting it would only report it as dead 0% and
      // make the number dishonest. That path is guarded by the keypress smoke
      // (`pnpm smoke:tui`) instead. See packages/tui/README.md for the split.
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "packages/tui/src/app.ts",
        "packages/tui/src/mount-app.ts",
        "packages/tui/src/smoke-openTui.ts",
      ],
    },
  },
});
