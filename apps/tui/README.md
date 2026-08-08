# @numisma/tui

The terminal surface for the Fund Composition dashboard — the product's first
coherence signal ("What is my Fund composed of right now?").

It is also the access-surface half of the event-sourcing spine
([ADR-003](../../context/adr/ADR-003-event-log-genesis-fold-persistence.md)): the
durable file IO — inbox detection, validated ingest, dedup, atomic append,
archive, and quarantine — lives here, while the pure fold and event validation
stay in `@numisma/engine`. The write/ingest half of the event log stays here
(`event-store.ts`); the read path (path resolution, genesis load, log load with
quarantine, `loadFoldedReview`) lives in [`@numisma/event-store`](../../packages/event-store).

It also hosts the `Order` CLIs — the access surface for
[ADR-013](../../context/adr/ADR-013-order-a-claim-on-capital-recorded-beside-the-log.md)'s
`Order`, "a claim on capital that has not yet become a transaction," recorded in
a third durable artifact, `data/orders.jsonl`, **beside** the event log, never
in it, and joined to the fold at read time. The sidecar's own read/write IO
(`resolveOrdersPath`, `loadOrders`, `appendOrders`) lives in
[`@numisma/preferences`](../../packages/preferences), alongside the general
preferences sidecar — this package only wires that IO to its three interactive
flows (`import-orders.ts`, `record-fill.ts`, `cancel-order.ts`) through the CLI
entries below.

## Entry points

Every entry point below is a source file under `src/`; the `pnpm` name is the
root-level script from the repo's `package.json` (all of them delegate to
`apps/tui/src/*` via `tsx` or `bun`, not to a script inside this package's own
`package.json`, which only defines `dev`, `report`, `smoke:tui`, `typecheck`).

| `pnpm` script | Entry file | Read-only? | What it does |
| --- | --- | --- | --- |
| `dev` | `app.ts` | no (ingests inbox) | Bun openTUI dashboard: `prepareStartup` (ingest → fold) then `mountApp`. |
| `report` | `report.ts` | yes | Folds genesis + log and prints the composition report. Never ingests. |
| `spine` | `spine.ts` | no (ingests inbox) | Node tracer: ingest → fold (`--as-of <date>`, optional) → render. `--magnitude-threshold=<n>` / `SPINE_MAGNITUDE_THRESHOLD` opts into a wider fat-finger guard for one run. |
| `spine:reset` | `spine-reset.ts` | no (destructive, guarded) | Deletes `events.jsonl` and restores the latest archived inbox. Refuses on the default `<fund>` `dataDir`; needs an explicit `NUMISMA_DATA_DIR`. |
| `migrate:log` | `migrate-legacy-log.ts` | no (rewrites the log) | One-shot ADR-003 v2 cash-leg migration from an operator-authored `data/migration-cash-legs.json`. Fails loud, writes nothing on any invalid/missing leg. |
| `orders:import <csv>` | `import-orders-cli.ts` | no (appends orders) | Interactive `<exchange>` open-orders import into `orders.jsonl`. Never touches the event log. Exit 0 on `imported-partial` (ADR-014). |
| `orders:fill` | `record-fill-cli.ts` | no (appends orders + log) | Interactive fill recording: retires the claim in `orders.jsonl` and appends the resulting transaction to `events.jsonl`. |
| `orders:cancel <orderId> [observedAt]` | `cancel-order-cli.ts` | no (appends orders) | Scriptable (argv-only, no prompt) retirement of one resting rung in `orders.jsonl`. Never touches the event log. |
| `smoke:tui` | `smoke-openTui.ts` | yes (in-memory) | Bun keypress smoke against a synthetic fund review; no disk IO. |
| `smoke:startup` | `smoke-startup-openTui.ts` | no (builds a temp on-disk store) | Bun startup smoke: drives `prepareStartup` + `mountApp` through the real renderer against a temp-dir event store. |

## Node / Bun split

The package is deliberately layered so that the interaction logic is testable
under Node while the terminal glue stays isolated in a Bun-only layer.

**Node-runnable (instrumented by coverage):**

- `interaction-core.ts` — the pure, openTUI-free interaction core: selection
  normalization, next-selectable wrapping, the move + drill-down reducer, the
  key→intent mapper, cursor-glyph rendering, viewport scroll math, and the
  reload-outcome decision. Directly unit-tested in `interaction-core.test.ts`.
- `dashboard.ts` — the `DashboardLine`/`DashboardAction` line model the reducer
  consumes (`dashboard.test.ts`).
- `review-file.ts` — fund-review path resolution and loading
  (`review-file.test.ts`). Kept for the fold↔snapshot parity check; no longer on
  the `pnpm dev` / `pnpm report` path, which read the event store.
- `event-store.ts` — the write/ingest half of the durable event-store IO: the
  validated ingest boundary (dedup / atomic append / archive), legacy-log
  migration, inbox archival, magnitude-threshold env plumbing, and
  `parseAsOfArg`. The read path — path resolution, genesis load, log load with
  quarantine, and `loadFoldedReview` — was lifted out into
  [`@numisma/event-store`](../../packages/event-store) so `apps/web`'s push can
  fold the durable log without depending on the TUI. The reliability core
  (`event-store.test.ts`; the read path's own unit tests live in the package's
  `event-store.test.ts`).
- `startup.ts` — `prepareStartup`, the data path that runs before the renderer
  (`--as-of` → ingest → surface report → fold), shared by `app.ts` and the
  openTUI verification harness (`startup.test.ts`).
- `import-orders-cli.ts`, `record-fill-cli.ts`, `cancel-order-cli.ts`,
  `migrate-legacy-log.ts` — the four orders/migration CLI entries. These run
  under Node (`tsx`), so unlike the Bun-only wiring below they are **not**
  excluded from `vitest.config.ts`'s coverage `include` — they count toward the
  measured number even though each is thin argv/readline wiring with no direct
  unit test of its own (the flows they bind — `import-orders.ts`,
  `record-fill.ts`, `cancel-order.ts`, and `event-store.ts`'s
  `migrateLegacyLog` — are the tested units).

**Excluded from the coverage number (scripts + Bun-only wiring):**

- `report.ts` — the `tsx` CLI report entry (`pnpm report`). A thin script: a
  top-level `try/catch` that folds genesis + log (`loadFoldedReview`) and renders
  the already-tested composition report — no unit to assert. Read-only; it never
  ingests.
- `spine.ts` — the `tsx` Node tracer (`pnpm spine`): ingest → fold → render,
  orchestrating already-tested `event-store`/engine functions. Prints ingest
  counts, then the composition report as of `--as-of <date>` (or current state).
  Accepts an opt-in `--magnitude-threshold=<n>` (or `SPINE_MAGNITUDE_THRESHOLD`)
  to raise the ±50% fat-finger guard for one run; every override announces
  itself on stderr. Ingests the inbox — not read-only.
- `spine-reset.ts` — the `tsx` iteration helper (`pnpm spine:reset`): deletes the
  append-only log and, if the inbox is already gone, restores the most recent
  archived inbox so it can be re-folded. Genesis is untouched; idempotent. Refuses
  to run when the resolved `dataDir` is the default `<fund>` sibling repo — it
  requires an explicit, non-default `NUMISMA_DATA_DIR` — so it cannot delete the
  real durable log. Destructive within its guarded scope, not read-only.
- `app.ts` — the self-executing `pnpm dev` entry: path resolution, `prepareStartup`,
  openTUI renderer construction, fail-fast/exit codes, then `mountApp`. Also
  resolves the orders sidecar path and wires `loadAvailableCapital` so the
  dashboard joins `orders.jsonl` to the fold at read time (never merged).
- `mount-app.ts` — the openTUI-coupled wiring: renderable construction, keypress
  subscription, `dashboard.content` writes, and `requestRender`. Holds the
  `@opentui/core` import and the engine calls (`buildDashboardDetail`,
  `buildDashboardLines`) whose results are passed into the pure core.
- `smoke-openTui.ts` — the keypress Bun smoke (`pnpm smoke:tui`): drives real
  `j`/`k`/`enter` through `mountApp` against a synthetic in-memory fund review
  and asserts the cursor moved and a detail row rendered. Does not touch disk.
- `smoke-startup-openTui.ts` — the startup Bun smoke (`pnpm smoke:startup`):
  drives `prepareStartup` + `mountApp` through the real openTUI renderer against
  an on-disk event store built in a temp dir, and asserts the five `pnpm spine`
  targets on the rendered surface (ingest counts, mutated current state, two
  as-of snapshots, tracer-parity fund value, byte-identical restart survival).

The openTUI files run under Bun against the real renderer and never execute under
Node's `vitest run`, so instrumenting them would only report dead 0% and make the
percentage dishonest; the `tsx` script entries (`report.ts`, `spine.ts`,
`spine-reset.ts`) are top-level orchestration with no unit to assert. All are
excluded from the coverage `include` in `vitest.config.ts`, and the exclusion
(plus every remaining uncovered line) is accounted for concretely in
[`docs/coverage-rationale.md`](../../docs/coverage-rationale.md).

## Coverage

Run `pnpm coverage` (from the repo root) for the measured Node-side number. The
reported percentage covers the Node-runnable code listed above; it is **not**
"100% of everything" — the Bun-only `mountApp` wiring is excluded by design.

That wiring is guarded instead by two openTUI smokes against the real test
renderer: the keypress smoke (`pnpm smoke:tui`) drives real `j`/`k`/`enter`
through `mountApp` and asserts the cursor moved and a detail row rendered, and the
startup smoke (`pnpm smoke:startup`) drives the real `prepareStartup` + `mountApp`
against an on-disk event store and asserts the spine targets on the rendered
surface (ingest counts, mutated current state, two as-of snapshots, tracer-parity
fund value, byte-identical restart survival). The measured number replaces the
prior "all the codebase is reliable" inference from reading. No coverage threshold
or CI gate is enforced.

Everything the number does **not** cover — the excluded scripts/wiring above,
and the defensive/unreachable guards — is accounted for line-by-line in
[`docs/coverage-rationale.md`](../../docs/coverage-rationale.md), so no gap is
silent.

## Decision record: interaction-core / mountApp split (no ADR)

The split between the pure `interaction-core` and the openTUI-coupled `mountApp`
wiring is recorded here, not as an ADR. Under ADR-001 (package boundary and
runtime split) it is unsurprising and weakly reversible: the openTUI/Bun coupling
stays isolated to `mountApp`, and a pure Node-consumable core emerges below it —
exactly the "future access surfaces reuse the engine without terminal coupling"
posture ADR-001 already establishes. It is a real trade-off but not a hard one to
reverse, so it does not qualify for an ADR.

The one open question that *would* qualify for an ADR: whether interactive/
selection state should eventually live in `@numisma/engine` rather than
`@numisma/tui`. If that surfaces as a genuine trade-off, it earns an ADR;
until then, this note stands.
