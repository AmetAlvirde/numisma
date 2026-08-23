# The component package and its workbench

`@numisma/components` ships React components as unbuilt TSX and declares a token
specification it never supplies values for. Both halves of that arrangement fail
**silently**, in two opposite ways, and the whole of this page exists because of
them: what the package ships, what a consumer owes it in return, which
instrument proves which half, and the manual theming pass that is the only check
covering the parts no test can reach.

Surfaces: [`packages/components/src/tokens.ts`](../packages/components/src/tokens.ts)
(the specification, with the full argument in its header),
[`packages/components/src/index.ts`](../packages/components/src/index.ts) (the
curated export surface), [`apps/web/src/tailwind.css`](../apps/web/src/tailwind.css)
and [`apps/workbench/src/tailwind.css`](../apps/workbench/src/tailwind.css) (the
two consumer entries), [`ops/components/`](../ops/components/) (the scripted add
path and the consumer registry), and
[`apps/workbench/`](../apps/workbench/) (react-cosmos, the three theme modes).

The decisions behind it are
[ADR-023](../context/adr/ADR-023-unbuilt-tsx-and-a-namespaced-token-spec-the-consumer-supplies.md)
and
[ADR-024](../context/adr/ADR-024-react-cosmos-as-the-workbench-standalone.md).

---

## 1. What the package ships

- **Unbuilt TSX.** `exports` points at `./src/index.ts` and `./src/*`. There is
  no `dist`, no build script, no `main`. A consumer imports the source and
  transforms it with its own bundler, which is what lets that consumer's
  Tailwind build scan the class strings inside it. Adding a build step here
  removes the scanning.
- **No CSS at all.** Not a stylesheet, not a `@theme` block, not a token file.
- **The token specification**, `NMS_TOKENS` in `src/tokens.ts`: twelve
  `--nms-*` names today, each with a grayscale default and a note saying what
  reads it. The names are read off component source, not pasted from an upstream
  shadcn theme, so a token a consumer is asked to define is always a token
  something renders.
- **A curated export surface.** `src/index.ts` names each export by hand. Today
  that is `Button`, `buttonVariants`, `cn`, and the token spec. No `export *`.
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

Every row is a **text** channel. jsdom will not resolve `color-mix` through a
cascade, so nothing above can answer failure two, and the render harness from
[ADR-022](../context/adr/ADR-022-a-render-test-harness-for-the-web-component-layer.md)
cannot carry it either. That is what §5 is for. Playwright is deferred to its own
increment on purpose, rather than bought as a side effect of a package increment.

## 5. The manual theming procedure

### Where

```
pnpm --filter @numisma/workbench dev
```

then http://localhost:5100. The fixtures live under `button`
([`apps/workbench/src/ui/button.fixture.tsx`](../apps/workbench/src/ui/button.fixture.tsx)):
`variants`, `sizes`, `icon sizes`, `states`. The mode switcher is the `theme`
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

`pnpm components:add <name>` is the **only** sanctioned way. It injects the
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

## 7. Two things about the two Tailwind entries

**Preflight is included in the workbench and omitted in `apps/web`.** This is the
one deliberate divergence between the two entries. The app omits it because
`styles.css` styles bare elements on purpose and a reset would flatten them; the
workbench has no hand-written stylesheet and wants the reset, because a component
reviewed on a browser-default backdrop is being reviewed partly on the browser.
Importing `theme.css` plus `utilities.css` and not `preflight.css` is the only
supported way to skip it in v4.

**The theme decorator writes tokens to `document.documentElement`, and moving
them is a silent break.** A custom property's `var()`s are substituted where the
property is **declared**, not where it is read. `--color-primary: var(--nms-primary)`
is declared once, on `:root`. A wrapper div redefining `--nms-primary` therefore
moves the bare reads inside arbitrary values and leaves every Tailwind theme
utility on the value `:root` already computed. Half the tokens switch, half do
not, and nothing on screen says which half. That is failure two wearing a
different hat, inside the instrument built to catch it.
