import { defineConfig } from "tsup";
import { version } from "./package.json";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "@numisma/types"],
  esbuildOptions(options) {
    options.banner = {
      js: `// @numisma/ui - v${version}`,
    };
  },
});
