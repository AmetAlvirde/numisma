# A render-test harness for the web component layer, attached per file

_Made during: spec #403 slice 1 (#404), the component layer's structural pass.
Required in writing by
[ADR-019](./ADR-019-the-chart-is-presentation-its-accessible-substitute-is-generated.md):
"If the deferred harness question is ever answered yes, that is its own ADR… it
must not arrive as a side effect of 'add a test for the chart.'" The deferral it
answers is the 2026-08-12 audit's D1; the trigger it fires is
`docs/coverage-rationale.md` §6's own exit clause._
_Scope: product_
_Status: accepted_

## The decision

`apps/web` gets a render-test toolchain: **`jsdom`** in the repo root's
`devDependencies`, **`@testing-library/react`** and
**`@testing-library/user-event`** in `apps/web`'s. **jsdom attaches per file**,
through a `// @vitest-environment jsdom` docblock at the top of each render
test — the root `vitest.config.ts` gains no `environment` key, no `projects`
entry and no `setupFiles`. One module, `apps/web/src/render.testkit.tsx`, owns
RTL: the render entry point, the re-exports, `afterEach(cleanup)`, and the
browser globals jsdom does not implement. RTL is imported there and nowhere
else. A source scan, `apps/web/src/jsdom-docblock-guard.test.ts`, asserts that
every `*.test.tsx` under `apps/web/src` opens with the docblock.

**Where each dependency lives is forced, not stylistic.** Vitest resolves the
environment from the project root, which under this repo's single root config is
the repo root, and pnpm's strict layout does not make `apps/web/node_modules`
visible from there — so `jsdom` is a root dev dependency. RTL and `user-event`
are imported by files under `apps/web`, so they are that package's.

**What was measured rather than assumed.** `@vitejs/plugin-react` is **not** part
of the buy. On `main` at `ce456d3` a throwaway `.tsx` test was collected and run
by the unmodified root config with no plugin, because vitest's esbuild honours
`apps/web/tsconfig.json`'s `"jsx": "react-jsx"`. The plugin stays where it is, in
`apps/web/vite.config.ts`, for the dev server and the build. There is also no
`@testing-library/jest-dom`: the assertions read attributes and
`document.activeElement` directly, and the flip trigger is stated rather than
implied — if the a11y assertions start reading worse than they assert, buy it.

## What the harness is spent on, and what it is not

**Spent on:** the chart's accessibility invariant (the audit's T7, ADR-019's, now
`components/fill-path-chart-a11y.test.tsx`), and the seams spec #403's later
slices move — the `Absent` contract, the card primitives' heading levels, and the
rung list's keyboard walk, which is why `user-event` is bought here rather than
later. A Tab walk is the only honest way to assert a list whose rows select on
focus, and `fireEvent` cannot perform one.

**Not spent on:** snapshots — none, ever; this harness asserts named contracts,
and a snapshot asserts that nothing changed, which is the opposite instrument for
a layer about to be restructured three times. No coverage quota, and **`.tsx`
stays outside the coverage `include` glob**. Pinning a seam and measuring lines
are different purchases, and the coverage rationale's D5 declined the quota
explicitly. Nothing in `vitest.config.ts`'s `coverage` block changed.

## Why jsdom attaches per file

The alternative was a vitest `projects` split, and it was rejected on three
counts.

**The root config states two things exactly once, deliberately.** The
gitignore-derived `exclude` and the 30-second `testTimeout` each carry a long
comment saying that a second copy is the failure mode. Vitest 3 project entries
do not inherit the root `test` block, so a split either restates both into two
projects or hoists them into a shared constant both spread. Either way discovery
gains a second place to drift, in the one file whose header forbids exactly that.

**The failure directions are not symmetric.** A projects split fails toward
green: a render test whose path matches neither project's `include` is silently
not collected, and the shortened suite still reports success. That is the failure
mode `ops/testkit/gitignored-path-globs.ts` was written to kill, reintroduced one
layer up. A missing docblock fails red, at the first `render()`, in the file that
has the bug.

**The cost lands only where it is paid.** The engine, event-store, price-feed and
tui suites spawn real subprocesses and build real `.git` trees in temp dirs.
Under the docblock form they never load jsdom at all. A root `environment` key
would make all of them pay for it, and a root `setupFiles` entry would load RTL
into every one of them to arm a cleanup only `apps/web` needs.

**It is reversible in the direction that matters.** If `apps/web` ever grows
enough DOM tests that a projects split earns its keep, the docblocks are a `grep`
away and come out when the split lands. Unwinding a projects split that every
suite in the repo runs through is the expensive direction.

## Considered options

- **Per-file docblocks (chosen).** One line per render test, one scan test to
  make the line non-optional. Cost: a line that can be forgotten, and a guard
  test to catch the forgetting.
- **A `projects` split (rejected).** The idiomatic vitest answer, and the one
  that duplicates the two invariants this repo's config exists to state once. It
  also fails toward green, which is the direction this repo refuses.
- **A root `environment: "jsdom"` (rejected).** One line, and every Node suite in
  the repo pays for a DOM it never touches.
- **`environmentMatchGlobs` (rejected).** Deprecated in vitest 3, and a
  path-pattern list is the same hand-maintained membership problem as the split,
  with none of its structure.
- **Mocking the chart instead of buying jsdom (rejected).** Cheaper, and it
  cannot answer the question worth asking. A stand-in for `@tanstack/charts`
  reports whatever it was written to report about focusability, so the assertion
  that catches a library upgrade mounting a focusable surface would be asserting
  the mock.

## Consequences

- **This repo now has two test idioms**, and that is the cost the trade-off was
  weighed against. Every test before this one drives a pure module or spawns a
  real process; a render test mounts a component tree in a fake browser and reads
  the DOM. New contributors — human and agent — will reach for the second idiom
  where the first is still correct. The rule that holds the line is the
  coverage rationale's, unchanged: a branch that can be lifted into a pure module
  is lifted, not rendered.
- **`render.testkit.tsx` is production source to the repo's source scans.**
  `route-move.test.ts` and `rung-state-seam.test.ts` exclude `*.test.tsx` only,
  so this module is scanned like any component. It must never spell rung-state
  copy or the `venueAxis === "filled"` predicate — it knows about the DOM, not
  about ladders.
- **Browser stubs are the harness's job and they are a standing liability.**
  jsdom implements no `ResizeObserver` and no `matchMedia`, and lays every
  element out at zero. The harness stubs the first two so a chart can mount; the
  third is why a render test must never assert a measurement. A test that starts
  depending on a size is asserting jsdom's zeros.
- **A mounted-but-inert component satisfies a "nothing is present" assertion
  vacuously.** Because jsdom measures zero, a component that quietly declines to
  draw looks identical to one that drew nothing focusable. Every such assertion
  needs a companion that proves the subtree really mounted;
  `fill-path-chart-a11y.test.tsx` carries one and says why.
- **Retiring a source-scan regex is a separate, later act.** The two scan tests
  exist because nothing could render `Pills`. That is no longer true, but a regex
  retires only in the commit where a render test makes the same claim, and never
  in this one.

### The three SDP tests

- **Hard to reverse.** Render tests multiply, and this one sets the default
  shape for every component test the layer will ever have — the environment
  attachment, the single RTL importer, the assertion style. Six slices of spec
  #403 are queued behind it and will be written in its idiom.
- **Surprising without context.** Four artifacts said in writing that this repo
  deliberately has no such toolchain: `docs/coverage-rationale.md` §6, the
  `vitest.config.ts` coverage comment, `routes/route-move.test.ts`'s header and
  ADR-019 itself. A reader who has met any of them needs to know which decision
  replaced it, and on what trigger.
- **A real trade-off.** Toolchain weight and a second test idiom, against the
  ability to pin interactive `.tsx` that cannot be lifted into a pure module. The
  repo declined this buy twice on the same reasoning it accepts it on now; what
  changed is that a structural pass is about to move markup no source scan can
  hold still.
