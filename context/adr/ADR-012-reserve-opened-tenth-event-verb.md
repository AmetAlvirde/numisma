# `ReserveOpened`: the tenth event verb births an empty cash container

_Made during: MVI — BTC DCA tracker increment / 2026-07-28 grill
([[2026-07-28-btc-dca-tracker-tempo-position-grill]], decision `T2`) → 2026-07-28
prototype ([[2026-07-28-reserve-opened-prototype]]), branch
`prototype/reserve-opened` (commits `cf5ba3f`, `ccee3cd`) → converted to
`feature/reserve-opened`, merged to `main` via PR #162 (2026-07-28), with
follow-up review fixes in `71c6e56`._
_Scope: product_
_Status: accepted — decision taken by the fund's operator; **implementation is
shipped on `main`** (`assurance: reliable`), not merely prototype. This ADR
records the decision and the prototype's findings that shaped the shipped
code._

> **Status update (2026-08-07, docs audit):** the metadata above originally read
> *"implementation is at `assurance: prototype` on an unmerged branch."* That is
> stale — `ReserveOpened` merged to `main` in PR #162 (`54a1c0b`, 2026-07-28)
> with follow-up fixes in `71c6e56` the same day, and the verb is live in
> `packages/engine/src/events/{types,parse,fold,crossref}.ts`. One artifact
> still carried the prototype framing verbatim:
> `packages/engine/src/reserve-opened.test.ts` opened with a `// PROTOTYPE.`
> comment header describing itself as pinning only two silent holes.
>
> **Update (2026-08-08, ADR-015 fold-in):** that comment is now fixed — the
> file's header reads "Shipped to `main` in PR #162 (ADR-012); the narrow scope
> below is a deliberate choice, not prototype-era coverage" and its own inline
> note records the second silent hole's closure (see the next update). No open
> item remains against this ADR.

No verb creates a Reserve. Every `reserveId` a `Deposit` / `Withdraw` / `Transfer`
/ trade cash leg references must already exist in the immutable genesis seed —
the reserve set has been genesis-fixed since ADR-003. That is a real asymmetry
nobody had named: **the log could birth a Position after t0 (`PositionOpened`)
but not a Reserve.** It surfaced because the fund's operator needed to
reclassify a fixed sum of <exchange> cash from Tempo Pulse to Tempo Capital and was
being pushed toward editing the `"immutable t0 seed"` genesis file
(`packages/event-store/src/event-store.ts:13`, `:79`) to do it — the only
Reserve-creating path that existed.

The **tenth event verb, `ReserveOpened`**, closes the asymmetry. It creates an
**empty** cash container — `{id, portfolioId, tempo, executionMode, accountId,
currency}`, no lots, no funding leg, **NAV-neutral by construction**
(`InvalidationMarkedEvent` is the precedent for a verb that moves no capital).
Movement then reuses the existing **`Transfer`** verb, which needed no change:
it already has no constraint that the two reserves share a Tempo, and `tier`
already rides across a Transfer so moving cash cannot launder its provenance
(`packages/engine/src/events/types.ts:159-171`). **The missing piece was never a
movement verb — it was the destination container.**

## Considered Options

- **`ReserveOpened` + the existing `Transfer` (CHOSEN).** A new verb that only
  mints an empty container, paired with a movement verb that already does
  everything needed. Smallest addition that closes the asymmetry without
  touching anything that already worked.
- **Editing genesis — REJECTED.** It would retroactively rewrite t0 and every
  fold since, against the seed the code itself calls the `"immutable t0 seed"`
  twice (`packages/event-store/src/event-store.ts:13`, `:79`). The whole point
  of an append-only log on an immutable seed (ADR-003) is that history is never
  rewritten to answer a later question.
- **`Redistribute`, one verb that creates and moves atomically — REJECTED.**
  Reads better for the intention ("open this reserve and fund it from that
  one"), but it duplicates `Transfer` wholesale and its creation half is
  **conditional** — a second ladder into the same destination finds the
  container already there, so the verb needs a silent create-or-don't branch.
  That is the same species as this repo's two named ingest hazards
  (`parseEvent`'s unknown-verb drop, `loadPreferences`'s quarantine lane): a
  thing that either happened or didn't, with no signal either way. *(**The
  second citation is stale as written and is corrected here, not withdrawn.**
  `loadPreferences`'s quarantine lane no longer discards without a signal —
  spec #320 made it return a `LoadedPreferences` envelope carrying one
  addressable record per discarded line, under ADR-020's Discard Channel. The
  rejection above is unaffected: the species it names — an outcome that either
  happened or didn't with nothing recording which — is exactly what ADR-020
  exists to forbid, so the corrected example now argues the rejection harder
  than the stale one did. `parseEvent`'s unknown-verb drop stands unchanged.
  Nothing else in this ADR is reopened.)* It also
  cannot express **open now, fund later** — the real path for a genuinely new
  venue, where the Reserve should exist before there is any cash to move into
  it.
- **`ReserveOpened` with a mandatory opening balance, symmetric with
  `PositionOpened` — REJECTED.** `PositionOpened` requires at least one lot
  (`packages/engine/src/events/parse.ts:515-516`), and mirroring that shape
  would make a Reserve birthable only by draining another Reserve's balance
  into it at creation. That is false for the new-venue case — a Reserve at a
  brand-new exchange or a new Tempo's cash pocket at an existing venue has no
  natural "opening transfer," and forcing one would misrepresent an
  administrative act (opening an account) as a capital movement.

**This must answer ADR-004**, and it is the paragraph that matters most.
ADR-004 rejected a folded `ProfitPolicySet` 8th verb because folding *policy*
into the log would break the log's standalone foldability to the pure #90
book — policy is revisable, time-versioned, and descriptive, not a material
portfolio action. **A Reserve is capital structure, not policy** — precisely
what the log exists to record — and `foldEvents` over genesis + log yields a
**strictly more complete** book with `ReserveOpened` in it than without. The
asymmetry it closes makes that concrete: **the log could already birth a
Position after t0 and could never birth a Reserve**, so a cash container that
came into existence after t0 had nowhere truthful to be recorded and had to be
backdated into the seed. The tenth verb does not weaken ADR-004's line between
material action
and descriptive policy; it shows where that line actually falls, and confirms
capital structure sits on the log side of it.

## Consequences

**`lots: []`, not absent — and it is load-bearing.** The grill's `T2` specified
the container is born with *"no lots."* Taken literally that is a
**provenance-laundering bug**, found by building the prototype:
`packages/engine/src/events/fold.ts:85` — `applyReserveDelta` **early-returns
on a falsy `lots`** (documented there as `"untiered: amount is the whole
truth"`). A Reserve born genuinely lots-less would **silently swallow the
`tier` of every incoming `Transfer`**, so the reclassified sum would have
landed in the new Reserve untiered and dropped straight out of the tier
rollup — **while NAV still looked perfect**, because `amount` stays
authoritative and the money did arrive. That is exactly the failure
`Transfer`'s own doc claims to prevent — tier "rides across so moving cash
cannot launder its provenance." The fix, now built into `foldEvents`
(`fold.ts:367`) and its cross-reference shadow
(`packages/engine/src/events/crossref.ts:290-298`): the Reserve is born with an
**empty array**, not an absent field. An empty array is truthy, so the first
credit pushes a real tier lot; `packages/engine/src/compose/canonical.ts:386`
reads a length-0 lot array as untiered, so a Reserve born and never funded
still composes correctly into the tier rollup. NAV-neutrality is unharmed —
empty lots sum to zero. **Generalized, this is the nugget worth keeping:**
"structurally impossible" is a claim about a specific encoding, not about an
absence — and absence is never neutral in a codebase that already assigns it a
meaning (here, "no `lots` field" already meant "untiered," a sentinel this
verb's naive reading would have collided with).

- **A currency mismatch against the account is a HARD REJECT at ingest, not a
  warning.** `packages/engine/src/compose/canonical.ts:136-146` already
  *excludes with a warning* a Reserve whose currency disagrees with its
  account's — a read-model-side safety net for the existing genesis-only
  Reserve set. Without an ingest-side gate, `ReserveOpened` would be the one
  path that admits such a Reserve into the *durable log* only to have it vanish
  from the read model downstream. `crossReferenceReserveOpened`
  (`packages/engine/src/events/crossref.ts:394-437`) rejects the mismatch loud
  at ingest instead, which is why `EventReference`'s account lookup widened from
  a bare id `Set<string>` to a `Map<string, Currency>` — the check needs the
  account's currency, not just its existence. Rejecting keeps the tenth verb
  inside ADR-003's fail-loud posture: **the log never holds a Reserve the
  dashboard cannot show.**
- **`EVENT_SCHEMA_VERSION` stays `2`.** `ReserveOpened` is an additive verb —
  no existing verb's required shape changes, so no prior log line needs
  migration — the same reasoning ADR-003's amendments already applied to
  `InvalidationMarked` and the trim/add verbs. Named honestly: an **older**
  build reading a `ReserveOpened` line does not silently misread it — the
  per-verb parse switch has no case for it, so it fails loud, the record is
  quarantined, and `assertLogFullyLoaded`'s fail-loud-on-a-partial-log posture
  refuses to fold. Fail-loud, deliberate, and — since this is unmerged —
  unexercised against a real older build.
- **`EventReference.accountIds` widened `Set<string>` → `Map<string,
  Currency>`** to make the currency-mismatch check possible. Cost one line and
  broke one assertion in the existing test suite — every other call site used
  only `.has()`, which a `Map` preserves identically to a `Set`. Worth
  recording as evidence that `EventReference`'s fields are consumed narrowly
  enough to widen freely — useful the next time a verb wants genesis context
  that isn't there yet. *(The field was **renamed `accountIds` →
  `accountCurrencies`** later in this same increment: a `Map<string, Currency>`
  under a name saying "set of ids" is a Mysterious Name that misleads at every
  read. The widening above genuinely happened as `accountIds`; the current
  symbol is `accountCurrencies`.)*
- **`EventReference` widened twice more, and the precedent above is why that was
  cheap.** `reserveBalances` entries gained `bornAsOf` and the reference gained
  `genesisAsOf`, so the ingest gate can answer *"does this Reserve exist **as of
  this date**"* — a question that was total before this verb (every approved
  reserve id was a genesis reserve present in the fold from t0) and is partial
  after it. Eight sites that each asked half of it now route through one
  `requireReserveBornBy`.
- **Two switches admitted a silent no-op if a case was forgotten — CLOSED.**
  `foldEvents`'s event-type switch and `applyEventToReference` have no
  return-type obligation, so a forgotten case used to compile clean and silently
  do nothing — unlike `crossReferenceEvent`, where every arm returns and a
  missing case is a compile error. **Both now carry an exhaustive `default:` arm
  asserting `const _never: never = event`**, so verb eleven is a compile error at
  all three registration sites rather than a silent no-op at two of them. The
  latch is behavior-free by design — zero runtime surface, unobservable to any
  test — so its proof is a compile, not an assertion: removing the
  `InvalidationMarked` arm from `applyEventToReference` fails with
  `TS2322: Type 'InvalidationMarkedEvent' is not assignable to type 'never'`, and
  removing the `Withdraw` arm from `foldEvents` fails with
  `TS2322: Type 'WithdrawEvent' is not assignable to type 'never'`. Both verified
  by deliberate removal and restored.

  **Superseded in part (2026-08-08, ADR-015):** the paragraph above and the
  "finer-grained half" paragraph below both record what was true when this ADR
  was written. ADR-015 subsequently deleted `applyEventToReference` and the
  cross-ref shadow it advanced entirely — the ingest gate now reads world-state
  from `foldEvents` directly, so there is no second switch left to latch, and
  the per-arm mutation killers described below (`reserveIds.add`,
  `reserveBalances.set`) no longer exist as lines to delete. The `foldEvents`
  half of the finding stands unchanged; the `applyEventToReference` half is
  moot because the function it describes no longer exists. Both paragraphs are
  left as-written rather than edited, since they accurately narrate a decision
  made at the time; see ADR-015 for the current shape.

  The finer-grained half of the finding is closed too. The prototype's mutation
  pass showed the `ReserveOpened` cross-ref arm writes **two** id structures
  guarding different questions, and that deleting
  `reference.reserveIds.add(event.reserve.id)` alone was caught by nothing —
  the same-batch `Transfer` check reads only `reserveBalances`. Each line now has
  its own killer, re-verified by deleting one at a time: `reserveIds.add` reddens
  *"rejects a second ReserveOpened reusing an id minted earlier in the batch"*,
  `reserveBalances.set` reddens *"accepts a same-batch ReserveOpened + Transfer
  into it"*, and either reddens the integration test that walks one event through
  all three sites.

  **A shared verb table replacing the three `event.type` switches remains the
  deep fix and is deliberately not taken** — the exhaustive default is the cheap
  one, and it buys the compile error the deep fix would also have bought.
- **The non-live reject is the first precedent for the open question, not an
  answer to it.** *Should the durable log accept capital records the read model
  excludes?* is decided here for `ReserveOpened` only: a non-live Reserve is
  rejected at ingest, because `compose/canonical.ts` drops it with
  `excluded.nonLive += 1` and **no warning at all** — strictly worse than the
  currency-mismatch case above, which at least warns. That follows this ADR's own
  sentence — *the log never holds a Reserve the dashboard cannot show* — so it
  decides nothing new; it makes the implementation honest to a decision already
  taken. What stays **open**, and is deliberately not settled here: whether
  canonical's `nonLive` lane should warn instead of dropping silently, whether
  every verb should gate `executionMode`, and whether paper or back-test capital
  may legitimately live in the durable log at all. The eventual repo-wide ADR
  inherits this as a **worked case** rather than an argument.
- **`apps/tui/src/event-store.ts` needed zero changes.** Confirmed by
  `git diff 56c8943 HEAD --stat` on the prototype branch — it dispatches events
  generically, so the write path stays verb-agnostic and the tenth verb reaches
  the real ingest/persist path with no access-surface change.
- **The `Reserve` name collision is inherited, not introduced.** *Reserve*
  already names both a Tempo and a record type in this fund's own vocabulary,
  and the fund holds cash containers under Pulse, Wealth, Liquid and Foresight
  Tempos. `ReserveOpened` inherits that collision; it does not create a new
  one. Worth a glossary line when this ships for real; not worth renaming the
  code over.

**Validated, through the real ingest path, against a copy of the durable
data** (never the durable data itself — `~/Dev/<fund>` was untouched). This
repository is public, so the properties are recorded here and the values are
not — they live in the private notes vault artifact
[[2026-07-28-reserve-opened-spec]]. **Tempo Capital rose by exactly the
transferred sum, Tempo Pulse fell by exactly the transferred sum, Tempo Reserve
was unchanged, and NAV was identical before and after — delta exactly 0**,
matching `head-digest.json`. `new=3 duplicate=0`, zero warnings; a replay of the same
three events reports `duplicate=3`, so the verb participates correctly in the
existing id-based dedup. `pnpm typecheck` clean across all six packages;
`pnpm test` 731 passed, 0 failed, 19 skipped, no pre-existing failures hiding
behind this one.

### The three SDP tests

- **Hard to reverse.** A verb, once it reaches the durable log, is permanent
  surface area — `EVENT_SCHEMA_VERSION` stays `2` precisely because removing or
  reshaping `ReserveOpened` later would be exactly the kind of load-bearing-
  schema change ADR-003 flags as the hard-to-reverse consequence of this whole
  architecture. Events written cannot be unwritten; once a real
  `ReserveOpened` lands in `events.jsonl`, this verb's shape is as permanent as
  any of the other nine's.
- **Surprising without context.** A verb that moves no capital at all — no
  amount, no lots, NAV-neutral by construction rather than by validation rule
  — is not the intuitive shape for "the fund adds a Reserve." Equally
  unguessable: the operator declining to edit a seed the code has **no
  mechanical guard** stopping them from editing (nothing prevents hand-editing
  `genesis.json`; the immutability is a documented discipline, not an enforced
  one), choosing instead to add a verb whose only content is "this container
  now exists."
- **A real trade-off.** Permanent schema surface (a tenth verb, forever part of
  the enumeration once written) versus genesis immutability (never rewriting
  t0). And the alternative on the table was not "do nothing" — the fund's cash
  really did need reclassifying — it was **"rewrite t0."** The tenth verb was
  chosen specifically to avoid that rewrite, at the cost of growing the
  permanent verb surface by one.
