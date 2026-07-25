import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

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
    tanstackStart(),
    nitro({ preset: "vercel" }),
    viteReact(),
  ],
});
