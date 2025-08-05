import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { storybookTest } from "@storybook/experimental-addon-test/vitest-plugin";

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/writing-tests/test-addon
export default defineConfig({
  test: {
    workspace: [
      // Storybook tests
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/writing-tests/test-addon#storybooktest
          storybookTest({ configDir: path.join(dirname, ".storybook") }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            name: "chromium",
            provider: "playwright",
          },
          setupFiles: [".storybook/vitest.setup.ts"],
        },
      },
      // Unit/Integration tests
      {
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./src/test-setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/**/*.stories.{ts,tsx}"],
        },
        resolve: {
          alias: {
            "@": path.resolve(dirname, "./src"),
          },
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});
