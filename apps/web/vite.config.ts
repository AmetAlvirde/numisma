import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

// Vercel deployment target is configured HERE via the Nitro Vite plugin's
// `preset: "vercel"`, per the current TanStack Start + Vercel docs. On
// `vite build` this emits a Vercel Build Output artifact so a later `vercel`
// deploy works with zero extra config. We do NOT deploy from this repo — this
// only sets the build target. `vite dev` runs the normal dev server.
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
