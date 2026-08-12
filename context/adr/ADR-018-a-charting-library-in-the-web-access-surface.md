# A charting library in the web access surface

_Made during: the tanstack-charts spike (branch `prototype/tanstack-charts`,
`aaae657..1ebb605`); flagged by the 2026-08-12 audit of that branch, ratified
here alongside spec #302 (the fill-path refinement increment), whose slice E
points the two stale no-library claims — the `ChartGeometry` docstring in
`apps/web/src/ladder/fill-path-view.ts` and spec #285 §6.2 — at this document._
_Scope: product_
_Status: accepted_

## The decision

`apps/web` adopts **`@tanstack/charts@0.11.0`** to draw the fill-path card's
Price Drop Path. This **supersedes the repo's no-chart-library posture**, which
until this branch was asserted in two live documents: spec #285 §6.2 (*"A chart
library buys nothing at this fidelity and costs the repo's no-library
constraint"*) and the `ChartGeometry` docstring (*"no chart library; the repo
has none and adds none"*). Both were true when written and both are superseded,
not corrected — the constraint was real, priced, and knowingly paid.

What the library bought is what the hand-rolled SVG could not say: the
predecessor was a polyline over an **unlabelled canvas** — no axis, no tick, no
unit, an unlabelled dashed rule stranded at the canvas edge, and
`preserveAspectRatio="none"` squashing every dot into an ellipse. The line
survives the swap; everything quantitative around it (labelled scales, `.nice()`
domains, composed annotations) is what the library provides.

What it costs, measured not estimated: **+29.9 kB gzip, route-local** (the
ladder chunk grew 3,698 → 33,619 B; the shared vendor chunk moved +4 B), and a
**pre-alpha dependency in the production build path** — upgrades are breaking by
the vendor's own admission, and every merge to `main` ships production
(ADR-009's git-deploy amendment), so the churn risk lands on the deploy path,
not just the dev loop.

## What this ADR deliberately does NOT record

**The exact-version, caret-free pin is not a decision of this ADR.** Every
dependency in `apps/web/package.json` is pinned that way (`react 19.2.7`,
`better-auth 1.6.23`, `@tanstack/react-router 1.170.17`, …) — the pin is the
repo's standing convention, applied here as everywhere. What is new is a
**pre-alpha package sitting under it**, where the convention stops being
hygiene and becomes the thing that makes an upgrade a deliberate act. Recording
the pin as a decision would imply un-pinning is an option elsewhere; it is not.

## Three 0.11.0 API warts, dated to the version

Each is worked around in-source in `PriceDropPathChart.tsx`, each workaround is
correct **for this version**, and each will read as cargo after an upgrade
unless a reader knows it was version-shaped. That is what this section is for —
when an upgrade relaxes one, delete its workaround with this list in hand:

1. **`text.x` takes a channel only** — unlike `barY.y1`/`y2`, which also accept
   a bare number. A constant x therefore has to be an accessor
   (`x: () => xEnd`), which reads as indirection until you know the channel
   signature forced it.
2. **`dot.stroke` is a flat string, not a per-datum channel.** A ring's colour
   has to come from *which mark drew it* — which is why the rung dots are **two
   `dot` marks** split on `filled`, not one mark with a stroke accessor.
   (`r` *is* a per-datum channel in 0.11.0, so radius needed no such split.)
3. **`ruleY` carries no label channel.** The spot ("now") annotation is a
   composed `text` mark at the same semantic y — the library's documented
   pattern for labelling a rule, not a local invention.

## The a11y neutralizations are a consequence, not a choice

`ariaLabel` is a **required prop** of the 0.11.0 React adapter, and the chart
surface is focusable by default (`tabIndex` defaults to 0). Because ADR-019
rules that this chart stays out of the accessibility tree, all four of the
following hold together and none is optional **in this version**: the wrapper
carries `aria-hidden` (neutralizing the unavoidable label), `tabIndex={-1}`
takes the surface out of the tab order, `focus`/`pointer`/`keyboard` are all
`false` in the definition, and `tooltip: false`. If a later version makes
`ariaLabel` optional or the surface unfocusable by default, a reader will be
tempted to delete these as redundant — the *posture* they serve is ADR-019's
and survives any such upgrade; only the mechanics are version-dated.

## Considered options

- **`@tanstack/charts@0.11.0` (chosen).** Labelled quantitative axes, composed
  marks, and deterministic SSR (`initialWidth`, explicit locale) for +29.9 kB
  route-local and pre-alpha upgrade churn. Ecosystem-coherent with the ADR-009
  stack (Router, Query, Table already TanStack).
- **Keep the hand-rolled SVG (rejected — the posture not renewed).** Zero
  dependency cost, and the repo's written position until this branch. Rejected
  because the surface's job outgrew it: a fill-path card is read
  quantitatively, and the hand-rolled canvas could not label an axis, place a
  tick, or annotate a rule without rebuilding a chart library one feature at a
  time — which is the same dependency, acquired as unaudited local code.

## Consequences

- **The two superseded claims are corrected to point here** (spec #302 slice E
  — M5.1 fixes the `ChartGeometry` docstring, M5.2 the #285 §6.2 tracker text).
  Any future doc asserting the repo has no chart library is stale against this
  ADR, not a posture to re-litigate.
- **Upgrades are deliberate acts.** Pre-alpha + exact pin means no upgrade
  arrives by accident; whoever takes one owns re-auditing the three warts above
  and the `ariaLabel` consequence, and judging the preview build per the deploy
  runbook (the production path ships from `main`).
- **The cost is route-local by construction.** The library enters through the
  ladder route's chunk; nothing outside the fill-path surface pays for it.

### The three SDP tests

- **Hard to reverse.** An entire render surface (633 lines at adoption) is
  written against the library's mark API, and the route carries its +29.9 kB.
  Going back is rewriting the chart, not deleting an import.
- **Surprising without context.** Two live documents said the repo has no chart
  library and adds none — a reader who trusted either would treat the import as
  a mistake to revert.
- **A real trade-off.** Labelled, composable, SSR-deterministic quantitative
  rendering vs. a pre-alpha dependency on the production deploy path and a
  route-local bundle cost — priced in the AAR's measurements, not asserted.
