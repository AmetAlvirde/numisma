import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/prisma.ts"],
  format: ["esm", "cjs"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
});
