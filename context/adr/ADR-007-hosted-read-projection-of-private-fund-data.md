# Hosted read-projection of private fund data

_Made during: MVI — web-app leg discovery / 2026-07-07 maps + grills
(`~/Dev/notes/numisma/2026-07-07-webapp-audience-grill`,
`2026-07-07-webapp-projection-grill`, build-map node 5 / ADR-007) — no PRD issue
yet; ratified as **the gate** that freezes the regime before any real fund data
leaves the local machine and a tracer slice is sliced against it._
_Scope: product_
_Status: accepted (amended 2026-07-24 — see "Amendment: payload narrowed to restore the blast-radius paragraph"; amended again 2026-07-27 — see "Amendment: a third `glance` branch, and the payload stops being a bare `Pick`"; amended a third time 2026-08-10 — see "Third amendment: a fourth `dca` branch, and declared rung prices leave the machine deliberately" — all three below)_

The web-app leg places a **read-only projection of private fund data** (positions,
portfolio/fund USD values, realized/unrealized P&L) in an **internet-reachable,
cloud-hosted database** — the first time real portfolio data leaves the local
machine and the private `<fund>` sibling repo (ADR-006). This ADR **permits
that regime**, under guardrails that make it a bounded, reversible-at-the-data-layer
extension of the existing architecture rather than a new source of truth: the
append-only event log stays the **sole permanent system of record** (ADR-003) and
the hosted DB is a **disposable, re-projectable view** fed by **one-way sync**
(local fold → cloud); for v1 only the **folded read-model** (`CompositionReport`),
**never the raw events**, is pushed; and the one-way property is enforced
**structurally** by split credentials. The concrete pre-deploy security controls
(auth mechanism, encryption-at-rest, secret manager, rate-limit/lockout) are a
**required follow-on this ADR gates** — the regime is decided here; the operational
hardening is a dedicated pass that must complete before real data is deployed.

## Considered Options

- **Localhost-only / no hosting (the map's "fires no hosted triggers" door).**
  Rejected — dead on arrival. The locked need is *remote mobile review* (audience
  grill decision 2): pulling up the fund from a phone away from the desk. Remote
  reachability forces an internet-exposed surface, so the "no data leaves the
  machine" posture cannot be preserved while meeting the actual requirement. Once
  that door is dead, an ADR (not a config note) is owed because real data now
  leaves the machine.
- **Self-hosted tunnel (e.g. Tailscale-to-Mac) instead of a cloud DB.** Rejected.
  Cheaper and keeps data on the Mac, but fails two of the three drivers: it is
  invisible as a portfolio artifact and teaches none of the SaaS-shaped
  architecture the career + long-term-multi-tenant goals want built (audience
  grill decisions 3–4). Cloud's marginal cost over a tunnel is largely "the thing
  those goals want built anyway," so it is paid deliberately — but run
  **single-tenant** (one hosted DB, one account, real auth + deploy pipeline;
  tenant isolation / billing / onboarding deferred).
- **Host the canonical log (or replicate raw events) in the cloud now.** Rejected
  for this regime. Hosting the canonical log contradicts ADR-006 (the log stays a
  local private sibling repo) and ADR-003 (a mutable hosted store never becomes an
  immutable audit trail). Replicating **raw events** and re-folding in-cloud is a
  real planned future iteration (projection grill Option B — it buys `--as-of` and
  cloud-derived views for free via the already-pure `@numisma/engine`), but it
  places the **richer, more sensitive** raw event fields (`decision.entryThesis`,
  `invalidationCondition`, `riskBudget`, `strategy`) in the cloud. Deferred; **when
  it lands it re-triggers this ADR** (amend/supersede) because it raises blast
  radius.
- **Push raw events vs. the folded read-model for v1.** Chosen: **the folded
  `CompositionReport`.** The cloud is a dumb authenticated renderer of a
  pre-folded, *distilled* surface, so the cloud holds derived dashboard values,
  not the raw thesis/risk-budget/invalidation prose. Smaller leaked surface,
  simpler cloud (no engine in the read path), fastest tracer — and it costs
  nothing later, since events-in-cloud is additive on the same one-way rail.

## Consequences

- **Two secret regimes, cleanly separated.** The read-only web app **never sees
  the provider keys** — Binance/Twelve Data/Banxico credentials stay entirely
  local-plane (they feed fetch → log → projection) and are unaffected by this ADR.
  The web leg introduces a *different, new* secret set: the cloud DB connection,
  the auth secret, and the local job's **write** credential to the cloud. The
  credentials-grill "hosted surface" tripwire fires for **this new set**, not for
  the provider keys.
- **One-way is enforced structurally, not by convention.** Nothing writes the
  cloud DB except the local push job. The web app holds a **read-only** DB
  credential; the push job holds the **sole write** credential. Web-as-write-origin
  is parked as its own future direction and earns its **own** ADR (two writers into
  one log + sync direction is the genuinely hard part); it is out of scope here.
- **DB corruption / loss is a non-event.** Because the DB is a disposable
  projection, a nuke-and-re-project from the log yields an identical result
  (success signal 8.2). A read-model schema change is therefore a **re-push, never
  a data migration**: bump → local re-folds → re-pushes → the shared-type renderer
  updates in the same deploy. This is the payoff of keeping the log canonical.
- **Blast radius is bounded and explicitly accepted.** Worst case = a read-model
  snapshot leaks: real positions and USD values, but **derived** (the log stays
  safe and rebuildable) and **without** the raw theses/risk budgets. Single-tenant,
  single-account, genuine auth on a public endpoint. This reconciles the
  "transaction-data-is-private" posture: a *derived, read-only* projection in an
  access-controlled hosted store is permitted; the raw log and raw events remain
  local/private (ADR-006's plaintext-in-a-private-repo bargain is untouched).
- **Pre-deploy security controls are gated, not decided here.** Encryption-at-rest
  and DB-provider choice, the auth mechanism (password/passkey + session),
  rate-limiting/lockout for a single-account public endpoint, and the
  secret-manager home (e.g. Vercel env) for the new cloud secrets are a **required
  security pass** (build-map branch 5) that **must complete before any real fund
  data is pushed**. This ADR ratifies the regime and gates deployment on that pass;
  a tracer may be built against a fixture first (map node 7.5) to land before the
  gate clears.
- **The engine's Node-purity becomes a guarded asset.** `@numisma/engine` is
  verified pure/Node-compatible (ADR-001). v1 (read-model push) does not run the
  engine in-cloud, but the planned event-replication iteration depends on that
  boundary, so it must be **protected** even though this regime does not yet spend
  it. A versioned projection contract — the shared `CompositionReport` type
  imported by the web app (compile-time drift guard, enabled by `apps/web` living
  in the monorepo) plus a `schemaVersion` stamp on the stored snapshot — keeps the
  local fold and the cloud renderer from drifting.

### The three SDP tests

- **Hard to reverse.** Real portfolio data leaving the machine into a hosted store
  is a regime line that, once crossed and read by a live surface, is not un-crossed
  by a code edit — a leaked snapshot cannot be recalled, and the hosting/auth/secret
  posture becomes load-bearing. Ratified before the first byte of real data is
  pushed so the guardrails (log-canonical, one-way, read-model-only, split creds,
  gated security pass) are fixed *before* the door opens, not retrofitted after.
- **Surprising without context.** That a *read-first mobile app* nonetheless forces
  a full internet-reachable regime (the localhost door is dead); that the cloud DB
  is deliberately **disposable** and re-projectable rather than a system of record;
  that v1 pushes a **folded read-model, not the raw events**, specifically to
  shrink the leaked surface; and that the web app's secrets are a **second regime**
  disjoint from the provider keys — none of that is guessable from the code, which
  today shows only a local TUI and a private data repo.
- **A real trade-off.** Several were decided, not defaulted: cloud vs. tunnel vs.
  localhost (portfolio/SaaS-learning value + remote reach vs. cheapest-keeps-data-home);
  read-model vs. raw-events for v1 (smaller blast radius + simpler cloud vs. free
  `--as-of` and cloud-derived views); regime-now vs. wait-for-full-security-pass
  (freeze the guardrails at the gate vs. couple ratification to operational
  hardening); and permitting a derived projection to leave the machine at all vs.
  the "transaction-data-is-private" posture (access-controlled derived read vs.
  nothing-leaves absolutism).

## Amendment: payload narrowed to restore the blast-radius paragraph

_Amended 2026-07-24, during the hosted security pass
(`~/Dev/notes/numisma/2026-07-24-hosted-security-pass-grill.md`, decision D8)
this ADR itself gated. The gated pass is now complete — see ADR-011 for the
posture it produced and `docs/hosted-cutover-runbook.md` for the operational
checklist._

The blast-radius paragraph above ("the cloud holds derived dashboard values,
not the raw thesis/risk-budget/invalidation prose") was accurate when
written. It stopped being accurate as `CompositionReport` grew, and the push
path — which serialized the whole engine report — silently inherited every
addition:

- **`invalidationWatch`** shipped structured per-position stop levels
  (`instrumentId`, `markPrice`, `level`, `direction`, `breached`). This ADR
  had explicitly deferred `invalidationCondition` **prose** to the Option B
  event-replication iteration as too sensitive for v1 — but the deferral was
  never enforced against the read-model's own growth, so the **structured**
  version of the same information shipped anyway. Positions plus the price
  at which the operator is forced out is a materially more useful (and more
  sensitive) pair than either alone.
- **`strategy`** was named explicitly, by this ADR, in the list of richer
  fields reserved for Option B — and shipped as a field on `closedBook` rows
  regardless.
- **`closedBook`** added a full realized-P&L trade blotter with open/close
  dates. Trade history, not current composition — outside what this ADR's
  Consequences section ever accounted for.

**Nothing decided this.** No ADR, no PR discussion, no deliberate trade-off
reopened the blast-radius question. The engine grew in the ordinary course
of feature work, the projection push imported the wider type, and the wider
type serialized straight into the `report` JSONB column. ADR-007 did not
become wrong through a decision — it became wrong through nobody being
told.

**The fix:** `apps/web/src/projection/contract.ts` now defines
`ProjectionReport = Pick<CompositionReport, "totals" | "dashboard">`, and
`toProjectionReport()` builds the pushed payload key-by-key rather than
trusting the type system alone — a type assertion over the wide object would
still satisfy the compiler while serializing every dropped field into JSONB.
`COMPOSITION_SNAPSHOT_SCHEMA_VERSION` bumps 1 → 2 so a v1 row read by the v2
reader yields a clean `status: "stale"` refusal rather than a mis-render.
Neither of those is by itself durable, and saying so plainly matters more
than the reassurance: a `Pick` tracks only the TOP-LEVEL key set, and
`toProjectionReport()` copies `report.dashboard` wholesale by reference. A
later engine increment that adds `DashboardSummary.entryNote` or
`CompositionRow.strategyLabel` still compiles, is still copied, and still
serializes into JSONB — this amendment's own history, one level deeper.

**What makes it durable is an ALLOW-LIST, in both halves.** A blocklist of
known-bad key names is the wrong polarity for a "what may leave the machine"
decision: it only ever catches leaks somebody already anticipated. So the
guard is closed-world on both sides of the compile/runtime line:

- `ProjectionKeyAllowList` in `apps/web/src/projection/contract.ts` names
  every permitted key of every type in the payload's transitive closure and
  fails `pnpm --filter @numisma/web typecheck` — naming the offending key —
  if the engine grows ANY field under `totals` or `dashboard`, or if the
  allow-list names a key the engine has since dropped.
- `apps/web/src/push/projection-payload.test.ts` asserts the actual derived
  payload's full recursive key-PATH set equals a checked-in list exactly,
  catching a runtime value that carries a key its type never declared. It
  retains the older `strategy` / `invalidation*` / `closedBook` /
  `entryThesis` / `riskBudget` marker scan underneath, not because it adds
  coverage — the allow-list subsumes it — but because it names the specific
  fields D8 argued about and fails far more legibly. Both scanners carry a
  guard proving they are not vacuous (each must find what it looks for in the
  wide input before it can be trusted to report its absence in the narrowed
  output).

This is a **narrowing, not a contradiction:** the blast-radius paragraph
above is restored to literal truth — the cloud again holds only derived
dashboard values, not stop levels, strategy tags, or trade history — and the
two allow-lists are what keep it true across the next engine increment, the
way this amendment's own history proves a `Pick` alone would not.

**Widening later stays cheap, exactly as this ADR promised.** "A read-model
schema change is a re-push, never a data migration" holds unchanged: widen
the `Pick`, bump `COMPOSITION_SNAPSHOT_SCHEMA_VERSION`, re-push, deploy. The
reader's `status: "stale"` branch means a version mismatch is a clean
refusal, never a mis-render, on the way in either direction. If a per-position
stops view or a closed-book view later earns its place on the phone-glance
surface, the blast-radius call is re-made at that moment, deliberately — not
inherited silently the way it was this time.

## Amendment: a third `glance` branch, and the payload stops being a bare `Pick`

_Amended 2026-07-27, while building slice 2 of the dashboard-glance increment
(PRD #146, issue #148). Filed in the same PR that makes it necessary — the
amendment above names the pushed payload **literally** as
`Pick<CompositionReport, "totals" | "dashboard">`, and that sentence goes stale
the day this lands._

**What changed.** The pushed payload is no longer a bare `Pick` of the engine's
report. It is now:

```ts
Pick<CompositionReport, "totals" | "dashboard"> & { glance: GlanceBlock }
```

`GlanceBlock` carries these, all of them **derived**: the Reserve floor in
force on that anchor (a policy percentage from the ADR-004 preferences sidecar), a
`feedGap` block of two counts plus the row ids and labels of the instruments whose
mark did not arrive, `suppressed` — a list of the keys whose underlying number
would be wrong and is therefore not rendered — and `venueDark`, naming a venue
that quoted nothing on a day it owed marks, by venue name and weekday.

_This enumeration deliberately states no total. It said "three things" until
`venueDark` made it four, which is a sentence that goes stale on the block's
**growth** rather than on any decision this ADR records — the failure the
amendment note above already names, repeated one level down._

**This does not re-open the blast radius; it stays inside it.** Every item above
is a *derived dashboard value* in the blast-radius paragraph's own terms:
booleans-as-key-names, counts, labels and row ids that `dashboard.sections`
already carries verbatim, and one policy percentage. No stop level, no strategy
tag, no trade history, no prose. The amendment above's two allow-lists both grew
to name the new keys — `ProjectionKeyAllowList` gains `glance`, `glanceFeedGap`
and `glanceMissing`; `projection-payload.test.ts` gains the nine new key paths —
so the closed world is still closed, and a wider block fails exactly the way an
engine growth fails.

**Why a third top-level branch rather than new `DashboardSummary` fields.** The
alternative was to widen an engine type. That drags the TUI along, re-opens "what
may leave the machine" one level *down* (inside a type the engine owns, where the
next increment inherits the growth silently — this amendment's own history), and
makes the engine aware a cloud exists, which `contract.ts` states as the thing it
must never be. A block authored by the projection keeps **the engine's contract at
zero change** and passes the deletion test: delete `glance` and the glance feature
dies; nothing else notices.

**Per-instrument mark dates were considered and rejected.** The obvious way to let
the reader compute `feedGap` itself is `markAsOf?` on every `CompositionRow`. That
ships a per-instrument observation timeline — materially closer to the
`priceJourneys` this ADR's previous amendment dropped on purpose — and it
discloses which instruments are actively traded. So the push computes the
conclusion and ships **the conclusion**: expectation-vs-arrival needs data that
stays on the machine, therefore it is computed on the machine. Freshness, by the
same rule, is **not** on the wire at all — it is the row's own `as_of` against the
wall clock, derived at render time. A test asserts no ISO-date-shaped value
appears anywhere in the payload outside `dashboard.summary.asOf`.

**`COMPOSITION_SNAPSHOT_SCHEMA_VERSION` bumps 2 → 3,** which this ADR already
sanctions: *"a read-model schema change is a re-push, never a data migration."* A
v2 row read by a v3 reader is a clean `status: "stale"` refusal, and the reader
additionally drops off-version rows from the anchor history it now returns — so
the cutover is graceful rather than a flag day: the next daily push writes a v3
row that renders immediately, and leftover v2 rows are simply unresolvable as
references until the backfill upgrades them.

**Unbounded projection history stays accepted.** The reader now returns *every*
anchor, not only the newest — a return-shape widening, not a new query: the SELECT
has always had no `WHERE` and no `LIMIT` and always read full history into memory.
This ADR already calls the projection DB *"a disposable, re-projectable view"*, and
no credential in the system can `DELETE` a projection row (the writer holds
INSERT/UPDATE only), so growth is bounded by re-projection, not by pruning.
Measured: 3,093 bytes/row — 28 anchors ≈ 87 KB, a year ≈ 1.1 MB.

**No credential change, no write path, no second route out of the machine.** The
preferences sidecar is a second *local disk read* by the push shell, which this
ADR already sanctions as the privileged reader; a guard test confines
`@numisma/preferences` to `apps/web/src/push/` so no render surface can reach it.
ADR-011's posture is untouched.

## Third amendment: a fourth `dca` branch, and declared rung prices leave the machine deliberately

_Amended 2026-08-10, while building increment two of the DCA tracker — the `dca` wire and the
web surface (spec #277; slices #278 the pure builder, #279 the atomic cutover, #280 the surface,
#281 this amendment). Synthesis of `~/Dev/notes/numisma/2026-08-10-dca-web-surface-grill.md`
(D1–D9). **Filed in the same PR that makes it necessary**, for the reason the amendment above
gives for its own timing: that amendment names the pushed payload **literally**, and the sentence
naming it goes stale the day this lands. Landing this in a later PR would leave `main` carrying an
ADR that flatly misdescribes the wire — which is the failure mode the FIRST amendment exists to
punish. This is also the first amendment to REOPEN a blast-radius call rather than narrow one, and
the amendment above promised exactly that: "the blast-radius call is re-made at that moment,
deliberately — not inherited silently the way it was this time." It is being kept here._

**What changed.** The payload gains a fourth top-level branch. It is now:

```ts
Pick<CompositionReport, "totals" | "dashboard"> & { glance: GlanceBlock; dca: DcaBlock }
```

**The equation in the amendment above is superseded by this one** — the same way that amendment
superseded the bare `Pick` before it. `DcaBlock` is authored by the projection, not the engine
(the `glance` precedent, and the same deletion test: delete `dca` and the DCA feature dies,
nothing else notices). It carries three things:

- **`source`** — `"loaded" | "unreadable"`, the whole-file outcome of the sidecar read, mapped
  1:1 out of `loadPlans`'s two-arm `load` result (its `"load-failed"` arm becomes `"unreadable"`;
  the loader's own spelling stays off the wire). Without this field a read failure renders as
  "no plans" — the exact lie the engine names at `packages/engine/src/plans.ts:289-292` —
  because with zero rows enumerable there is no per-row discriminant left to carry it.
- **`positions`** — a `DcaPositionRow[]`, one row per position the sidecar names, each carrying
  `{ positionId, state }` with `kind` and `rungs` present only where they mean something. `state`
  is `pending | active | ended | unreadable`, projected out of `listPlansAsOf`'s `PlanLookup`;
  `kind` is `dcaLadder | dcaTime` and appears on `pending`/`active` rows only; `rungs` is a
  `DcaWireRung[]` and appears on `pending`/`active` `dcaLadder` rows only. `DcaWireRung` is
  deliberately NOT the engine's `DcaRung` (`{ id, priceUsd, sizeUsd }`) — that shape stays off
  the wire whole; the wire rung carries `priceUsd` and nothing else.
- **`unattributable`** — a count.

**Rung prices leave the machine. This amendment owns that, and does not slip it past.** ADR-006
saw the tension coming and wrote it down while arguing why `orders.jsonl` is tracked at all:

> A resting ladder is at least as revealing as the log it sits beside (ADR-007 bars stop levels
> from leaving the machine, and rung prices are that shape); it is tracked **anyway**, because
> sensitivity governs *where* the history lives, and durability governs *whether* there is one.

That observation is correct and this amendment resolves it on ADR-007's side, inside the
blast-radius paragraph's own terms rather than around them:

- **The declared intent IS the card's content.** The first amendment's `invalidationWatch` case
  was a leak riding on a feature nobody asked for: stop levels shipped because the push serialized
  a type that grew, and no surface rendered them. Here the price axis is not a passenger — a
  ladder with its prices removed is a card that says "8 rungs" and answers nothing. The whole
  question the surface exists to answer is *at what prices am I committed to buy*.
- **It is INTENT, not a forced exit.** An invalidation level discloses the price at which the
  operator is forced out, and the first amendment's argument is that positions plus that price are
  a materially more useful pair than either alone — an adversary reading it learns where to push.
  A DCA rung is the opposite side of the same axis: a standing declaration to ACQUIRE more, below
  spot, which an adversary cannot turn against the operator by triggering it. The rungs are also
  already resting at the venue, visible to it.
- **The posture is single-tenant** (ADR-011): one account, one operator, genuine auth on a public
  endpoint, no second tenant to leak across. The blast-radius paragraph's worst case is unchanged
  in KIND — a read-model snapshot leaks derived values — and grows by one axis of declared
  intent.
- **No real rung price reaches the public repo.** `apps/web/src/push/fixture-synthesis.ts` gains a
  rule putting rung `priceUsd` under the magnitudes treatment: values are SYNTHESIZED, structure
  and states and counts stay verbatim. This repository is public; the committed fixture is the
  only place payload shape is readable without a credential, and it now carries the shape without
  the numbers.
- **What still does not leave.** `sizeUsd` stays off the wire — a capital figure with no
  phone-glance use, and omitting it halves the sanitization surface. So do the plan's prose
  `reason`, its `effectiveAt`, the per-line skip detail, and every fold diagnostic. The rungs ship
  as `priceUsd` alone.

**This AMENDS the "not stop levels" sentence, and says so.** The first amendment closes with:
*"the cloud again holds only derived dashboard values, not stop levels, strategy tags, or trade
history."* Read as a claim about invalidation levels, strategy tags and the closed book, that
sentence stands exactly as written and nothing here weakens it: `invalidationWatch`, `strategy`,
`closedBook` and `priceJourneys` are still barred, still caught by both allow-lists, still absent.
Read as a claim about *price levels as a class*, it is now amended: **declared DCA entry rungs
ship, deliberately, as of this amendment.** Stating that here rather than quietly widening the
wire is the whole point — the first amendment's lesson is that this ADR "became wrong through
nobody being told," and an ADR whose body contradicts its own amendment reproduces that failure
one document inward.

**Both allow-lists grow again, and a third latch appears.** The enumeration in the amendment above
(`ProjectionKeyAllowList` gains `glance`, `glanceFeedGap`, `glanceMissing`; the payload test gains
nine key paths) is superseded by this one:

- `ProjectionKeyAllowList` in `apps/web/src/projection/contract.ts` gains
  `Assert<KeysAreExactly<…>>` entries for `DcaBlock`, `DcaPositionRow` and `DcaWireRung`.
- `apps/web/src/push/projection-payload.test.ts` gains the `$.dca…` key paths, and its three
  sorted-key latches become `["dashboard","dca","glance","totals"]`.
- **New:** a top-level `Assert<KeysAreExactly<…>>` over `keyof ProjectionReport` itself. This is a
  guard this ADR has never been able to name, because it did not exist — until this increment a
  fourth top-level branch tripped no compile-time assert at all, only the runtime latches. Both
  previous amendments grew the allow-lists *under* `totals`, `dashboard` and `glance` while the
  branch set itself sat unguarded at compile time. It is guarded now.

The closed world is still closed on both sides of the compile/runtime line, and a wider block
fails the same way an engine growth fails.

**`COMPOSITION_SNAPSHOT_SCHEMA_VERSION` bumps 3 → 4.** The pin in the amendment above ("bumps
2 → 3") is superseded. The doctrine underneath is unchanged and is this ADR's own: *"a read-model
schema change is a re-push, never a data migration"* — bump, re-fold, re-push, deploy. A v3 row
read by a v4 reader is a clean `status: "stale"` refusal, and off-version rows are dropped out of
the anchor history, so the cutover is the same graceful one v3 had. It is a v4 rather than
additive growth because the version-history note's C5 carve-outs cover optional fields inside
existing branches, not a new top-level branch. The window is deploy → `pnpm backfill`, upsert-only
(every existing row overwritten in place at v4, row count unchanged), minutes long,
operator-controlled, entered green.

**Degrade the branch, never the anchor.** A sidecar that cannot be read must not cost the phone
its NAV. `source: "unreadable"` and `state: "unreadable"` are how a broken read reaches the
surface: the anchor still pushes, `totals`, `dashboard` and `glance` still render, and the DCA
card alone says it cannot see. **The rejected alternative was refuse-to-publish** (grill D5) —
fail the push when plans cannot be read, so no half-true anchor exists. Rejected: it makes an
optional, additive card able to blank the fund view, which inverts this ADR's ordering of what
matters, and it converts a corrupt line in a hand-authored file into a lost anchor that no later
repair can recover. Degrading the branch keeps the failure proportional to what failed.

**Three invariants restated, because this branch was the obvious place to break each.**

- **`unattributable` is a COUNT, never the content.** The lines it counts are corrupt text out of
  a hand-authored file and could contain anything; the number is the whole conclusion the phone
  can act on. Same scalar discipline the amendment above records, and the same rule that places
  `state` on the wire: ship the conclusion, not the inputs.
- **`none` is ABSENT.** A position the sidecar does not cover produces no row at all — omission is
  the encoding, and the `"none"` spelling never appears on the wire. A row's existence therefore
  means "the file says something about this position," which is a fact the reader can use.
- **The branch is DATE-FREE.** Not one date-shaped value enters it: `effectiveAt` stays a desk
  fact, readable by `pnpm plans` and nowhere else. So the no-date invariant recorded above —
  *no ISO-date-shaped value appears anywhere in the payload outside `dashboard.summary.asOf`* —
  survives byte-intact, along with the two tests that pin it and the committed fixture's
  anchor-dates-only rule.

**No credential change, no write path, no second route out of the machine.** The plans sidecar is
a third *local disk read* by the push shell — the privileged reader this ADR already sanctions —
selected as-of each anchor's own date, so historical backfill resolves plans honestly rather than
stamping today's ladder onto last month. A third import guard confines the plans symbols to
`apps/web/src/push/`, the way the preferences guard confines its own. ADR-011's posture is
untouched.
