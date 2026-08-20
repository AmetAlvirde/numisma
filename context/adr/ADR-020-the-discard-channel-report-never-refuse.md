# The Discard Channel: a discard is a value the caller receives, and it never refuses the run

_Made during: spec #320 (the Discard Channel — `loadPreferences` reports its
skips, and the push reports without refusing), implementing #276. §4 of that
spec is this ADR's source text and was written to be lifted. Slices #330, #331
and #332 on `feature/preferences-discard-channel`._
_Scope: product_
_Status: accepted_

## The decision

**The Discard Channel**, with its authority clause: **report, never refuse.**

> Any component that may discard an input it was handed must return that discard
> as part of its own result. The discard is not a side effect, not a log line,
> and never nothing at all — it is a value the caller receives whether or not the
> caller looks. The component reports; the caller decides; and the decision may
> never be to withhold the fund's daily output.

This is a rule about **components that discard inputs**, not about `.jsonl`
loaders. A fold that drops an event, a parser that skips a row, an importer that
cannot read a record, a resolver that cannot match a reference — each is the same
shape and each is bound by the five clauses below. The preferences sidecar loader
is the motivating instance and is named here only as one; nothing in this
document depends on reading it.

### The contract, in five clauses

1. **Total, never throwing on bad input.** Discarding is a normal outcome of
   reading untrusted input, not an exception. A malformed input is data about the
   source, not a crash. A component that throws hands its caller a choice between
   a crash and a `try`/`catch` that swallows — and the swallow is the silence this
   idiom exists to remove.

2. **The result is an envelope, not a bare payload.** It carries three things:
   an **outcome** that distinguishes *"there was nothing to read"* from *"it could
   not be read"* — collapsing those lets a permissions error render as an empty
   policy, an empty book, an absent plan; the **accepted payload**; and a
   **`skipped[]`** listing every discarded input. A bare payload has nowhere to put
   the answer, which is the whole defect: a caller holding an array cannot tell
   *"the source held two"* from *"the source held five and three were rejected."*

3. **Each discard is addressable, categorized, and prose-only.** It names a
   **locator** the operator can go look at (a line number, an event index, an id,
   a row ordinal), a **reason drawn from a closed vocabulary** rather than free
   text, and **fixed prose that never quotes the discarded content.** Fund figures
   echoed into a diagnostic are laundered into terminals, log files and CI output.
   Where a diagnostic genuinely needs to name an unrecognized token, that token
   rides in its own sanitized, length-capped field — never interpolated into the
   prose.

4. **The component reports; the caller decides.** The discarding component never
   picks the consequence — no exit codes, no thrown errors, no policy. The
   consequence lives in a **separate, named verdict function over the envelope**,
   so the policy is a value a test can assert rather than a convention a reviewer
   must notice. Two callers of the same component may reach opposite verdicts and
   both be right; that is only expressible if neither verdict is baked into the
   component.

5. **Report, never refuse.** A discard must never kill the fold or withhold the
   fund's daily output. Availability of the daily view outranks the completeness
   of any one input. Where a run has already produced its output, the report is
   emitted **after** the output lands, never before — the ordering is part of the
   clause, because a diagnostic raised at load time in a run that pushes later is
   one `throw` away from being a refusal.

### What it is not

**It is not a `warn` callback.** A callback is a welcome *addition* to clause 2
and never a substitute for it: a side channel a caller can forget to pass is
exactly the silence this idiom exists to remove. A component may offer both; it
may not offer only the callback.

**It is not a logger.** A line written to stderr by the component is a discard
the caller cannot see, cannot count, cannot test and cannot decide about. Clause
2 is what makes clause 4 possible.

**It is not an argument for a shared loader abstraction.** Three compliant
implementations of a stated contract is the goal; one abstraction over three
sources with different record types is not. **Narrowed 2026-08-20:** this
sentence originally deferred to ADR-004's name-debt note "for why the sidecar
class has no shared module", which that note never argued and which is no longer
true — `packages/preferences/src/sidecar-io.ts` is a real shared module holding
the lock, the temp sibling and the atomic rename. What it deliberately does NOT
hold is any record shape, validation or vocabulary, which is the abstraction this
paragraph rejects. Shared MECHANICS, separate CONTRACTS.

## The kind, and its reserved capacity

Clause 5 says *report*, and a report has to land somewhere. The moment a second
component in the same run also reports, the two share one operator surface — and
a shared surface needs two nouns, or clause 5 quietly stops composing.

- **A kind** is a diagnostic's category on a shared operator channel. Lines enter
  under their kind and stay under it. A kind is not a severity and not a source
  file; it is *the question the diagnostic answers*, so that a reader can tell
  which findings are about the same thing.
- **A kind's reserved capacity** is its guaranteed share of a bounded surface.
  Bounding is **per kind**, never over the concatenation, so no kind can take the
  whole budget and no kind can be starved by a co-tenant.

The reserved-capacity rule is PR #322's lesson, learned on a seven-line bounded
gap channel: a bounded surface that slices a *concatenation* withholds whichever
kind sorts last, and once a transient, recurring kind alone fills the bound, a
permanent finding is starved out forever — silently, and in exactly the shape
this ADR exists to prevent. Truncation must also announce itself: a bound that
renders as an all-clear is the same defect wearing a cap.

**Kinds do not share an exit policy, and the channel must not learn to sum
them.** A discarded policy line marks its run non-zero (an unread stderr log is
not a report — an exit code is a checked value, a warning is a thing someone must
happen to read); a diagnostic that points into an append-only record and can
never be extinguished is prose-only and exits zero. A channel that also summed
exit codes would force one tenant's policy on every other. Prose composes in the
channel; exit codes compose beside it, each from its own clause-4 verdict.

The realized mechanism is `RunReport` in `apps/web/src/push/unattended-report.ts`
— per-kind grouping, per-kind bound with a truncation notice, dedup within a kind
so a per-anchor loop reports each distinct finding once per **run**, and
deliberately no exit-code arithmetic.

## Applying it to something that is not a loader

The clauses are mechanical once the four nouns are named. For any discarding
component: what is the **envelope**, what is the **locator**, what is the closed
**reason** vocabulary, and where is the **verdict function**?

| Component | Envelope | Locator | Verdict lives in |
| --- | --- | --- | --- |
| A fold over a record stream | the fold's own return, beside the folded state | the record's id, or its index in the stream | the caller that decides what a dropped record means |
| A text/CSV parser | the parse result, beside the accepted rows | the 1-based row (and column, where a cell is at fault) | the command or job that consumes the parse |
| An importer | the import outcome, beside what was written | the source row plus the durable id it would have become | the shell that reports and sets the run's exit |
| A resolver / joiner | the resolved set, beside the unresolved | the reference that found no target | the surface that renders the join |

Worked example, authored — a parser reading four rows, one of which names a unit
it does not know:

```
{
  load:    { status: "loaded", sourcePath: "<source>" },
  records: [ /* the three it accepted, in source order */ ],
  skipped: [ { row: 3, reason: "unknown-unit", detail: "unit is not one of the supported units", token: "furlong" } ]
}
```

The caller sees three records and one discard. It cannot see row 3's contents —
clause 3 — and it cannot fail to see that row 3 existed — clause 2. What it does
about that is clause 4's, and whatever it decides, clause 5 forbids it from being
*stop*.

**For #293 and its spec #323 specifically** — *the fold drops an event and says
nothing* — the mapping is direct, and this ADR is what they cite instead of
deriving a second answer to it: the envelope is `foldEvents`' return, the locator
is the event's id or its index rather than a line number, clause 4 says the fold
does not decide what a dropped event means (the consequence belongs to the
surface that consumes the fold), and clause 5 says a dropped event does not fail
the fold. What those documents still have to decide is theirs and is not decided
here: the closed reason vocabulary for a dropped event, which surfaces carry the
`skipped[]` and how far, and where each surface's verdict function lives.

**All three of those landed, and this is where to find them.** The vocabulary is
`FoldSkipReason` in `packages/engine/src/contracts.ts`, closed at
`position-absent` / `reserve-absent` / `provenance-absent` — and ADR-021 then
ruled that every member means the same thing about what the fold did, which the
"prefer a new reason over widening an existing one's meaning" consequence below
would have read as forbidding; ADR-021 settles that it does not. `foldEvents`
returns `{data, skipped}` and `dedupeFoldSkips` is the one dedup key every
counting surface goes through. The verdict lives in
`packages/event-store/src/event-store.ts` as `unattendedFoldVerdict`, consumed
by the web push shell and two TUI commands.

## Considered options

- **A bare array plus a `warn` callback (rejected).** The cheapest change and the
  one already available: keep the return shape, add an optional `warn`. Rejected
  because the callback is optional by construction — a caller that does not pass
  it gets today's silence back, and a caller that does pass it still cannot count,
  assert or route the discards. It is welcome as an addition under clause 2 and
  refused as a substitute for it.
- **A thrown error (rejected).** Loud, unmissable, and refuses. It violates
  clause 1 (a malformed input is data, not an exception), forces every caller into
  a `try`/`catch` whose easiest correct-looking body is a swallow, and where the
  component sits on a run's critical path it violates clause 5 as a side effect:
  the run stops and the day's output is never produced.
- **Refusing the push (rejected) — the real trade-off.** The maximally safe
  posture: if a policy input is known damaged, publish nothing rather than publish
  a figure derived from a partial reading. Rejected because availability of the
  daily view outranks the completeness of any one input. A suppressed slot with a
  reported reason is recoverable by the operator that evening; a withheld run is a
  day of the fund's view lost to a malformed line, and an unattended job that
  refuses on bad input teaches its operator to distrust the whole surface.
- **A logger inside the component (rejected).** Everything the thrown error costs
  in refusal, the log line costs in invisibility: nothing downstream can test it,
  count it, or decide about it, and in an unattended job it lands in a file nobody
  reads.

## Consequences

- **Envelope-shaped returns spread, and that is intended.** Each component that
  adopts the idiom widens its own signature and moves its callers. The cost is
  paid per component; the alternative is a repo where each reader has to
  rediscover whether *this* one is the silent kind.
- **The engine keeps the pure half.** The envelope and skip-record types are pure
  contracts and live beside the domain types they carry (ADR-001: no file IO in
  the engine); the IO and the verdict live in the runtime package.
- **A component may be non-compliant and correct.** This ADR binds components
  that *discard inputs they were handed*. A component that rejects at a gate — the
  ingest boundary refusing to fold a partial log — is making a different decision
  under a different doctrine and is untouched here.
- **The reasons are a closed vocabulary, so they are a compatibility surface.**
  Adding a reason is additive; renaming or removing one moves every reader. Prefer
  a new reason over widening an existing one's meaning.
- **`orders.jsonl` was already compliant** and needed nothing (spec #320 §7); it
  exceeds clause 2 with an injectable `warn`, which is the shape clause 2 endorses
  as an addition.

### The three SDP tests

- **Hard to reverse.** Once N components return envelopes, reversing means
  changing every one of their signatures and every one of their callers back — and
  each reversal silently re-buys the defect the envelope removed, so the reversal
  is not just expensive but individually unarguable.
- **Surprising without context.** Both halves surprise, and they surprise in
  opposite directions. *Why does this loader return a wrapper instead of the array
  I asked for?* is the first question a reader asks of clause 2; *why did the push
  go out on a policy file we know is damaged?* is the first question a reader asks
  of clause 5. Neither answer is derivable from the code alone.
- **A real trade-off.** Clause 5 trades a knowingly-degraded run against the
  availability of the daily projection. The losing side is a real cost, not a
  strawman: a run can publish a figure derived from a partially-read policy, or
  suppress a slot the operator expected, and the only thing standing between that
  and going unnoticed is that the run says so and exits non-zero. This ADR takes
  availability and pays for it with a mandatory report.
