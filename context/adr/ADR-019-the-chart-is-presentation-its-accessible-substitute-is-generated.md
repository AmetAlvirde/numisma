# The chart is presentation; its accessible substitute is generated

_Made during: the fill-path surface (spec #285 §6.3) and carried unchanged
through the tanstack-charts spike (branch `prototype/tanstack-charts`,
`aaae657..1ebb605`); flagged by the 2026-08-12 audit of that branch, which found
the decision held by four scattered artifacts and no single one. This ADR is
that single home — referenced by spec #302 (§4 Seam D, §8)._
_Scope: product_
_Status: accepted_

## The decision

The Price Drop Path chart (`PriceDropPathChart`) is **presentation only**: its
wrapper is `aria-hidden`, it mounts no interaction (focus, pointer, keyboard,
tooltip all off), and it has no seat in the accessibility tree. Its accessible
substitute is **two things that already exist for other reasons, plus one
generated sentence**:

1. **The rung list** carries every per-rung fact the chart plots, in words.
   Each rung row is a **`<button>` that selects on click AND on focus**, so
   tabbing down the ladder walks the inspect panel with it — inspection is
   keyboard- and screen-reader-reachable without the chart being involved at
   all.
2. **The generated caption** from `ladder/convexity-caption.ts` carries the one
   thing only the picture otherwise says — the shape of the capital curve. It
   renders in an `.sr-only` `<div>` beside the chart. It is **generated, never
   hand-written**: there is no hand-maintained chart description and there must
   never be one, because a hand-maintained description drifts from the data the
   chart is drawn from and a generated one cannot.

**A labelled, keyboard-navigable chart was achievable and declined.** The
library can mount focus and keyboard navigation and carries a required
`ariaLabel`; making the chart accessible was a supported path, not a missing
feature. It was declined because it would be a *second, worse rung list*: a
synthetic navigation surface duplicating facts the real list already exposes
with real semantics, costing every screen-reader user a redundant traversal to
guarantee nothing new.

## Why this ADR exists: the decision had four homes

Until this document, the decision lived in four places with no compile-time or
test link between them: the header contract in `PriceDropPathChart.tsx`
("§6.3a"), the JSX comment on the substitute `<div>` in `FillPath.tsx`
("§6.3b"), the CSS comment on `.sr-only`/`.fp-caption` in `styles.css`, and
spec #285 §6.3. Four homes for one decision is the same failure mode the
branch's own audit names for stale claims — any one can drift while the others
stand. **This ADR is now the authoritative statement**; the in-source comments
remain as local guidance, and where they disagree with this document, this
document wins.

## The residual risk, named precisely

**The silent failure is deleting the caption `<div>` as "empty markup."** The
`.sr-only` element is invisible to every sighted reader — including every
sighted reviewer of every future diff — so removing it tidies nothing visible
and breaks nothing a sighted person can see, while severing the chart's **only
route into the accessibility tree**. The failure in the other direction is
graceful (if `.sr-only` stops applying, the caption becomes visible — uglier,
not less accessible); the deletion is the one-directional, unnoticeable edit.

**Something mechanical catches it now.** This paragraph used to end "nothing
mechanical can catch it today", and the harness that sentence was waiting on
arrived with [ADR-022](ADR-022-a-render-test-harness-for-the-web-component-layer.md).
`apps/web/src/components/fill-path-chart-a11y.test.tsx` mounts `FillPathCards`
under jsdom against a synthesized fixture and asserts all three clauses: the
`.fp-chart` wrapper carries `aria-hidden="true"`, nothing under it answers the
tabbable selector, and the `.sr-only` node's text equals what
`ladder/convexity-caption.ts` generates for that same fixture — compared against
the generated value, never a literal, because a literal expectation would be the
hand-maintained description this ADR forbids, smuggled in as a test. Deleting
the caption element turns the suite red; that was checked by deleting it.

**What is still held by prose, named precisely.** The test pins the subtree as it
actually mounts, so a library upgrade that begins mounting a focusable surface
fires it. It does NOT pin the four neutralization props below: measured on
`@tanstack/charts` 0.11.0, the adapter renders `tabindex="-1"` on its `<svg>`
whatever `tabIndex`, `focus` and `keyboard` are set to, so flipping any of them
leaves the assertion green. Those four remain guarded by this document and by
`PriceDropPathChart`'s own header. The half that was uncatchable — the deleted
caption — is the half that is now caught.

## Answered, by its own ADR: the component-test harness

This section used to defer the question. It said that if the harness question
(the audit's D1 — jsdom + a testing library for `apps/web`) were ever answered
yes, **that would be its own ADR**, because adding a component-test toolchain to
a repo that had deliberately tested only pure modules is hard to reverse,
surprising, and a real trade-off; and that it must not arrive as a side effect of
"add a test for the chart."

It was answered yes, on those terms.
[ADR-022](ADR-022-a-render-test-harness-for-the-web-component-layer.md) is the
decision — written first, deciding what was bought, where jsdom attaches and what
the harness is deliberately not spent on. The trigger this section named is the
one that fired: the coverage rationale's own exit clause, a branch that cannot be
lifted into a pure module. Read ADR-022 for the harness; this document still owns
the chart's posture.

## Considered options

- **Presentation chart + generated substitute (chosen).** One navigation
  surface (the rung list) with real semantics; one generated sentence for the
  curve's shape; the chart spends its entire budget on being a good picture.
  Cost: an `aria-hidden` chart that reads as a defect to a reviewer arriving
  cold, and a substitute held together by convention until a harness exists.
- **A labelled, keyboard-navigable chart (rejected).** Achievable in the
  library. Rejected as a duplicate: every fact it would expose is already in
  the rung list, so its accessibility tree would be a second list with chart
  semantics bolted on — more surface, nothing new reachable.
- **A hand-maintained chart description (rejected).** The drift machine: prose
  asserting what the data-driven picture shows, updated by discipline. The
  generated caption exists precisely so no such text is ever written.

## Consequences

- **The four a11y neutralizations in `PriceDropPathChart` are load-bearing.**
  `aria-hidden` on the wrapper, `tabIndex={-1}`, `focus`/`pointer`/`keyboard`
  false, `tooltip: false` — they hold together because the library's `ariaLabel`
  is required and its surface focusable by default (the version-dated mechanics
  are ADR-018's; the posture they serve is this ADR's).
- **The legend is inside the hidden subtree, deliberately.** It decodes a
  picture a screen reader cannot see; every state it names is spelled out per
  rung by the pills in the list.
- **An `aria-hidden` chart is correct here, not a bug.** A reviewer or
  accessibility audit flagging it cold should be pointed at this document; the
  fix for "the chart is not accessible" is the substitute, which already
  exists.
- **The substitute pair is a hypothetical seam** (spec #302 Seam D): there is
  no observable joint between the hidden chart and its substitute. This ADR held
  that contract in prose through the harness deferral. The harness landed by its
  own ADR (ADR-022) and the invariant is a test now, so this section's guard duty
  is over for the caption's existence and its generated text. It continues for
  the four neutralization props, which no test reaches — see the residual-risk
  section for why.

### The three SDP tests

- **Hard to reverse.** The substitute is woven into the surface's behavior, not
  annotation: rung rows are `<button>`s whose focus drives selection, the
  caption is a generated artifact with its own module and tests, and the chart
  was built interaction-free from the definition down. Reversing means
  rebuilding the chart's interaction layer and unpicking the list's.
- **Surprising without context.** An `aria-hidden` chart with four
  neutralization props reads as an accessibility failure — the opposite of what
  it is — to anyone arriving during the harness deferral window. The invisible
  caption `<div>` reads as dead markup to every sighted reader.
- **A real trade-off.** A labelled, keyboard-navigable chart was on the table
  and declined: one honest navigation surface plus a generated sentence, at the
  price of a picture that must stay out of the accessibility tree and a
  substitute guarded only by prose until a harness exists.
