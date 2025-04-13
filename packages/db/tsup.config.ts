import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/prisma.ts"],
  format: ["esm", "cjs"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Skip type checking to workaround type issues temporarily
  // Remove this line once the type issues are resolved
  noExternal: ["@numisma/types"],
});
