# TanStack Start over Next.js for the web access surface

_Made during: MVI — web-app tracer prototype→reliable conversion (branch `feature/web-app-tracer`, commit a41e486); ratified at PRD synthesis 2026-07-07, backed by two-phase prototype evidence (built + deployed live to Vercel/Neon, phone-verified)._
_Scope: product_
_Status: accepted (amended 2026-07-25 — see "Amendment: git-push deploy, reversing the prebuilt-only regime" below)_

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
- **Deploy reality: prebuilt CLI, not git-push CI/CD.** **⚠ REVERSED 2026-07-25 —
  see the amendment below. The repo now deploys from git: merges to `main` ship
  production. The prebuilt CLI path is retained as the documented fallback.** The
  original text, for the record: "Deployable on Vercel" turned
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

## Amendment: git-push deploy, reversing the prebuilt-only regime

_Amended 2026-07-25. Unlike the ADR-011 amendment — which corrected mechanisms
without reversing any decision — **this one reverses a recorded decision.** The
framework choice (TanStack Start over Next.js) is untouched and still stands.
What is reversed is the "Deploy reality" consequence: the deliberate absence of a
Vercel Git integration, and the deferral of push-to-deploy automation._

**What changed, concretely.** The Vercel project `numisma-web`
(`prj_fnEbtoHmuXbevg6twcNhV7XPvbfF`, org `team_tul6wDdH2XbZJFV65cTMo6of`) was
connected to `AmetAlvirde/numisma`; Root Directory moved from `.` to `apps/web`;
the production branch is `main`. Consequences: **every merge to `main`
auto-deploys production**, and every branch push builds a preview. Framework
preset Nitro, Node 24.x, Output Directory None — the build runs
`apps/web/vite.config.ts`'s `nitro({ preset: "vercel" })` on Vercel's builders
rather than only locally.

**The blocker that justified prebuilt-only was misattributed, and is now
falsified for the git path.** The original consequence recorded a real limit — a
plain CLI `vercel deploy` uploads only the linked directory (`apps/web/`) and so
cannot resolve this monorepo's `workspace:*` dependencies, which is why
`--prebuilt` was the path that worked. That was read at the time as "remote
builds can't do monorepos here." It is narrower than that: it is a property of
the **CLI source upload**, which has no workspace root. A **git** build clones
the whole repo, including the root `pnpm-workspace.yaml`, and pnpm installs from
the workspace root.

**Verified, not assumed** (deployment `dpl_BSahSvPJoEwRHfLuUBRFWDQzc7Nm`, state
`READY`, 2026-07-25): the build log shows `Scope: all 6 workspace projects`,
`+ @numisma/engine 0.7.3 <- ../../packages/engine`,
`+ @numisma/event-store 0.7.3 <- ../../packages/event-store`,
`Done in 5.8s using pnpm v11.1.2`, and `Build Completed in /vercel/output [23s]`.
`pnpm@11.1.2` installs with no corepack flag. **Any doc still asserting "a remote
build cannot resolve `workspace:*`" as a standing limitation is wrong** — the
claim is CLI-upload-specific.

Auto-deploying production from `main` was accepted knowingly, on ADR-007 §8.2
grounds: the projection DB is separate and re-pushable, so a bad production
deploy costs a revert, not data.

**Preview deployments carry no environment variables, deliberately.** They are
build/compile smoke checks only — **judge a preview by whether the build
succeeded, not by exercising the app**. Measured behavior with empty Preview env:
`/`, `/login`, `/dashboard` return **200** (the shell renders); routes needing
the database (`/api/auth/get-session`, `/api/auth/session`, `/api/health`)
**redirect (302)**. There are no 500s — unauthenticated traffic is redirected
before anything touches the DB, and sign-in cannot complete because logging in is
itself what needs `AUTH_DATABASE_URL`. A preview that looks healthy is therefore
not evidence the app works; that is designed, not an incident. This tightens
rather than loosens ADR-011 D2's "app secrets scoped Production-only, verified
unresolvable on Preview": on Preview there is now nothing to resolve. Making
previews actually run is a **parked want** with two named blockers
(`AUTH_DATABASE_URL` is an RW credential, and exposing it to every preview build
is the objection; `BETTER_AUTH_URL` is a fixed origin that cannot match a
per-deployment preview URL without deriving it from `VERCEL_URL` at runtime),
recorded in `docs/web-deploy-runbook.md`. It is not designed and not scheduled.

_(**The per-route results above were not measured against this app.** There has
never been a `/dashboard` or an `/api/health` here, so whatever produced that
table was not this router. Treat the route-by-route numbers as withdrawn rather
than stale. What survives is the claim the paragraph exists to make, that an
empty Preview env makes a preview a build check and not a working app, and that
claim rests on the environment configuration rather than on this table. Read the
route list from `apps/web/src/routeTree.gen.ts` and current preview behavior
from `docs/web-deploy-runbook.md`. Two routes have landed since, `/ladder/$planId`
and the dev-only `/ladder-fixture/$state`.)_

**What did not change.** The prebuilt CLI path is **kept, not deleted**, as the
documented fallback for when the builder path breaks — it remains fully usable
instructions in `docs/web-deploy-runbook.md`. Its **invocation did change with
the Root Directory move**: the fallback now runs from the repo root
(`vercel pull` → `vercel build` → `vercel deploy --prebuilt`), because the CLI
resolves Root Directory relative to the invocation directory and the old
`cd apps/web` form now composes `apps/web/apps/web` and fails. `.github/workflows/ci.yml` also
stays: it builds against a **real Postgres** and runs invariant tests Vercel's
preview build never will, so CI remains the DB-backed gate and Vercel's preview
is only the compile check.

**Known wrinkle, recorded not fixed.** Every git build warns that
`pnpm-lock.yaml` is version 9, generated by pnpm@10.x, against
`package.json#packageManager` `pnpm@11.1.2`. The install succeeds today; it
becomes a failure the day a frozen-lockfile install is enforced.

**Superseded by this amendment:** PRD #121's out-of-scope D2 ("automated CI/CD
deferred") and `apps/web/vite.config.ts`'s "We do NOT deploy from this repo"
comment, both of which have been corrected in place.
