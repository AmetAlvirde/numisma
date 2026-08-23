# react-cosmos as the workbench, standalone, over generalizing the DEV fixture route

_Made during: spec #412, the component package and its workbench, slice #418.
Required in writing by that spec's §8, and ruled by the human in its §10 Q2/Q3.
It supersedes the standing recommendation carried by the component-layer map,
which was to generalize the DEV fixture route this repo already had._
_Scope: product_
_Status: accepted_

## The decision

`apps/workbench` is a **standalone react-cosmos app**: its own Vite build, its
own Tailwind entry, no TanStack Start, no router, **no SSR**. `react-cosmos`
7.4.0 and `react-cosmos-plugin-vite` 7.4.0, served at port 5100 by
`pnpm --filter @numisma/workbench dev`.

It sees **package components only**. One `*.fixture.tsx` per exported component,
with `fixture-coverage.test.ts` demanding one rather than trusting inspection. A
global decorator gives three theme modes: **grayscale** (the package's own
defaults, the mode a fixture opens in), **themed** (every declared token a
distinct value), and **app** (`apps/web`'s values, carried as data).

The contract that makes it an instrument: **it imports no module from
`apps/web`.** `seam-isolation.test.ts` holds that in both directions, and
`app-token-drift.test.ts` reads `styles.css` off disk on every run so the copied
values cannot drift.

## Why not generalize `/ladder-fixture/$state`

The repo already had a working fixture-route pattern, and it works well for what
it does: `apps/web/src/routes/ladder-fixture.$state.tsx` renders the real
fill-path cards from synthesized ladders, DEV-gated, with the fixtures reached by
dynamic import inside the gate so dead-code elimination removes them from the
production bundle entirely. Generalizing it was the standing recommendation, and
it was the cheaper move.

**A second consumer with no SSR is the thing that route cannot be.** Its value is
diagnostic separation: a class that renders in the workbench and fails in
`apps/web` isolates the fault to the client/SSR split, and a Tailwind migration
of 1,396 hand-written lines will want that on hand. A fixture route inside
`apps/web` shares the app's build, its SSR pass, its router and its stylesheet
order, so a failure there is a failure of one composite thing with no way to say
which half.

The second reason is enumeration. A fixture route gives one state per URL, hand
routed. Cosmos reads the fixture tree and gives every state of every component a
place, with the mode switcher orthogonal to it, which is what makes "a token
nothing repaints" a thing a human can actually see.

The argument is **not** that it is cheap. In the spike the mechanical cost was
four files and about two minutes, of which the config that mattered was two
lines. The real cost arrived afterwards, and it is the next section.

## The pnpm patch, which is a real cost of this decision

**react-cosmos 7.4.0 cannot serve its own UI bundle under pnpm.** Its dev server
calls express 5's `res.sendFile` with no options, and send@1 defaults
`dotfiles: "ignore"`, so any path containing a dot-directory answers 404. Under
pnpm every real dependency path runs through `node_modules/.pnpm/`, so
react-cosmos's own playground bundle is unreachable. The only symptom is a blank
page with `mountPlayground is not defined` in the console. Nothing says 404,
nothing says pnpm, and nothing points at dotfiles.

It is fixed by `patches/react-cosmos@7.4.0.patch`, which passes
`{ dotfiles: "allow" }` on the three routes that serve react-cosmos's own files
(`/playground.bundle.js`, its source map, and `/_cosmos.ico`). The patch is wired
through `patchedDependencies` in `pnpm-workspace.yaml`.

The rejected alternative was `virtualStoreDir`, pointing pnpm's store somewhere
without a leading dot. It works, and it costs a full relink of the repo for every
developer and every CI run to fix a bug in one dev dependency's dev server.

**On a react-cosmos bump the patch must be re-cut.** `pnpm install` fails loudly
if it stops applying, which is the one part of this that is not silent.

## Considered options

- **A standalone react-cosmos app (chosen).** A new dependency, a second app, and
  a pnpm patch to maintain, bought for enumerable states and a no-SSR consumer
  that isolates client/SSR faults.
- **Generalizing `/ladder-fixture/$state` (rejected).** Cheaper, no new
  dependency, no patch. It cannot be a second consumer, because it is the first
  consumer, and every fault it reports is a fault of the app's whole build.
- **A second cosmos config over `apps/web` (rejected).** It would have given the
  fixture tree without a second app, and it would have muddied the SSR-free
  separation that is the entire justification for having one.
- **`virtualStoreDir` instead of the patch (rejected).** Works, and makes every
  developer and every CI run pay a full relink for one dev dependency's dev
  server.

## Consequences

- **Fixture files are the hard-to-reverse part, not the dependency.** Cosmos is
  one `devDependency` in one app. The fixtures are per-component prose written to
  be read against the source, and they accumulate as the package does.
- **The workbench carries the app's token values as a copy.** That is deliberate:
  tokens are data and cross the seam, the app's CSS is a cascade with linked
  stylesheets and a `layer()` asymmetry in it and does not. The copy is held
  honest by `app-token-drift.test.ts`, which walks the app's alias chain to reach
  literals rather than comparing alias text that would keep matching while the
  palette moved underneath it.
- **App mode carries fourteen names where the package declares twelve.**
  `--nms-card` and `--nms-muted-foreground` are in `styles.css` and nothing in the
  package reads them yet. The drift test mirrors the app's block name-for-name,
  so those two are held honest from today rather than from the day a component
  starts reading them.
- **The theme decorator writes to `document.documentElement` and that placement
  is load-bearing.** A custom property's `var()`s are substituted where the
  property is declared, so a wrapper div redefining `--nms-primary` moves the bare
  reads and leaves every Tailwind theme utility on the `:root` value. Half the
  tokens switch, half do not, and nothing on screen says which half.
- **The workbench joins the workspace typecheck and no other CI gate.** It is
  excluded from the `apps/web` production build and adds nothing to its bundle,
  asserted by `seam-isolation.test.ts`.
- **The three modes cover what CI cannot, and only if a human runs them.**
  jsdom will not resolve `color-mix` through a cascade, so the focus ring and
  every "did this role repaint" question are manual procedure, written up in
  `docs/component-package.md` §5. Playwright is deferred to its own increment on
  purpose rather than bought as a side effect of a package increment.

### The three SDP tests

- **Hard to reverse**, once fixture files spread across the package. The
  dependency comes out in an afternoon; the fixtures are the asset and they are
  written in Cosmos's shape.
- **Surprising**, because the repo already has a working fixture-route pattern at
  `/ladder-fixture/$state` with its own reasoning written into its header, and
  the standing recommendation was to generalize it. A reader who meets that route
  first needs to know which decision replaced the recommendation and why the
  route itself stays.
- **A real trade-off.** A new dependency, a second app and a maintained pnpm
  patch, against enumerable states and a no-SSR consumer that isolates
  client/SSR faults.
