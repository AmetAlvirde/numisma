import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vercel deployment target is configured HERE via the Nitro Vite plugin's
// `preset: "vercel"`, per the current TanStack Start + Vercel docs. On
// `vite build` this emits a Vercel Build Output artifact (Build Output API v3)
// at `apps/web/.vercel/output`. `vite dev` runs the normal dev server.
//
// THIS REPO DOES DEPLOY (changed 2026-07-25; the previous comment here said it
// did not). The Vercel project `numisma-web` is connected to
// `AmetAlvirde/numisma` with Root Directory `apps/web` and production branch
// `main`, so **every merge to `main` ships production** and every branch push
// builds a preview. That build runs THIS file on Vercel's builders — so this
// preset is now load-bearing at deploy time, not only for the local artifact.
// Preview environment variables are deliberately EMPTY: previews are
// build/compile smoke checks. A preview's shell still renders and returns 200 —
// routes needing the DB redirect and sign-in cannot complete — so judge a
// preview by the BUILD, not by using the app. See `docs/web-deploy-runbook.md`,
// which also keeps the `vercel deploy --prebuilt` CLI path as the documented
// fallback.
export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    // Two source-scan tests live in `src/routes/` because they read the route
    // files from beside them: `route-move.test.ts` and
    // `snapshot-guard-wiring.test.ts`. The generator scans that directory, finds
    // no `Route` export in either, and warns on every dev start. It was already
    // skipping them, which is correct — this states it, so the skip is a
    // decision instead of two warnings the operator learns to read past. Vitest
    // discovery is unaffected: that is `vitest.config.ts`'s derived `exclude`,
    // and nothing here touches it.
    tanstackStart({ router: { routeFileIgnorePattern: "\\.test\\.tsx?$" } }),
    nitro({ preset: "vercel" }),
    viteReact(),

    // Tailwind 4's VITE-NATIVE path, not PostCSS. It compiles
    // `src/tailwind.css` — the entry, and the only file that mounts Tailwind;
    // `src/styles.css` is hand-written and Tailwind never touches it.
    //
    // PLUGIN ORDER IS NOT CONSTRAINED here, and the position is not a finding:
    // TanStack's docs and Tailwind's docs publish OPPOSITE orders and both
    // build. Do not move this line to fix an unrelated problem.
    //
    // NOTHING ELSE IS NEEDED TO CONSUME `@numisma/components`. The package ships
    // unbuilt TSX with `exports` at `src/`, and the pnpm workspace symlink makes
    // Vite classify it as a LINKED dependency, which is what gets its source
    // transformed and scanned with no `optimizeDeps` entry, no `resolve.alias`
    // and no `ssr.noExternal`. `resolve.preserveSymlinks` stays at its default
    // `false` — that default is what makes the classification happen at all, so
    // turning it on would break the mount rather than harden it.
    tailwindcss(),
  ],
});
