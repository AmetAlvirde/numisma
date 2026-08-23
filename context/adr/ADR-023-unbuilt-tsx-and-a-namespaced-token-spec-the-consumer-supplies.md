# The package ships unbuilt TSX and owns a namespaced token spec the consumer supplies

_Made during: spec #412, the component package and its workbench, slices #413 to
#418. Required in writing by that spec's §8. The architecture was proven first by
the `prototype/tailwind-package-spike` branch, which was never merged and is now
deleted; its findings reached this repo through the AAR and this spec, not
through its code._
_Scope: product_
_Status: accepted_

## The decision

`@numisma/components` ships **unbuilt TSX**. Its `exports` point at
`./src/index.ts` and `./src/*`, and there is no `dist`, no build script, and no
`main`. Consumers import the source and transform it with their own bundler.

The package ships **no CSS at all**: no stylesheet, no `@theme` block, no token
file. What it owns instead is a **token specification**, `NMS_TOKENS` in
`src/tokens.ts`, whose every name is prefixed `--nms-`. Each name carries a
grayscale default and a note saying what reads it. **The package owns the names;
the consumer owns the values.**

No component reads a bare shadcn custom property, because `pnpm components:add`
rewrites them on the way in: `var(--muted)` becomes `var(--nms-muted)` before the
file is ever committed. That script is the only sanctioned add path, and it also
places the files, rewrites `@/…` imports to relative specifiers, folds newly
discovered token names into the spec, and regenerates each registered consumer's
defaults file.

Two consumers exist: `apps/web` and `apps/workbench`. `docs/component-package.md`
is the consumer-facing page.

## Why unbuilt source, specifically

Shipping `dist` would break the thing the package exists to enable. A consumer's
Tailwind build discovers utilities by **scanning class strings in source text**.
Compiled output still carries them, but the arrangement then depends on a build
step staying honest about which files it emits and where, in a package whose
whole content is class strings. Source consumption removes the question. It also
removes the dual-package hazard outright, along with `optimizeDeps` and resolver
configuration in both consumers, neither of which either app needed.

The boundary is enforced by an inversion worth keeping: the package tsconfig
carries **no `paths`**. A stray `@/` specifier is a typecheck failure rather than
a bundler-specific silence, so the package proves its own self-containment on
every `pnpm typecheck`.

## Why a namespace, and not a rename on either side

`apps/web` already owns ten bare palette names: `--bg --card --line --text
--muted --ok --warn --pos --neg --now`. Upstream shadcn reads `--muted` too, and
means something different by it: the app's `--muted` is muted **text**, shadcn's
is a recessed **surface**. A shadcn component dropped into that app would have
read the app's value by accident and looked correct until the day the two greys
diverged.

That is capture, not design, and the alternatives were both worse. Renaming the
app's palette touches 25 rules in `styles.css` plus 2 in
`PriceDropPathChart.tsx` for `--muted` alone, and buys nothing but the one
collision that exists today. Renaming the package's reads to match the app makes
the package a private fork of shadcn's vocabulary.

The prefix kills **the whole collision class** rather than the one name that
collides now, and it makes an override an intentional act in the consumer's own
source. `apps/web` defines its overrides as aliases (`--nms-background:
var(--bg)`), so `styles.css` stays the single place the app defines colour, which
is what that file's own comments already demanded.

## What was measured: the spec cannot be derived by scanning `var()` reads

This is the finding that most sharpens the decision, and it was not visible until
the add script was written.

A component reaches a token **two ways**, and only one of them is a `var()`:

1. **Bare, inside an arbitrary value.** `rounded-[min(var(--nms-radius-md),8px)]`.
2. **Through a Tailwind theme utility.** `bg-primary`, `border-ring`. No `var()`
   appears anywhere in the source, and the name is every bit as required: Tailwind
   4 emits a utility only when its theme variable exists, so a missing one emits
   **no rule** and the build exits 0.

Scanning `var()` reads therefore discovers **3 of Button's 12 tokens**:
`--nms-foreground`, `--nms-secondary` and `--nms-radius-md`. The other nine are
reachable only through the utility side, which has to be read off class names.
That is why `ops/components/tokens-file.ts` carries a **closed list** of shadcn's
role names rather than a pattern: `bg-clip-padding` and `bg-primary` are the same
shape, and only a list separates them.

The same list carries the grayscale defaults, deliberately. A role the script
cannot name is a role it has no default for, and it **refuses** on that rather
than writing a placeholder, because a placeholder would satisfy `tokens.test.ts`
and ship the wrong colour.

## Considered options

- **Unbuilt TSX plus a namespaced spec the consumer fills (chosen).** No build
  step, no dual-package hazard, no collision surface. Cost: the package is
  unusable outside a TSX-transforming bundler, its source no longer diffs cleanly
  against upstream shadcn, and every add must go through the script.
- **Ship `dist` plus a stylesheet, the ordinary package shape (rejected).** It
  is what a reader expects, and it puts the palette inside the package. Two
  consumers with different palettes then either fight the shipped CSS or override
  it, which is the accidental-capture failure with extra steps. Revisit only when
  a non-Vite consumer exists; today none does.
- **Rename the app's ten palette names to shadcn's (rejected).** Twenty-seven
  call sites moved for `--muted` alone, to buy the one collision that exists
  today, and the next upstream name to collide starts the argument again.
- **Keep shadcn's bare names and let the consumer take care (rejected).** The
  failure is invisible: the rule is emitted, reads correctly, and computes to
  whatever the consumer happened to mean by that name.
- **A build step that emits both source and `dist` (rejected).** It adds the
  dual-package hazard and a second answer to "which file did Tailwind scan",
  which is the question this package can least afford to have two answers to.

## Consequences

- **Every consumer's Vite and Tailwind config depends on this.** `source(none)`
  on the `utilities.css` import, an `@source` line resolving relative to the CSS
  file, a `@theme` block mapping Tailwind's namespace onto `--nms-*`, and a
  `layer()` choice on the generated defaults import. Each of those fails silently
  if wrong. `docs/component-package.md` §2 is the checklist.
- **The package source no longer diffs against upstream shadcn.** A component's
  custom-property reads are rewritten on the way in, so `git diff` against a
  fresh `shadcn add` will always show the namespace rewrite. That is the cost of
  the namespace and it was accepted knowingly. The script's idempotence is what
  keeps re-adding a component a no-op rather than a churn.
- **A hand-run `shadcn add` is a defect, not a shortcut.** Without the injected
  tsconfig `paths` mapping the CLI writes a directory literally named `@` and
  reports success; without the rewrites the component reads bare properties no
  consumer defines. The script exits non-zero on both, and `pnpm components:add`
  is the only path documented anywhere.
- **The spec grows one name at a time, by consumption.** A shadcn theme carries
  dozens of names this package does not declare, because nothing here reads them.
  A token a consumer is asked to define but nothing renders is a token nobody can
  verify, which is exactly the state the workbench's themed mode exists to make
  visible.
- **Two directions of the contract are tested, and neither is testable in
  jsdom.** `ops/components/nms-namespace.test.ts` holds the package side,
  `apps/web/src/nms-tokens.test.ts` the consumer side. Both are text-channel
  checks. The theming half is manual procedure, for the reason ADR-024 and
  `docs/component-package.md` §4 give.

### The three SDP tests

- **Hard to reverse.** Every consumer's Vite config, Tailwind entry and `@theme`
  block is written against this shape, and every component's custom-property
  reads carry the namespace in their source text. Unwinding it means editing both
  apps' build configuration and rewriting every component the package has
  accumulated.
- **Surprising without context.** Packages normally ship `dist` plus CSS, and a
  reader who opens `packages/components` expecting a build script will find none.
  Rewriting upstream shadcn's custom-property names on the way in is a real
  divergence from upstream, and it is the reason a hand-run `shadcn add` produces
  something that looks right and renders transparent.
- **A real trade-off.** No build step, no dual-package hazard and no collision
  surface against the app's ten palette names, paid for with a package unusable
  outside a TSX-transforming bundler, source that no longer diffs cleanly against
  upstream, and a mandatory scripted add path.
