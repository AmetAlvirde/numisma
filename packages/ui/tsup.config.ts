import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.stories.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
  ],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom"],
  esbuildOptions(options) {
    options.jsx = "automatic";
    return options;
  },
  treeshake: true,
  minify: true,
  outDir: "dist",
  onSuccess: "tsc --emitDeclarationOnly --declaration",
  noExternal: ["@numisma/types"],
});
