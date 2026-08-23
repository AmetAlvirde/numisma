import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * THE WORKBENCH'S VITE CONFIG — react-cosmos picks this up by convention
 * (`react-cosmos-plugin-vite` resolves `./vite.config.ts` under the Cosmos root
 * dir) and layers its own renderer plugin on top.
 *
 * TWO PLUGINS, AND NO SSR. That absence is the whole point of the second
 * consumer: no TanStack Start, no Nitro, no router. A class that renders here
 * and fails in `apps/web` isolates the fault to the client/SSR split, and the
 * inference only holds while this file stays this short.
 *
 * NOTHING IS NEEDED TO CONSUME `@numisma/components`. It ships unbuilt TSX with
 * `exports` at `src/`, and the pnpm workspace symlink makes Vite classify it as
 * a LINKED dependency — which is what gets its source transformed and scanned
 * with no `optimizeDeps` entry, no `resolve.alias` and no `ssr.noExternal`.
 * `resolve.preserveSymlinks` stays at its default `false`; that default is what
 * makes the classification happen at all, so turning it on would break the
 * mount rather than harden it.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
