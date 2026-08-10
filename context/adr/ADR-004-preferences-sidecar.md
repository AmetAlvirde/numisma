# Preferences sidecar: trader policy as a durable artifact beside the event log

_Made during: MVI — partial-close + profit-split increment / 2026-07-02 prototype →
reliable conversion (PRD "Trims and adds to Positions and derives the profit-split
obligation", #96) / slice "Ratifies the trim/add event schema amendment and the
preferences-sidecar boundary" (#97)._
_Scope: product_
_Status: accepted (supersedes the grill's genesis-field idea and the deferred
`ProfitPolicySet` 8th verb — see "Considered Options"); **amended 2026-07-30** —
see "Amendment: the sidecar class, the name debt, and three stale claims" below;
**amended again 2026-08-10** — see "Second amendment: `effectiveAt` is a
lexicographically-ordered ISO calendar date, on the wire" below._

Trader **policy** — the profit-split ratio (this fund's default 60/40) and the
loss-netting basis (`highWaterMark` default / `perClose`) — is persisted in a **second
durable artifact, `data/preferences.jsonl`, beside the event log**, not inside it. The
sidecar carries its own **append-only + on-load-validation** contract (the ADR-003
posture, applied to a second file), and a pure **`pickPolicyAsOf(prefs, asOf)`**
selector composes the policy in effect at any date at read time. Policy deliberately
lives **outside** the immutable event log so the fold stays pure and the log continues
to **fold standalone to the pure #90 book** — the profit-split obligation is derived at
compose time from the closed book plus the selected policy, never folded into NAV. Per
ADR-001 the pure selector and `composeProfitSplit` live in `@numisma/engine`; the
sidecar file IO (`preferences.ts`) lives in the `@numisma/tui` runtime *(**stale
— corrected by the 2026-07-30 amendment**: it lives in `@numisma/preferences`,
`packages/preferences/src/preferences.ts`)*. The
`product.md`/glossary ratification of the trader-facing vocabulary ("Preferences
Sidecar", "Profit Split / Obligation", "Split Basis") lands separately in slice #103.

## Considered Options

- **A `profitPolicy` field on the immutable genesis seed (the grill's first instinct).**
  Rejected — **superseded by this ADR.** Policy is revisable and time-versioned: the
  trader can change the split ratio or loss-netting basis on a date, and an as-of replay
  must show the policy that was in effect *then*, not the latest. An immutable genesis
  field structurally cannot express "policy changed as of this date" without re-seeding
  genesis (which the genesis seed's immutability forbids), and it would bake a
  descriptive, mutable preference into the one artifact defined to be frozen. The
  `effectiveAt`-stamped sidecar expresses time-versioned policy natively.
- **A folded `ProfitPolicySet` 8th event verb.** Rejected for v1 — **superseded, and
  deferred as an explicit out-of-scope** (promotable later if time-varying policy
  *inside* the log is ever genuinely needed). Folding policy into the event log would
  couple a descriptive trader preference into the immutable audit stream and — the
  decisive objection — **break the log's standalone foldability to the pure #90 book**:
  the fold would have to know about profit policy to replay, and the #90 invariant that
  the log folds to exactly the descriptive-only book would be lost. It would also grow
  the enumeration to an 8th verb for a concern that is not a material portfolio action.
- **Hardcoding the 60/40 ratio / high-water-mark basis in engine code.** Rejected: the
  split ratio and loss-netting basis are **configurable trader preferences**, changed by
  appending to a file, not by editing and redeploying code. 60/40 and `highWaterMark`
  are this fund's *defaults*, not constants.

## Consequences

- **Two persisted artifacts now, each with its own durability contract.** The event log
  (ADR-003) and the preferences sidecar are separate files with separate append-only +
  on-load-validation disciplines. The sidecar loader validates each line on load — shape,
  `effectiveAt`, ratio, and the `splitBasis` enum — and rejects/quarantines malformed
  lines rather than throwing through or silently corrupting as-of replay (the ADR-003
  fail-loud-on-a-bad-line posture, applied to the second file). The append-only write is
  a genuine append (no truncating overwrite), so a later policy change never destroys the
  prior policy an earlier as-of view depends on. **This append-only + on-load-validation
  discipline *is* the architectural contract** — it is what makes the sidecar a durable
  artifact rather than a mutable config blob.
- **`pickPolicyAsOf` is a pure as-of replay selector.** Given the validated entries and
  an `asOf` date it returns the policy in effect at that date (latest `effectiveAt ≤
  asOf`), so as-of review of the profit-split obligation is honest: the obligation is
  recomputed under the policy that was actually configured at the review point. It is
  pure and lives in `@numisma/engine`, mirroring the pure-selector shape of the fold.
- **The event log stays pure and standalone-foldable.** Because policy is external, the
  fold neither reads nor depends on it; the log still folds to exactly the pure #90
  `FundReviewData` book. The profit-split obligation is a compose-time derivation
  (`composeProfitSplit` on the exact cumulative total realized, under the selected
  policy) — **descriptive-only, never re-added to NAV** — so blanking the profit-split
  block leaves `fundValueUsd` unchanged (the #90 descriptive-only lock, extended).
- **ADR-001 boundary split, cleanly.** `pickPolicyAsOf` and `composeProfitSplit` are
  pure `@numisma/engine` domain; the sidecar file IO — the append helper and the
  validating `loadPreferences` — lives in `@numisma/tui` (`preferences.ts`), the same
  engine-pure / runtime-IO split ADR-001 draws for the event log. No engine code touches
  a file; no TUI code owns the policy math. *(**Stale as written — corrected by the
  2026-07-30 amendment.** The IO was moved out of the TUI to its own package and the
  move was never reflected here; it now lives in `@numisma/preferences`
  (`packages/preferences/src/preferences.ts`). The **split** this bullet asserts is
  intact and is the part that mattered: the pure selector is still engine, the file IO
  is still outside it, and no engine code touches a file. Only the runtime package's
  name changed.)*

### The three SDP tests

- **Hard to reverse.** The sidecar is a **durable persisted artifact** with a replay
  contract: once real `effectiveAt`-stamped policy entries are written, the file format
  and the `pickPolicyAsOf` selection semantics are as load-bearing as the event log's —
  changing them means migrating a persisted artifact and re-validating historical as-of
  replay, not editing one file. Ratified here before the first preferences entry is
  written (no forced later sidecar migration).
- **Surprising without context.** Trader policy deliberately lives **outside the
  immutable event log** — the intuitive place for "the fund's settings" — specifically so
  the fold stays pure and the log folds standalone to the #90 book. That a core fund
  preference is *not* an event, and that the profit-split obligation is derived at read
  time rather than stored, is not guessable without this decision.
- **A real trade-off.** Two were decided: **log-purity + no 8th verb vs. a folded
  `ProfitPolicySet` verb** — the sidecar keeps the log pure and the enumeration at 9, at
  the cost of a second artifact to persist and validate; and **`effectiveAt`
  time-versioning vs. an immutable genesis field** — the sidecar expresses revisable,
  date-versioned policy with honest as-of replay, at the cost of not living in the single
  frozen genesis seed.

## Amendment: the sidecar class, the name debt, and three stale claims

_Amended 2026-07-30, during the BTC DCA tracker increment (spec #163, seam `S5`;
slice #165), alongside ADR-013 which puts a second member in this class. No
decision here is reversed — this amendment names a class the original ADR created
without naming, records one debt, and corrects three claims the codebase has
outgrown._

### This ADR created a CLASS, not a file

The original decision reads as a decision about `preferences.jsonl`. It was
always a decision about a **kind of artifact**, and ADR-013's `orders.jsonl` is
the second member of that kind. The class is:

> **A durable, append-only, git-versioned file beside the event log, carrying its
> own on-load validation contract, joined to the fold at read time by a pure
> selector, and never folded.**

Membership is not about the data being small, or configuration-shaped, or
private. It is about the artifact being durable truth that **NAV must not fold
from** — policy in `preferences.jsonl` because it is descriptive and revisable,
observed orders in `orders.jsonl` because they are speculative until they fill.

**The note this amendment exists to make explicit:** *an append-only stream is not
an event log.* The two share the append discipline, the JSONL shape, the
fail-loud-on-a-bad-line posture and the durability contract — and they are not
the same thing. What makes the event log the event log is that **`foldEvents`
reads it and NAV comes out**. A sidecar has every one of the log's disciplines and
none of its authority. Confusing the two is the mistake this class exists to
prevent, and it is a live mistake precisely because the disciplines look
identical from the outside.

### The name debt — recorded, not paid

**`@numisma/preferences` now names one member of the class, not the class.** With
`orders.ts` landing in the same package, its name describes its first tenant.
That is a Mysterious Name in the making: a package called `preferences` that
holds the fund's order observations misleads at every read, the same species of
defect ADR-012 recorded when `accountIds` came to hold a `Map<string, Currency>`.

**No rename this increment.** The debt is recorded here deliberately rather than
paid, for a reason established by execution: `preferences-import-guard.test.ts`'s
regex was run against nine import forms — root, both quote styles, a `dist/*.js`
subpath, `require`, dynamic `import()`, side-effect, `import type`, and
re-`export from` — and **all nine match**, with `package.json` exporting `"."`
only. A new tenant inside the package inherits that guard for free; a rename
touches the guard, the workspace wiring and every import site for zero behavior
change, in an increment whose whole point is that no behavior changes. **Debt
recorded, interest understood, payment scheduled for whenever the package is
opened for a reason of its own.**

### Three stale claims, corrected

Each was verified against the code before being corrected here.

1. **The sidecar IO does not live in `@numisma/tui`.** This ADR says so twice
   (the summary paragraph and the ADR-001-boundary consequence, originally at
   `:73`). It lives in **`@numisma/preferences`**,
   `packages/preferences/src/preferences.ts` — moved out of the TUI by a later
   commit that never came back to the ADR. Both sites are now marked stale
   in place. **The split the bullet asserts is intact**; only the runtime
   package's name is wrong, which is exactly why it survived this long.

2. **`preferences.ts`'s own "latent today (no runtime caller)" is false.** The
   docstring on `resolvePreferencesPath`
   (`packages/preferences/src/preferences.ts:~39`) says the resolver is *"latent
   today (no runtime caller), but becomes silent split-brain the moment the
   sidecar is wired into the read path."* **That moment has already passed.** The
   web push path reads it live: `apps/web/src/push/push-core.ts:130` —
   `loadPreferences(resolvePreferencesPath())` inside `loadReserveFloorAsOf` —
   reached from `buildGlanceForAnchor` (`:142`), which `apps/web/src/push/push.ts:73`
   and `apps/web/src/push/backfill-core.ts:175` both call. The comment's own
   hazard is therefore **live, not hypothetical**, and the resolver is load-bearing
   today. The claim is corrected here; **the comment itself is left untouched by
   this increment**, which changes no code at all — it is a one-line fix owed to
   the next change that opens that file.

3. **ADR-003's body only ever reaches NINE verbs**, so *"ADR-003 stays at ten
   verbs"* cites the wrong document. The count is genuinely **ten**. But ADR-003's
   body walks `3 → 6` (cash settlement), `6 → 7` (`InvalidationMarked`) and
   `7 → 9` (trim/add) and stops there, because verb ten was added by **ADR-012**,
   which did so *without* amending ADR-003 — deliberately, since the tenth verb is
   additive and ADR-003's schema-version doctrine needed no change to accommodate
   it. **Where the count actually lives:** the ADR index's ADR-003 row, which
   carries the trailing *"Verb count now 9→10 — see ADR-012"*, and **ADR-012**
   itself, which is the document that added it. Cite those, not ADR-003's body,
   for any claim about the current verb count.

## Second amendment: `effectiveAt` is a lexicographically-ordered ISO calendar date, on the wire

_Amended 2026-08-10, during the `plans.jsonl` sidecar increment (spec #267, slice
#269), alongside the fourth member of this class. No decision here is reversed —
this amendment RAISES to the class level a rule the first two members already
depended on and neither wrote down, and it lands **before the first plan line
exists**, which is the only moment at which it can land for free._

### The decision

**Every `effectiveAt` in this class is a strict ISO `YYYY-MM-DD` calendar date, and
selection is STRING COMPARISON over it.** Both halves are the decision:

- **Strict `YYYY-MM-DD`, validated by shape AND by round trip.** Shape alone is not
  enough: `Date.parse("2026-02-30")` succeeds — it rolls over to March 2 — so a
  shape-only check accepts a string that *sorts* as February and *means* March. The
  validator re-renders the parsed date and compares it back to the input, which
  rejects the overflow while leaving a legitimate `"2026-01-31"` untouched.
- **Selection is lexicographic.** `pickPolicyAsOf` already selects the latest
  `effectiveAt ≤ asOf` by comparing strings, and the plans selector will do the same.
  This is the property that makes the format's strictness load-bearing rather than
  fastidious: under string comparison a `Date.parse`-able non-ISO stamp
  (`"08/10/2026"`) sorts under `"0"`, ahead of every ISO date in the file, and
  **silently selects the wrong policy** — no throw, no warning, a plausible answer.
- **The same strictness binds `asOf`,** the other operand of every comparison. A
  strict left-hand side compared against a loose right-hand side is not a comparison.

### Why this is an ADR amendment and not a code comment

**It is a property of the WIRE, not of the reader.** These are append-only,
git-versioned files. The accepted string set can be *widened* later at any time; it
can never be *narrowed* without migrating a durable artifact and re-validating every
historical as-of replay. So the decision has exactly one cheap moment, and that moment
is before the first line of a new member exists — which is why it rides the slice that
introduces `plans.jsonl`'s loader and precedes any write to it.

**It also writes down a precedent `preferences.jsonl` set unwritten.** That file has
enforced this rule in code since it shipped: `packages/preferences/src/preferences.ts`
carries an `ISO_DATE` regex and a comment explaining that a `Date.parse`-able but
non-ISO stamp "would sort wrong and silently select the wrong policy." The rule was
real, was correct, and existed nowhere but a validator's docstring — so the second
member of the class (`orders.jsonl`) reached for a different stamp for its own reasons
and nothing in the record connected the two choices. Naming it here makes it
inheritable: a fifth member does not get to rediscover it.

### What it does NOT say

- **It does not make every timestamp in the class a date.** `orders.jsonl`'s
  `observedAt` is deliberately second-granular (`YYYY-MM-DDTHH:MM:SS`, ADR-013),
  because several rungs of one ladder are submitted within the same minute and a
  date-only stamp cannot order them. That stamp is an OBSERVATION time; this
  amendment governs the **as-of selection key** — the field a selector compares
  against a query date to decide which record is in force. `observedAt` is likewise
  lexicographically ordered, which is the general rule underneath both: **a field
  that is selected on must sort as a string in the same order it sorts in time.**
- **It does not constrain the bodies.** `plans.jsonl`'s `anchorAt` is validated to the
  same strict form because it is a date, but nothing is selected on it and no relation
  to `effectiveAt` is enforced.

### The three SDP tests

- **Hard to reverse.** It is the definition of a field in an append-only, git-versioned
  file with a replay contract. Once a durable line carries a looser stamp the set
  cannot be narrowed without a migration — and the failure it prevents is a SILENT
  wrong answer rather than a crash, so a violation is not discoverable after the fact
  by anything short of an audit.
- **Surprising without context.** "Use ISO dates" reads as a style rule, and the
  natural implementation — `Date.parse` — is precisely the one that accepts
  `"2026-02-30"` and `"08/10/2026"`. That the strictness exists to keep
  **lexicographic order equal to chronological order** is the non-obvious part, and it
  is invisible to anyone who has not noticed that selection never constructs a `Date`
  at all.
- **A real trade-off.** A closed, strict format at the wire versus a permissive reader
  that normalizes what it is given. Permissive costs nothing at authoring time and
  buys a file whose accepted set is whatever the current normalizer happens to do;
  strict costs the operator an occasional rejected line — reported as a corrupt-line
  skip they must correct and re-append — and buys a file where a date means one thing
  forever. Chosen strict, and only because it is being chosen before the first line
  exists; on an established file the same choice would be a migration.
