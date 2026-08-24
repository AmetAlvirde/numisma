# The end-state cascade contract: preflight off, a token-only `styles.css`, package-only colour utilities

_Made during: spec #420, the Tailwind migration of `apps/web`, slices #421 to
#430. Required in writing by that spec's §7. It records the arrangement the whole
ten-slice migration converged on, written at the end because that is when the
arrangement stopped being provisional._
_Scope: product_
_Status: accepted_

## The decision

Three rules, which only make sense together.

**`apps/web/src/styles.css` is the permanent, unlayered home of the palette and
the `--nms-*` aliases, and holds no rule.** Two `:root` blocks, roughly a hundred
lines, declaring custom properties and the `color-scheme` hint and nothing else.
Every surface the file used to style carries its declarations as Tailwind
utilities on the elements that render them. Being unlayered is the mechanism, not
an oversight: `__root.tsx` links this file before `tailwind.css`, so in document
order the package's generated token defaults come last, and they lose anyway
because that import carries `layer(theme)` while this file carries no layer at
all.

**Tailwind runs without preflight, indefinitely, with the house base rules in
`@layer base`.** `tailwind.css` imports `theme.css` and `utilities.css` and not
`preflight.css`, which is the only supported way to skip preflight in v4. The
four bare-element rules that had no class to hang a utility on, `*`, `body`, `h1`
and `h2`, live in an `@layer base` block in that file, which is the only place an
element selector can sit inside Tailwind's cascade order.

**Theme colour utilities are package-only in app code, and house colours are read
as `[var(--x)]`.** `bg-primary`, `border-border`, `text-muted` and the rest of
the `@theme` vocabulary belong to `@numisma/components`. App components write
`text-[var(--muted)]` and `bg-[var(--card)]`, naming the app's own token
directly.

## Why it is hard to reverse

Every bare-element rule and every arbitrary-value read in the app now depends on
this arrangement, and the dependency is invisible at each individual site.

Turning preflight on later resets the elements the base layer now owns, and
worse, it resets the elements no rule owns. With preflight off, the user agent's
own margins on `p`, `h1` through `h6`, `dl`, `dd`, `ul` and `figure` are live,
and nine slices of converted markup reproduce them by hand: `m-0 mt-1` where a
deleted rule set `margin: 4px 0 0`, `m-0 p-0` on a legend `<ul>` whose UA padding
would otherwise indent it forty pixels. Preflight would zero all of those at
once. Not one of those class strings would be wrong afterwards; they would simply
all be redundant, and the ones that were carrying real intent would be
indistinguishable from the ones that were only cancelling the UA. The range input
the chart card renders makes the same point in miniature: its `mx-0` exists to
unpick a 2px UA side margin that a `w-full` slider would otherwise overflow its
card with.

The colour convention reverses no more easily. It is held by a grep, not by the
type system, and the failure it prevents is silent in both directions.

## Why it is surprising without context

A Tailwind app with no preflight and no `text-muted` is not what anyone expects,
and both halves read as mistakes to a reader who arrives without this record.

`text-muted` is the trap, and it compiles. `--color-muted` maps to `--nms-muted`,
which in the package's vocabulary is a recessed surface, the well behind a
hovered ghost button. The app's `--muted` is secondary text, the most-used colour
it has. One English word, two roles. Write `text-muted` in an app component and
every stage agrees with you: scanned, emitted, resolved, cascade won. The app
paints the wrong grey. No error, no empty rule, no red anywhere else in the
suite. That is why the convention is a written rule with a test behind it rather
than a habit.

## The trade-off

What it buys: no repaint and no rename. The app keeps the palette it shipped, the
package keeps shadcn's vocabulary, and the `--nms-` prefix closes the whole
collision class rather than the one word that collides today.

What it costs: arbitrary-value verbosity across nine slices of migrated app code,
and a convention that needs a guard to hold. `text-[var(--muted)]` is longer than
`text-muted` and always will be. Spec #420 D5 declined to mint prefixed house
tokens (`text-app-muted`) to shorten the read; that retrofit is parked with its
own trigger and is not part of this decision.

## Considered options

**Turn preflight on and delete the base layer.** Rejected. It is the standard
arrangement and it would have made the migration a repaint: every UA margin the
app currently relies on would have gone at once, and the nine slices would have
been judged against a page that had already moved. The migration's whole oracle
was computed-style parity against the pre-slice tree, which requires the baseline
to hold still.

**Rename one side of the `muted` collision.** Rejected in spec #412 and not
reopened. Renaming the package's token means diverging from shadcn's vocabulary
at the one place the package exists to reuse it; renaming the app's means
touching every surface in the repo for a word that was correct before the package
arrived. Either closes one collision and leaves the class open.

**Fold `tailwind.css` and `styles.css` into one file.** Not rejected, deferred.
It is an optional follow-up and it changes no rule above. Two files is what the
migration ended with because the second one had rules in it until the last slice.

## Consequences

Four standing guards hold the arrangement, and each is required to fail on its
own negative control, which is checked rather than assumed:

- the package `@source` line in `tailwind.css`, without which the built
  stylesheet drops by two thirds and the build still exits 0;
- `@source "./"`, proven alive by an arbitrary-value sentinel on a real surface
  (`min-w-[320px]` on `<body>`, the 320px floor itself);
- no bare shadcn custom property read inside package source;
- no `@theme` colour utility in non-test app `.tsx`.

Two more guards hold the file itself. `styles-css-end-state.test.ts` asserts that
`styles.css` holds exactly two rules, both `:root`, declaring nothing but custom
properties; and the terminal assertion, added to all six structure tests, asserts
that the set of class names a surface renders, intersected with the set of class
selectors left in that file, is empty. The second is the one that catches a rule
reappearing under a name no deletion guard lists, which is the failure mode nine
section guards cannot see between them.

Spec #420 §10 left one question open for measurement, and the measurement settled
it: Tailwind 4.3.3's own `sr-only` needs no `clip-path` extension from this repo.
The house rule carried `clip-path: inset(50%)` and the expectation was that
Tailwind's did not. The reverse turned out to be true. Tailwind's carries the
`clip-path` and omits the legacy `clip`, the chart caption's computed result is
equivalent for the accessibility tree, and no `@utility sr-only` extension was
added.

Spec #412 §8 declined an ADR on the layer asymmetry, on the grounds that the
asymmetry was scheduled to be unmade. This is the decision that unmakes it, so it
gets the record.
