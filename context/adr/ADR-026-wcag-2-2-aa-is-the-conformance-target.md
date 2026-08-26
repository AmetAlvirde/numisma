# WCAG 2.2 AA is the conformance target for `apps/web` and `@numisma/components`

_Made during: spec #451, the polish and accessibility wave, slice #452. Written
first because the seven slices after it are judged against it: without a stated
target, S3's thresholds are taste and S5's gaps are opinions._
_Scope: product_
_Status: accepted_

## The decision

`apps/web` and `@numisma/components` conform to **WCAG 2.2, Level AA**. Both
sides of the token seam are in scope, because neither can reach the target
alone: the package owns which foreground its components put on which surface,
and the consumer owns the values those names resolve to.

Twenty-five ADRs before this one record no conformance level. `styles.css`
carries exactly one contrast ratio, `--accent` at 4.6:1 against white, and it
was the only such number written anywhere in the repo. Every accessibility
question asked here has therefore been answered by taste, including the ones
that were answered correctly.

**The target binds four things.** Each is named against the success criterion it
serves, so a later slice cites a clause instead of a mood, and a red says which
rule broke rather than only which number moved.

1. **Text reaches 4.5:1 against the surface it sits on (SC 1.4.3, Contrast
   Minimum).** The criterion's own large-text allowance of 3:1 applies at 18pt,
   or 14pt bold, and nothing in this repo currently claims it. A colour that
   passes as a fill does not thereby pass as text: `--nms-warn` is `#8a5a12`,
   white on it reaches 5.91:1, and the same colour as text on a card reaches
   2.91:1.
2. **Non-text reaches 3:1, and so does the boundary of a control (SC 1.4.11,
   Non-text Contrast).** This covers a fill carrying meaning, an icon carrying
   meaning, and the edge that tells a user where an input is. A hairline drawn
   for texture is not a boundary; the line a field is identified by is.
3. **Every control is operable from the keyboard (SC 2.1.1, Keyboard).** Every
   control, not every surface. A decorative element that mounts no interaction
   is out of the criterion's reach entirely, which is the ground ADR-019 stands
   on.
4. **A control that changes a state announces the change (SC 4.1.2, Name, Role,
   Value).** A toggle that flips silently is a toggle only a sighted user has.
   Where the message is not a control's own state, such as a failed sign-in
   reported beside the form, SC 4.1.3 (Status Messages) is the clause, and the
   mechanism is a live region rather than a property on the control.

## ADR-019 is conformant, not exempt

The Price Drop Path chart is `aria-hidden`, mounts no interaction, and has no
seat in the accessibility tree. That reads at first glance like a carve-out from
the target. It is not one, and this document says so plainly so the next reader
does not have to rediscover it before trusting the rest.

SC 1.1.1 (Non-text Content) asks for a text alternative serving the equivalent
purpose, and it explicitly accepts marking pure decoration so assistive
technology can ignore it. The chart satisfies the criterion by the first route,
not the second. The rung list carries every per-rung fact the chart plots, in
words, and its rows are `<button>`s that select on focus, so tabbing the ladder
walks the inspect panel with it. The convexity caption carries the one thing
only the picture otherwise says, the shape of the capital curve, and it is
generated from the same data the chart is drawn from rather than hand-written.
The alternative is therefore equivalent by construction, and the `aria-hidden`
wrapper is what stops a screen reader hearing the same facts twice.

Adopting AA costs the chart nothing. ADR-019 stands unamended, and this
paragraph is the record that it was checked against the target rather than
excused from it.

## Why this qualifies as an ADR

The repo files ADRs sparingly. This one passes all three tests.

**Hard to reverse.** Every future component inherits the target and every future
palette value is constrained by it. Dropping back later does not restore a free
hand; it leaves a codebase full of decisions taken under a rule nobody can find
any more, which is worse than never having stated one.

**Surprising without context.** A conformance level reads as a compliance
checkbox, and it behaves here as a colour constraint. It rules out palette
choices that look entirely free at the moment they are made. That is exactly how
`--nms-warn` came to hold a value no card can carry as text: nothing was wrong
with the choice under any rule that existed when it was made.

**A real trade-off.** Naming the target roughly doubled this wave's scope. The
measurement it forced turned up three failing pairs, a token doing two jobs no
single value does, and a login page whose gaps were all route-file concerns. The
alternative was a smaller wave that shipped preferences.

## Considered options

**WCAG 2.2 AA (chosen).** The level regulators and procurement rules converge
on, and the level the palette can actually hold: measurement found it clean
except in three places, so the accessibility colour job is three fixes rather
than a repaint.

**AAA (rejected).** SC 1.4.6 wants 7:1 for text. `--muted` on a card reaches
6.63:1 and `--now` reaches 5.80:1, so the level would demand a repaint of
colours nothing is wrong with, and it would still leave the three real failures
to fix. Holding a target the palette misses everywhere teaches readers to ignore
it.

**2.1 rather than 2.2 (rejected).** The saving is small and specific: 2.2 adds
SC 2.4.11 (Focus Not Obscured), SC 2.5.7 (Dragging Movements) and SC 2.5.8
(Target Size Minimum, 24 by 24 CSS pixels). This app has one drag control, the
`INSPECT RUNG` range, which is operable by arrow keys already, and its rung rows
are full-width. Choosing the older version to dodge criteria that cost nothing
here would date the record for no gain.

**A house style guide instead of a standard (rejected).** It is what the repo
already had, spread across four comments and one ratio, and the wave began
because that arrangement could not answer "is this accessible enough". A
standard has clause numbers a test can cite; a preference has only whoever
remembers holding it.

**No target, keep deciding case by case (rejected).** This is the status quo,
and it is not neutral. It made `--nms-warn`'s second job invisible for as long
as nobody measured it.

## Consequences

- **Contrast becomes a checked property, not a reviewed one.** The package ships
  the pair list, because only the package knows which foreground goes on which
  surface, and each entry carries the threshold and the criterion it serves.
  Spec #451 S3 builds it.
- **A palette value is no longer a free choice.** Minting a token now carries the
  question of what reads it as text and what reads it as a fill, and those two
  answers may need two names. `--nms-caution` exists because they did.
- **The workbench's themed mode is exempt, and the exemption is declared where
  the palette is registered rather than assumed here.** Its contract is pairwise
  distinctness, so it fails contrast on purpose.
- **Keyboard operability and announced state extend past colour.** They are what
  make the login page a target-driven slice rather than a cosmetic one: labels
  that associate explicitly, a live region on the error, a focus ring the app
  owns, and a password toggle that says which state it is in.
- **This wave does not certify the app.** It adopts the target, fixes what the
  first measurement found, and leaves a guard behind. A surface added later is
  conformant when someone checks it, not because this document exists.
- **No second ADR in this wave.** The rule that app-side TSX paints with
  `--nms-*` is ADR-023 applied, and the contrast guard is that rule's
  consequence. Recording either separately would split one decision across three
  documents.
