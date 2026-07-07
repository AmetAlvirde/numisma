# Hosted read-projection of private fund data

_Made during: MVI — web-app leg discovery / 2026-07-07 maps + grills
(`~/Dev/notes/numisma/2026-07-07-webapp-audience-grill`,
`2026-07-07-webapp-projection-grill`, build-map node 5 / ADR-007) — no PRD issue
yet; ratified as **the gate** that freezes the regime before any real fund data
leaves the local machine and a tracer slice is sliced against it._
_Scope: product_
_Status: accepted_

The web-app leg places a **read-only projection of private fund data** (positions,
portfolio/fund USD values, realized/unrealized P&L) in an **internet-reachable,
cloud-hosted database** — the first time real portfolio data leaves the local
machine and the private `accumulus` sibling repo (ADR-006). This ADR **permits
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
