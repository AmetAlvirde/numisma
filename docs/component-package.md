# The component package and its workbench

`@numisma/components` ships React components as unbuilt TSX and declares a token
specification it never supplies values for. Both halves of that arrangement fail
**silently**, in two opposite ways, and the whole of this page exists because of
them: what the package ships, what a consumer owes it in return, which
instrument proves which half, and the two manual computed-style passes that are
the only checks covering the parts no test can reach.

Surfaces: [`packages/components/src/tokens.ts`](../packages/components/src/tokens.ts)
(the specification, with the full argument in its header),
[`packages/components/src/index.ts`](../packages/components/src/index.ts) (the
curated export surface), [`apps/web/src/tailwind.css`](../apps/web/src/tailwind.css)
and [`apps/workbench/src/tailwind.css`](../apps/workbench/src/tailwind.css) (the
two consumer entries), [`ops/components/`](../ops/components/) (the scripted add
path and the consumer registry), and
[`apps/workbench/`](../apps/workbench/) (react-cosmos, the three theme modes).

The decisions behind it are
[ADR-023](../context/adr/ADR-023-unbuilt-tsx-and-a-namespaced-token-spec-the-consumer-supplies.md),
[ADR-024](../context/adr/ADR-024-react-cosmos-as-the-workbench-standalone.md)
and
[ADR-025](../context/adr/ADR-025-the-end-state-cascade-contract.md), which is
what makes `apps/web`'s missing preflight and its package-only colour utilities
a contract rather than an accident.

---

## 1. What the package ships

- **Unbuilt TSX.** `exports` points at `./src/index.ts` and `./src/*`. There is
  no `dist`, no build script, no `main`. A consumer imports the source and
  transforms it with its own bundler, which is what lets that consumer's
  Tailwind build scan the class strings inside it. Adding a build step here
  removes the scanning.
- **No CSS at all.** Not a stylesheet, not a `@theme` block, not a token file.
- **The token specification**, `NMS_TOKENS` in `src/tokens.ts`: nineteen
  `--nms-*` names today, each with a grayscale default and a note saying what
  reads it. The names are read off component source, not pasted from an upstream
  shadcn theme, so a token a consumer is asked to define is always a token
  something renders. Spec #432 wave 1 minted three (`--nms-card`,
  `--nms-muted-foreground`, `--nms-neg`); spec #439 wave 2 minted the
  remaining four (`--nms-pos`, `--nms-ok`, `--nms-warn`, `--nms-now`), each in
  the slice that moved the component first reading it. All ten names the
  header table names are minted now, and none is waiting.
- **A curated export surface.** `src/index.ts` names each export by hand. Today
  that is fifteen components — `Absent`, `Button`, `Card`, `CardTitle`, `Crumb`,
  `DcaCard`, `FillPathCards`, `FillPathProvider`, `GlanceCard`,
  `PriceDropPathChart`, `SectionTable`, `Shell`, `SummaryCard`,
  `SnapshotEmptyNotice` and `SnapshotStaleNotice` — plus the frozen `FillPath`
  object its parts hang off, the `useFillPath` and `useFillPathSelection`
  hooks, `buttonVariants`, `referenceLabel`, the row-level constants
  (`TABLE_CELL` and its table siblings, the four `METRICS_*` names,
  `POSITIVE`/`NEGATIVE`), the two data exports `CARD_SURFACE` and
  `NOTICE_CODE`, `cn`, and the token spec. No `export *`.
- **No `paths` in the package tsconfig**, deliberately. A stray `@/` specifier
  is a typecheck failure rather than a bundler-specific silence, so the package
  proves its own self-containment on every `pnpm typecheck`.

Grayscale defaults are a design choice, not a placeholder. A component reviewed
against the package's own defaults is reviewed on hierarchy, spacing and state.
`--nms-destructive` is grey here too, even though upstream shadcn ships it red,
because shipping that red would be the one place the package smuggled in a
palette.

## 2. What a consumer owes it

Five things. Four of them fail without an error message.

1. **Register.** Add one entry to `TOKEN_CONSUMERS` in
   [`ops/components/consumers.ts`](../ops/components/consumers.ts), naming a
   repo-relative path the generator owns. Run `pnpm components:add` with no
   argument and the generated defaults file appears. Never edit that file: the
   next add overwrites it in full, silently.
2. **Import the generated defaults into a cascade layer that loses**, so the
   consumer's own `:root` can win. `apps/web` imports it as `layer(theme)`
   because `styles.css` is unlayered and unlayered CSS beats every layer;
   `apps/workbench` uses the same layer for a different reason, because its
   decorator overrides with inline style and inline beats every layer.
3. **Define every `--nms-*` name at its own `:root`.** An override is meant to
   be an intentional, greppable act in the consumer's own source. `apps/web`
   defines them as **aliases** onto its existing palette (`--nms-background:
   var(--bg)`), which keeps `styles.css` the single place the app defines
   colour.
4. **Map Tailwind's namespace onto the package's**, in a `@theme` block:

   ```css
   @theme {
     --color-primary: var(--nms-primary);
     --radius-md:     var(--nms-radius-md);
   }
   ```

   so a theme utility (`bg-primary`) and a bare read inside an arbitrary value
   (`var(--nms-primary)`) resolve to the same value. `--nms-radius-md` is the
   one mapping that overrides a Tailwind built-in (`rounded-md`) rather than
   creating a utility.
5. **Point Tailwind at the package source.** `source(none)` on the
   `utilities.css` import (it is silently ignored on `theme.css`), then an
   `@source` line at the package. `node_modules` sits outside v4's automatic
   detection, `@source` paths resolve relative to the CSS file, and the bare
   package-name form `@source "@numisma/components"` **emits nothing and does
   not error**.

The prefix is what makes all of this collision-free. `apps/web` owns ten bare
palette names (`--bg --card --line --text --muted --ok --warn --pos --neg
--now`); the package reads none of them, so no rename was owed on either side.

## 3. The two silent failures

They look nothing alike and they demand opposite diagnostics.

### Failure one: a missing token emits no rule at all

Tailwind 4 emits a utility **only when its theme variable exists**. With no
`--color-primary` behind it, `.bg-primary` is not an empty rule in the built
stylesheet. It is absent from the stylesheet entirely. No error, no warning, and
the build exits 0. The component renders unstyled.

The measured negative control: deleting the single `@source` line from
`apps/web/src/tailwind.css` took the built stylesheet from 17,160 bytes to
5,690, with `bg-primary` falling to zero occurrences, **and the build still
exited 0**. Nothing in the build log distinguishes the two runs.
[`apps/web/src/tailwind-scan.test.ts`](../apps/web/src/tailwind-scan.test.ts)
turns that into a standing test.

### Failure two: a missing bare var emits a correct-looking rule that computes to nothing

`@theme` mints `--color-muted`. shadcn components also read **bare** custom
properties inside arbitrary values, which is why the add script rewrites those
into the namespace. Button's secondary hover is
`bg-[color-mix(in_oklch,var(--nms-secondary),var(--nms-foreground)_5%)]`, and
that `var()` resolves against `--nms-secondary`, not `--color-nms-secondary`. On
a miss, `color-mix` receives an undefined argument and the declaration computes
to transparent **while the rule sits present and correct in the stylesheet**.

### The consequence, and it governs every check on this page

**Grepping the built stylesheet proves scanning and says nothing about
theming.** A rule emitted from a scanned candidate string passes its `var()`
through literally, so it looks right whether or not any consumer ever defines
that property. Only computed style in a real browser separates the two. No check
may claim a theming result from a text search.

## 4. What the suite holds, and what it does not

| Claim | Held by | Channel |
| --- | --- | --- |
| The package reads no unnamespaced custom property | [`ops/components/nms-namespace.test.ts`](../ops/components/nms-namespace.test.ts) | source text |
| Every declared token is defined by `apps/web` | [`apps/web/src/nms-tokens.test.ts`](../apps/web/src/nms-tokens.test.ts) | text |
| Package utilities actually reach the built stylesheet | [`apps/web/src/tailwind-scan.test.ts`](../apps/web/src/tailwind-scan.test.ts) | built CSS text |
| Every exported component has a fixture | [`apps/workbench/src/fixture-coverage.test.ts`](../apps/workbench/src/fixture-coverage.test.ts) | source scan |
| App mode has not drifted from `styles.css` | [`apps/workbench/src/app-token-drift.test.ts`](../apps/workbench/src/app-token-drift.test.ts) | text |
| The workbench imports nothing from `apps/web` | [`apps/workbench/src/seam-isolation.test.ts`](../apps/workbench/src/seam-isolation.test.ts) | source scan |
| The app's own source is scanned | [`apps/web/src/app-scan-sentinel.test.ts`](../apps/web/src/app-scan-sentinel.test.ts) | built CSS text |
| No `@theme` colour utility in app code | [`apps/web/src/theme-color-utilities.test.ts`](../apps/web/src/theme-color-utilities.test.ts) | source text |
| `styles.css` holds no rule, only tokens, which subsumes "no class survives it" | [`apps/web/src/styles-css-end-state.test.ts`](../apps/web/src/styles-css-end-state.test.ts) | CSS text |

The first four rows are the four standing guards, and each is required to fail on
its own negative control: remove the package `@source` line, remove `@source
"./"`, add a bare `var(--muted)` read to package source, write `text-muted` in
app source. A guard that cannot be made to fail is proving nothing.

Every row is a **text** channel, the last one being text intersected with a
render. jsdom will not resolve `color-mix` through a
cascade, so nothing above can answer failure two, and the render harness from
[ADR-022](../context/adr/ADR-022-a-render-test-harness-for-the-web-component-layer.md)
cannot carry it either. That is what §5 is for. Playwright is deferred to its own
increment on purpose, rather than bought as a side effect of a package increment.

## 5. The manual theming procedure

This is the **package-side** computed-style procedure: it judges a package
component in the workbench, on each of the three theme modes. Its app-side twin
is §9, the Chrome checklist, which judges a converted app surface in the real
app. Both exist for the same reason, given in §3: a text channel cannot answer
whether a rule won the cascade and computed to the right value.

### Where

```
pnpm --filter @numisma/workbench dev
```

then http://localhost:5100. Every exported component has a fixture under
[`apps/workbench/src/ui/`](../apps/workbench/src/ui/), one file per component,
and `fixture-coverage.test.ts` fails the moment an export arrives without one.
The passes below are written against `button`
([`apps/workbench/src/ui/button.fixture.tsx`](../apps/workbench/src/ui/button.fixture.tsx)),
whose fixtures are `variants`, `sizes`, `icon sizes` and `states`; it exercises
the most roles, so it is the one to walk first. The mode switcher is the `theme`
select in the control panel's inputs section, top right. **It opens in
grayscale**, deliberately: a component opened cold should be judged before
palette gets a vote.

### The grayscale pass

Judge hierarchy, spacing and state, and nothing else. Every variant should be
distinguishable by weight and surface. Disabled should read as visibly recessed.
Nothing should depend on colour to be legible.

### The themed pass

Every role must repaint. `default`'s fill goes purple, `secondary`'s goes teal,
`outline`'s edge picks up the gold border token (`--nms-input`'s olive under a
dark OS preference), `destructive` goes red in its text and its tint, `link`'s
text goes purple, and corners get visibly rounder as `--nms-radius-md` moves to
14px. That radius change moves `rounded-md` on `default`, `lg`, `icon` and
`icon-lg` outright, and pushes `xs` and `sm` up to the 8px and 10px clamps they
carry.

**A role that does not change colour is a role nothing in the fixture renders.**
That absence is the finding, and it is the only thing this mode is for. The
palette itself is a test instrument, not a house theme; the drift test asserts
the values are pairwise distinct and says nothing about which colours they are.

### The app pass

The component should look like it belongs in `apps/web`: app blue on `default`,
dark surfaces, 8px corners. This is the "would I ship this" look, and it is the
only mode that answers it.

### The focus ring

**No fixture can stage `focus-visible`.** It needs real keyboard focus. Tab
through the `variants` and `states` fixtures in each of the three modes and watch
for the ring. `--nms-ring` is the one token whose absence is an accessibility
defect rather than a cosmetic one, and this is the only check in the repo that
covers it.

### The `states` fixture

`aria-invalid` repaints border and ring from `--nms-destructive`. That makes it a
**token check rather than a style check**, and the one place `destructive` is
exercised outside its own variant. Disabled drops opacity and kills pointer
events.

### A pass looks like

Three modes reachable from any fixture. Every role repainting between grayscale
and themed. App mode matching the app. A visible ring on keyboard focus in all
three.

### One measurement caveat

Chrome does not recalculate style in a **background** tab, so probing an inactive
renderer through devtools or a script returns stale colours. Activate the tab
before reading anything computed.

## 6. Adding a component

A component reaches the package one of two ways, and which one depends on where
it came from.

**From upstream shadcn: `pnpm components:add <name>`, the only sanctioned way.**
It injects the
tsconfig `paths` mapping the shadcn CLI needs, runs the add against the package's
own `components.json`, strips the mapping again, rewrites `@/…` imports to
relative specifiers, rewrites bare custom-property reads into the `--nms-`
namespace, folds newly discovered token names into `src/tokens.ts`, and
regenerates every registered consumer's defaults file. It is idempotent, and
[`docs/scripts.md`](./scripts.md) carries the full contract.

Two things it refuses on rather than guessing:

- **A token it has no default for.** `ops/components/tokens-file.ts` carries a
  closed list of shadcn role names with the package's grayscale defaults. A role
  it cannot name is a role it has no default for, and writing a placeholder would
  satisfy `tokens.test.ts` while shipping the wrong colour.
- **A stray `@` directory or a radix dependency.** The first is the CLI
  resolving `@/…` as a relative path and reporting success anyway; the second is
  the pinned `base-vega` style not taking.

The script never touches `src/index.ts`. That surface is curated by hand, one
export at a time.

**From `apps/web`: by hand, under §7's two conventions.** The house components
were written in the app before the package existed, so there is no upstream to
add them from and nothing for the script to rewrite. Spec #432 wave 1 moved the
first four — `Absent`, `Card`, `Crumb` and `SnapshotNotice` — and the move is a
rewrite rather than a `git mv`: the file is renamed to kebab-case, its imports
are made relative and extensionless, and every colour read is re-spelled from
the app's bare palette name into the `--nms-` namespace, one substitution per
line. The last of those is the step with a trap in it, and `src/tokens.ts`'s
header table is what a migrating file looks the name up in rather than guessing.
`ops/components/nms-namespace.test.ts` catches a read left outside the
namespace; nothing catches the right namespace with the wrong name in it, which
is why the table exists.

Spec #439 wave 2 finished the move: the seven components still carrying real
product state — `Shell`, `SummaryCard`, `SectionTable`, `GlanceCard`,
`DcaCard`, `PriceDropPathChart` and `FillPath` — followed the same rewrite, and
`apps/web/src/components/` no longer exists. **The package declares each
component's prop type; `apps/web` imports it back.** `glance/verdict.ts`, for
instance, imports `type { Verdict } from "@numisma/components"` rather than the
package importing a type from the app — the consumer defines the interface,
which is what lets a workbench fixture build a prop literal without ever
importing `apps/web`. Each component's test file moved with it, and the render
harness ADR-022 bought split in two: the DOM-rendering half —
`render`, `classCensus`, `renderedClassNames` and the RTL re-exports — is now
`packages/components/src/testkit/render.testkit.tsx`, the package's own render
harness; the half that read `apps/web/src/styles.css` to prove no leftover
house rule matched a rendered class was retired as scaffolding once
`styles-css-end-state.test.ts` made that property hold globally instead (see
§4 and §8). The two route tests that still render a package component from
`apps/web` — `auth-card-utilities.test.tsx` and
`login-submit-button.test.tsx` — import the harness from that package subpath,
the same form the repo already uses for `@numisma/components/tokens.ts`.

## 7. Two conventions about package source

Both are house rules with a cost attached, and both are decided here so a file
crossing in from `apps/web` is not deciding them again under migration pressure.

### How a component reads colour

**shadcn-derived components read Tailwind theme utilities. House components read
bare `var(--nms-*)` inside arbitrary values.**

`Button` came from the shadcn CLI and writes `bg-primary`, `border-ring`. That
stays: the utilities are how shadcn writes components, and rewriting them would
make every future `components:add` diff against upstream by hand. A component
written in this repo writes `text-[var(--nms-muted-foreground)]` instead, never
`text-muted-foreground`.

Both forms resolve to the same value, through the `@theme` mapping §2 already
asks every consumer for, so this is a convention about source form and not a
second palette.

Why the bare form for house components:

- **A mint stays a three-sided edit.** A new name needs `src/tokens.ts`, the
  app's `styles.css` alias, and the workbench's `theme-modes.ts` tables. Reading
  it through a utility would add two more sides: the consumer's `@theme` block,
  and [`ops/components/consumers.ts`](../ops/components/consumers.ts), which
  generates the workbench's CSS.
- **It keeps a guard's list short.**
  [`apps/web/src/theme-color-utilities.test.ts`](../apps/web/src/theme-color-utilities.test.ts)
  forbids app code from reaching house colour through a theme utility, and it
  works off a **literal** list of nine names. Every house name promoted to a
  utility has to join that list or `text-neg` in app code walks past the guard
  that exists to catch exactly that.
- **It makes a migration mechanical.** `[var(--x)]` becomes `[var(--nms-x)]`,
  one substitution per line, which is a diff a reviewer can count.

### How a component file is named

**Every component file in the package is kebab-case**, generic and domain alike.
`button.tsx` from the shadcn CLI, and `absent.tsx`, `card.tsx`, `crumb.tsx` and
`snapshot-notice.tsx` renamed on the way in from `apps/web`.

That is the name the shadcn CLI writes and the name `pnpm components:add` keeps
writing, so the alternative is not "PascalCase files" but a package where the
scripted path and the hand path disagree about the same file. Components
arriving from `apps/web` are renamed on the way in, once, rather than landing
under their old name and being renamed later by a sweep nobody scheduled.

## 8. Two things about the two Tailwind entries

**Preflight is included in the workbench and omitted in `apps/web`, permanently.**
This is the one deliberate divergence between the two entries, and
[ADR-025](../context/adr/ADR-025-the-end-state-cascade-contract.md) is the record
of why it is permanent rather than transitional. Importing `theme.css` plus
`utilities.css` and not `preflight.css` is the only supported way to skip it in
v4.

The workbench wants the reset, because a component reviewed on a browser-default
backdrop is being reviewed partly on the browser. The app omits it because the
user agent's own margins on `p`, `h1` through `h6`, `dl`, `dd`, `ul` and `figure`
are load-bearing there: every converted surface reproduces the edges it needs by
hand, and a reset would zero all of them at once, indistinguishably from the ones
carrying real intent. The four bare-element rules that had no class to hang a
utility on, `*`, `body`, `h1` and `h2`, live in an `@layer base` block in
`tailwind.css`, which is the only place an element selector can sit inside
Tailwind's cascade order.

**`apps/web/src/styles.css` is a token file now, and holds no rule.** Spec #420
emptied it one surface at a time, from about 1,400 lines to roughly a hundred:
two `:root` blocks declaring the app's palette and the `--nms-*` aliases this
package reads, plus the `color-scheme` hint, and nothing else. Earlier revisions
of this page described a censused stylesheet whose rules had to stay
byte-identical while components moved onto shared primitives. That constraint is
over. The one thing that has not changed is why the aliases live there and not
here: the package owns the names, the consumer owns the values, and this file is
where `apps/web` pays.

Two properties of that file are worth knowing before editing it. It is
**unlayered**, which is what makes it beat the package's generated defaults even
though `__root.tsx` links it first; the defaults arrive under `layer(theme)` and
unlayered CSS beats every cascade layer regardless of order or specificity. And
it holds **no rule**: `styles-css-end-state.test.ts` asserts the file holds
exactly two rules, both `:root`, which subsumes the per-component check that used
to stand beside it. Each of the six moved `*-structure.test.tsx` files carried
its own terminal assertion that no class it rendered was selected by anything
left in `styles.css` (`expectNoStyledClassSurvives`); spec #439 S0 retired it as
scaffolding once the file's zero class selectors made every such assertion
unfailable, and the property those six tests used to prove per component is now
held once, globally, by `styles-css-end-state.test.ts` alone.

**Theme colour utilities are package-only in app code.** `bg-primary`,
`border-border`, `text-muted` and the rest of the `@theme` vocabulary belong to
`@numisma/components`. `apps/web` reads its own palette as arbitrary values
instead, `text-[var(--muted)]` and `bg-[var(--card)]`, and
`apps/web/src/theme-color-utilities.test.ts` fails on any hit in a non-test app
`.tsx`. `text-muted` is the trap and it is failure two under a new name: it
compiles, resolves and wins the cascade, and paints a recessed surface colour
where the app meant secondary text. Package source is exempt by construction,
being outside the scanned tree, and test files are exempt because
`login-submit-button.test.tsx` asserts `bg-primary` on the package `Button` on
purpose.

**The theme decorator writes tokens to `document.documentElement`, and moving
them is a silent break.** A custom property's `var()`s are substituted where the
property is **declared**, not where it is read. `--color-primary: var(--nms-primary)`
is declared once, on `:root`. A wrapper div redefining `--nms-primary` therefore
moves the bare reads inside arbitrary values and leaves every Tailwind theme
utility on the value `:root` already computed. Half the tokens switch, half do
not, and nothing on screen says which half. That is failure two wearing a
different hat, inside the instrument built to catch it.

## 9. The app-side Chrome checklist

§5 judges a package component in the workbench. This judges a converted **app
surface** in the real app, and it is the procedure spec #420 ran once per slice,
ten times. Reach for it whenever a change moves a class string on a surface that
used to have a rule in `styles.css`, which is now every surface.

### Why it cannot be a test

The same reason §5 cannot. A text channel proves a rule was emitted and a render
test proves an element references it; neither can say the rule won the cascade
and computed to the value intended. jsdom resolves no `var()` chain through a
cascade and measures every box at zero, so a converted surface can be green in
the suite and wrong on screen. The division of labour is worth stating once: the
scan guards prove the rule is emitted, the structure test proves the element
references it, this proves it computed.

### Where

```
pnpm dev
```

then the route the surface lives on. For ladder, Fill Path and chart states the
live ledger does not happen to be in, use `/ladder-fixture/$state`, whose
fixtures are authored and carry no ledger figure.

### The procedure

1. **Stash the change and probe the pre-slice tree with the identical script.**
   The oracle is parity with what was there before, so the baseline has to be
   measured, not remembered.
2. **Diff computed properties and bounding rects**, every load-bearing property
   on every element the change touched. `getComputedStyle(el).getPropertyValue(…)`
   for the properties, `getBoundingClientRect()` for the geometry. A property
   that matches while the box moved means the parity is on the wrong axis.
3. **Read every colour as a computed value**, compared against the computed value
   of the token, never against a token name and never against a class name.
   `text-[var(--pos)]` and `text-pos` are the same class string to a grep and
   different colours on screen.
4. **Run negative controls.** Break the thing you just proved and confirm the
   probe sees it. A script that reports parity between two identical readings of
   the same tree is the failure this step exists to catch.
5. **Run every row twice, at a 320px viewport and at desktop width.** 320px is
   the app's floor and the width most conversions break at.
6. **Write the result table into the change's final commit body.** CSS values
   only: no price, size, quantity or rung figure enters the record.

### Two measurement caveats

**`resize_window` does not reach 320px.** The OS clamps the window below its
minimum and the tool reports success anyway, so the viewport you measured is not
the one you asked for. Measure 320px in a same-origin 320px `<iframe>` loading
the same URL instead.

**Keyboard state is unreliable through the browser extension.** Dispatching a
Tab walk has failed more than once. If a row needs focus state, take the
measurement early, and say plainly how you got it.
