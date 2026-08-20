# The fill-path card — the day-zero projection and the three-colour state key

The two product rules the DCA ladder's fill-path card (`/ladder/$planId`) obeys
that are not obvious from any one file: **what the card shows before anything has
filled**, and **how many colours the surface is allowed to mean something with**.

Both were discovered by the `prototype/tanstack-charts` spike and named by spec
#302 (§2 and §3). Neither is a runbook. Each is written down here because the
alternative was a rule held only in the shape of working code, which the next
reader is free to "fix".

Surfaces: `apps/web/src/ladder/fill-path-view.ts` (the view module — every
decision), `apps/web/src/ladder/price-drop-path.ts` (the chart's quantitative
logic), `apps/web/src/components/FillPath.tsx` and
`apps/web/src/components/PriceDropPathChart.tsx` (presentation only —
[ADR-019](../context/adr/ADR-019-the-chart-is-presentation-its-accessible-substitute-is-generated.md)),
`apps/web/src/ladder/convexity-caption.ts` (the chart's generated accessible
substitute), `apps/web/src/ladder/rung-state-copy.ts` (the words a rung's state
prints, authored on the web from facts and never read off the wire), and
`apps/web/src/styles.css` (the row tints, the only place `color-mix()` appears).

---

## 1. The day-zero projection

**The rule.** When a ladder has **no measured fills**, the card does not show
three empty measured tiles. It projects what the ladder *intends*: expected
deployment, expected units, and an expected average entry — each printed with its
own `~`. The projection **withdraws entirely the moment anything is measured**.
Expected and measured figures never appear side by side.

Why it matters as product, not as a nicety: a ladder that has not started is the
ladder the operator most wants a number from, and three dashes is the one answer
that is both true and useless. The declaration is a real quantity; it just is not
a measurement, and the card's whole discipline is that those two are never
confused.

### It is already reliable by construction — do not "fix" it

This section exists so that a later reader, finding no dedicated projection
module, does not conclude the projection was built casually and start
consolidating it. Four separate structural choices hold the invariant, and each
one is load-bearing:

1. **`ExpectedFigures` is a separate type from `MeasuredFigure`.** Not a flag on
   one type, not an optional arm — a different type, so an expectation cannot be
   passed to a slot that promises a measurement. The two absences ("not measured
   yet" and "could not be checked") stay apart because they are typed apart.
2. **`Expectation` is a separate component, and it prints its own `~`.** The
   tilde is not appended by a caller or set by a prop on the measured tile: the
   component that only ever renders expectations is the only thing that can draw
   one. A measured figure cannot acquire a tilde by passing the wrong argument.
3. **The expected average entry is the size-weighted harmonic mean** — total
   declared USD ÷ total expected units — **derived from the two totals, not
   averaged over prices.** On a convex ladder the arithmetic mean of the prices
   and the size-weighted arithmetic mean of the prices are both wrong, and both
   are *plausible*. `fill-path-view.test.ts` pins both wrong answers **by name**
   (`.not.toBeCloseTo(30_000)`, `.not.toBeCloseTo(25_000)`) so a refactor toward
   either cannot pass. If you are tempted to simplify that arithmetic, read those
   assertions first: they are the reason it looks the way it does.
4. **`expected` rides on `notStarted` and never outlives it.** One boolean,
   decided once in the view module (`hasNotStarted(row.figures)`), gates the
   projection's existence — `expected` is simply absent otherwise. There is no
   second place that can decide to keep showing it.

And one absence that is deliberate: **an unread sidecar gets no projection.**
`figures` absent means nothing could be *checked*, which is not the same claim as
"this ladder has not started" — it may be fully walked for all the card knows. So
`notStarted` is false there and there is no expectation at all, rather than a
confident number printed on the one row that admits it could not look.

**The projection is not a wire concept.** `notStarted` and `expected` are
web-internal; `projection/contract.ts` and `DcaWireRung` carry neither (spec #302
C1). Nothing about this rule implies a schema change.

---

## 2. The palette rule — exactly three state colours, and no fourth

**The rule.** *The fill path uses exactly three state colours, shared by the
picture and the list, and adds no fourth.*

| Colour | Means | Drawn as |
| --- | --- | --- |
| `--pos` | this rung **filled** | solid path segment, filled dot, `Filled` legend swatch, filled row tint |
| `--muted` | this rung is **waiting** | dashed path segment, hollow dot, `Waiting` legend swatch, bare row |
| `--now` | **where price is** | the "now" rule, `Now` legend swatch, the next rung's row tint |

Three states, one key, two renderings of it. The rung list tints with the same
three tokens the Price Drop Path strokes with, which is what makes it impossible
for the list and the picture to say different things about the same rung. A fourth
colour would not merely be busy — it would assert a **fourth state** that the
domain does not have, and the reader would go looking for it.

### The rule is already enforced in code, and here is the one case that tested it

Slice C of spec #302 is where this stopped being a preference. The `Deployed`
annotation — the measured total, drawn as a rule on the chart — was originally
stroked in `--pos`, the same green as the filled path, the filled dot, the
`Filled` swatch and the filled row tint. That was a **fifth job** for a token
whose one job is *this rung filled*.

The resolution was not to pick a fourth hue. `Deployed` was moved onto the
chart's **neutral ink** — `var(--text)`, no hue at all — **with no legend
swatch**, precisely so that it cannot read as a fourth state. The reasoning
generalizes, and is the operative form of the rule:

> `Deployed` is a **measurement the chart annotates itself with**, not a state a
> rung can be in. Only states get hue; only states get legend entries.
> Annotations get neutral ink.

Anything else that later wants to appear on this card faces the same question
first: *is this a state a rung can be in?* If no, it gets neutral ink and stays
out of the legend. If yes — and the domain grows a genuine fourth rung state —
that is an ADR, not a colour pick, because it changes the key that two surfaces
share.

Two mechanical notes that follow from the rule rather than standing beside it:

- The neutral rule's opacity (0.7) is **set against the axis spine, not picked**.
  `--text` is the brightest token in the palette; held back too far (0.4) it
  landed *dimmer* than the `--muted` gridlines the library draws in
  `currentColor`, and a mark quieter than the frame it stands in reads as part of
  the frame.
- `color-mix()` is used unguarded in the row tints (spec #302 C6/D2, accepted).
  What breaks in a browser without it is **the rung list's state key** — named
  here for what it costs, not for how likely it is.

---

## See also

- [ADR-018](../context/adr/ADR-018-a-charting-library-in-the-web-access-surface.md)
  — why `@tanstack/charts` is in the production build path, and that every doc
  asserting the repo has no chart library is stale against it.
- [ADR-019](../context/adr/ADR-019-the-chart-is-presentation-its-accessible-substitute-is-generated.md)
  — the chart is `aria-hidden` presentation; its accessible substitute is the
  generated convexity caption, never a hand-maintained description.
- [`coverage-rationale.md`](./coverage-rationale.md) — why `FillPath.tsx` and
  `PriceDropPathChart.tsx` are uninstrumented, and what guards them instead.
