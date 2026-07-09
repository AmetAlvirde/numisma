# TanStack Start over Next.js for the web access surface

_Made during: MVI — web-app tracer prototype→reliable conversion (branch `feature/web-app-tracer`, commit a41e486); ratified at PRD synthesis 2026-07-07, backed by two-phase prototype evidence (built + deployed live to Vercel/Neon, phone-verified)._
_Scope: product_
_Status: accepted_

The web leg — ADR-007's hosted read-projection — needs a **full-stack React framework** as `apps/web`, deployable to Vercel, that can read the projection **server-side behind auth** so the read-only DB credential never reaches the browser (an ADR-007 requirement, structurally, not by convention). Next.js-on-Vercel is the obvious default and the most-trodden path. This ADR takes the **other door**: the access surface is built on **TanStack Start** (Vite-based full-stack React) with **TanStack Router + Query** and **TanStack Table** for the composition dashboard. SSR / server functions (`createServerFn`) fetch from the projection DB server-side; the read-only cred and `pg` stay server-only; deploy is via TanStack Start's Nitro `preset: "vercel"` target. The trade-off — recognition vs. read-first fit — was logged consciously in the tracer grill and flagged for ratification in both the grill and the prototype AAR; it is ratified here now that the prototype has **built, deployed live, and rendered on a phone**.

## Considered Options

- **TanStack Start (chosen).** Best fit for a **read-first data dashboard**: Router,
  Query, and Table are first-class, so the composition surface is composed from the
  framework's own primitives rather than bolted on. Its `createServerFn` model cleanly
  enforces the ADR-007 **no-creds-in-client** boundary — server logic compiles into a
  server handler plus a client **RPC stub**, so `pg`, the projection creds, and
  node-only imports never enter the browser bundle. It is also a **distinctive** (not
  weak) portfolio signal for a web-architect audience: the interesting-architecture
  read, not the résumé-keyword read. Cost paid deliberately: a **newer, less-trodden**
  Vercel deploy target than Next, and a smaller ecosystem to borrow from.
- **Next.js on Vercel (rejected — the default not taken).** Higher résumé/name
  recognition and the single most-trodden Vercel path (git-push CI/CD, the canonical
  App-Router+Server-Actions story). Rejected on fit, not capability: it is a **heavier
  frame for a read-first dashboard** and adds **no distinctive portfolio signal** — it
  is what everyone reaches for, so choosing it says nothing. The recognition-vs-fit
  trade was made with eyes open. Note the residual: **framework-agnostic** Vercel
  skills (bootstrap, env, marketplace, prebuilt deploy) still apply and are reused;
  only Next-**specific** tooling is forgone.

## Consequences

- **The framework is load-bearing, not a thin wrapper.** The whole app is built on
  TanStack Start's server-function + routing model; in practice this is **not** a
  freely-swappable shell around the engine. Choosing it is choosing the shape of the
  access surface.
- **Server functions are the ADR-007 enforcement seam.** `createServerFn` strips `pg`,
  the projection creds, and node-only imports out of the client bundle by compiling the
  server body into a server handler and leaving the client an RPC stub. This is
  **proven, not asserted**: a production build's client chunks contained **none** of
  `pg` / `new Pool` / `node:os` / `PROJECTION_DATABASE_URL` / `AUTH_DATABASE_URL` /
  `BETTER_AUTH_SECRET` / `composition_snapshot` — every one of them appeared **only**
  in the server-function bundle. The ADR-007 "read-only cred never reaches the browser"
  guardrail is thereby a build-time fact, not a coding discipline.
- **Known framework pitfall (durable lesson).** A barrel package that **eagerly
  re-exports a node-only module** (`node:os` / `node:path`) crashes the **client**
  bundle even for a purely-computational import, because Vite's browser-externalization
  throws when it binds the named import (dev has no tree-shaking to save you).
  Mitigation adopted: give browser consumers a dedicated **pure subpath export** —
  this is why `@numisma/engine/format` exists, and why the web imports `formatUsd` /
  `formatSignedPercent` / `formatPercent` from `@numisma/engine/format`, **not** the
  barrel. Companion rule: files matching `**/*.server.*` trigger strict
  client-import protection, so a server-function module a route imports must **not**
  carry a `.server` infix.
- **Deploy reality: prebuilt CLI, not git-push CI/CD.** "Deployable on Vercel" turned
  out to mean the **prebuilt runbook** — `pnpm --filter @numisma/web build` → Nitro
  emits `.vercel/output` → `vercel deploy --prebuilt --prod` — not push-to-deploy
  automation. Automated CI/CD is a **separate, explicitly-deferred** increment; the
  reliable increment **documents the prebuilt runbook** rather than automating it, so
  the deferral is honest and the manual path is reproducible.
- **Reversibility is moderate.** The DB is a disposable, re-projectable projection
  (ADR-007) and the render layer is thin, but the routing/server-function model
  **pervades** the app. A framework swap is a real **rewrite of the access surface**,
  not a config change — cheaper than moving a system of record, dearer than swapping a
  view.

### The three SDP tests

- **Hard to reverse.** The entire access surface is built on TanStack Start's
  server-function/routing model; swapping frameworks is a rewrite of `apps/web`, not an
  edit. The DB behind it is disposable, but the surface on top of it is not.
- **Surprising without context.** Next.js-on-Vercel is the obvious default for a React
  app on Vercel; choosing the **newer, less-trodden** TanStack Start is not guessable
  from the outside — the code shows a Vercel deploy, which reads as "Next" until you
  look.
- **A real trade-off.** Résumé/name recognition and the most-trodden deploy path
  (Next) vs. read-first-dashboard fit, a distinctive portfolio signal, and a clean
  `createServerFn` enforcement seam for the ADR-007 no-creds-in-client boundary
  (TanStack Start). Decided on fit and enforcement, with recognition paid as the price.
