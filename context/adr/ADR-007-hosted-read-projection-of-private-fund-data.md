# Hosted read-projection of private fund data

_Made during: MVI — web-app leg discovery / 2026-07-07 maps + grills
(`~/Dev/notes/numisma/2026-07-07-webapp-audience-grill`,
`2026-07-07-webapp-projection-grill`, build-map node 5 / ADR-007) — no PRD issue
yet; ratified as **the gate** that freezes the regime before any real fund data
leaves the local machine and a tracer slice is sliced against it._
_Scope: product_
_Status: accepted (amended 2026-07-24 — see "Amendment: payload narrowed to restore the blast-radius paragraph"; amended again 2026-07-27 — see "Amendment: a third `glance` branch, and the payload stops being a bare `Pick`" — both below)_

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

`GlanceBlock` carries three things, all of them **derived**: the Reserve floor in
force on that anchor (a policy percentage from the ADR-004 preferences sidecar), a
`feedGap` block of two counts plus the row ids and labels of the instruments whose
mark did not arrive, and `suppressed` — a list of the keys whose underlying number
would be wrong and is therefore not rendered.

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
