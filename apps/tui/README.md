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
`data/orders.jsonl` — a durable artifact **beside** the event log, never
in it, and joined to the fold at read time. (ADR-013 calls it *the third*
durable artifact; that count starts at `events.jsonl`. On ADR-004's
sidecar-class axis, which excludes the log, it is the second. Say which count
you mean.) The sidecar's own read/write IO
(`resolveOrdersPath`, `loadOrders`, `appendOrders`) lives in
[`@numisma/preferences`](../../packages/preferences), alongside the general
preferences sidecar and the `plans.jsonl` / `reconciliations.jsonl` loaders — this
package only wires that IO to its three order flows (`import-orders.ts`,
`record-fill.ts`, `cancel-order.ts`) through the CLI entries below. Two of the
three interview the operator; `cancel-order.ts` takes its whole assertion from
argv so it stays scriptable.

## Entry points

Every entry point below is a source file under `src/`; the `pnpm` name is the
root-level script from the repo's `package.json` (all of them delegate to
`apps/tui/src/*` via `tsx` or `bun`, not to a script inside this package's own
`package.json`, which only defines `dev`, `report`, `smoke:tui`, `typecheck`).

| `pnpm` script | Entry file | Read-only? | What it does |
| --- | --- | --- | --- |
| `dev` | `app.ts` | no (ingests inbox) | Bun openTUI dashboard: `prepareStartup` (ingest → fold) then `mountApp`. |
| `report` | `report.ts` | yes | Folds genesis + log and prints the composition report. Never ingests. Enumerates every event the fold discarded on stderr, before the report. |
| `spine` | `spine.ts` | no (ingests inbox) | Node tracer: ingest → fold (`--as-of <date>`, optional) → render, with the same stderr enumeration of the fold's discards. `--magnitude-threshold=<n>` / `SPINE_MAGNITUDE_THRESHOLD` opts into a wider fat-finger guard for one run. |
| `plans` | `plans-cli.ts` | no (the fold's read maintains the log's quarantine lane) | Desk command over `plans.jsonl`: renders each declared position's state as of `--as-of <date>` (or today in the fund's timezone), annotates an `active` row from the `reconciliations.jsonl` trail, and exits 1 if either file skipped a line. See [`docs/plans-authoring-runbook.md`](../../docs/plans-authoring-runbook.md). |
| `spine:reset` | `spine-reset.ts` | no (destructive, guarded) | Deletes `events.jsonl` and restores the latest archived inbox. Refuses on the default `<fund>` `dataDir`; needs an explicit `NUMISMA_DATA_DIR`. |
| `migrate:log` | `migrate-legacy-log.ts` | no (rewrites the log) | One-shot ADR-003 v2 cash-leg migration from an operator-authored `data/migration-cash-legs.json`. Fails loud, writes nothing on any invalid/missing leg. A log with nothing in it to migrate — absent, empty, or blank lines only — reports zero and touches no disk (#345). |
| `orders:import <csv>` | `import-orders-cli.ts` | no (appends orders) | Interactive `<exchange>` open-orders import into `orders.jsonl`. Never touches the event log. Exit 0 on `imported-partial` (ADR-014). |
| `orders:fill` | `record-fill-cli.ts` | no (appends orders + log + trail) | Interactive fill recording: retires the claim in `orders.jsonl`, appends the resulting transaction to `events.jsonl`, and reconciles the fill against the `plans.jsonl` line that claims the position, appending the verdict to `reconciliations.jsonl`. |
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
  migration, and inbox archival. Argv/env parsing (`parseAsOfArg`,
  `parseMagnitudeThresholdArg`) was extracted to `spine-args.ts` (finding 35),
  so this module keeps durable-log responsibilities only. The read path — path
  resolution, genesis load, log load with
  quarantine, and `loadFoldedReview` — was lifted out into
  [`@numisma/event-store`](../../packages/event-store) so `apps/web`'s push can
  fold the durable log without depending on the TUI. The reliability core
  (`event-store.test.ts`; the read path's own unit tests live in the package's
  `event-store.test.ts`).
- `startup.ts` — `prepareStartup`, the data path that runs before the renderer
  (`--as-of` → ingest → surface report → fold), shared by `app.ts` and the
  openTUI verification harness (`startup.test.ts`). Its `loadData` thunk returns
  the fold's whole `{data, skipped}` envelope; the renderer takes `.data` at the
  composition root, because a thunk typed as bare `FundReviewData` hands its
  consumer a fold indistinguishable from one taken over a complete log. The
  `livenessLines` and `foldLines` seams are both optional with **no default** —
  omitted means silent — and only `pnpm dev` supplies either, because only
  `pnpm dev` hands the terminal to a renderer and has nowhere else to say it.
- `prompt-channel.ts` — the one place a shell's readline lifecycle and its
  no-terminal refusal live, shared by `import-orders-cli.ts` and
  `record-fill-cli.ts` (`prompt-channel.test.ts`). It builds the interface at
  the first question rather than at startup, writes its no-terminal notice once
  per run, and resolves an `UNANSWERED` sentinel — a symbol no operator can type
  — for a question it could not put or that the operator aborted, so the flow
  reaches its own refusal instead of the shell printing a readline internal.

**Excluded from the coverage number (orders/migration CLI shells):**

- `import-orders-cli.ts`, `record-fill-cli.ts`, `cancel-order-cli.ts`,
  `migrate-legacy-log.ts` — the four orders/migration CLI entries. These run
  under Node (`tsx`), but `vitest.config.ts` excludes all four from coverage
  `include` — not for thinness alone but because **importing the shell runs the
  act**: each is a self-executing entry (top-level await / a `main()` that
  calls itself) binding the real fs and the real data dir to a flow module —
  plus a real readline prompt in the two shells that interview
  (`import-orders-cli.ts`, `record-fill-cli.ts`, both through the shared
  `prompt-channel.ts`; `cancel-order-cli.ts` is deliberately promptless so it
  stays scriptable, and the migration takes only argv) — so a test cannot load
  one to assert it without performing a
  real import, a real fill, a real cancel, or a real in-place rewrite of the
  durable log (`record-fill-cli.ts` says so in its own header). The flows they
  bind — `import-orders.ts`, `record-fill.ts`, `cancel-order.ts`, and
  `event-store.ts`'s `migrateLegacyLog` — are the tested units and DO count
  toward the measured number.

  **Excluded is not untested. All four now have a spawn suite**, each driving
  the real shell via `spawnSync(tsx, …)` against a throwaway `mkdtemp` data dir
  and asserting only what the shell itself owns — argv, the env-to-path
  plumbing, the exit-code mapping, the prompt lifecycle — never re-testing the
  flow's refusal taxonomy: `record-fill-cli.test.ts` (the shell pairs
  `loadEventLog` with `assertLogFullyLoaded`, so a partial log cannot reach
  `recordFill`), `import-orders-cli.test.ts` (the usage branch, the three-way
  exit-code mapping, and the `imported-partial` → 0 branch ADR-014 argues for),
  `cancel-order-cli.test.ts` (the positional `observedAt` mapping and the
  stated no-TTY contract), and `migrate-legacy-log.test.ts` (the mapping read,
  the two stdout sentences and the `touched === 0` boundary). v8 still cannot
  instrument a spawned subprocess, so all four stay out of the coverage number.
  `plans-cli.ts` is the one shell in `apps/tui` with no driver at all. Across
  the repo it is one of two, beside `apps/price-feed/src/operator-notice-cli.ts`.
  See `docs/coverage-rationale.md` §1.

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
- `plans-cli.ts` — the `tsx` plans entry (`pnpm plans`): a top-level `try/catch`
  that resolves the fold, the `plans.jsonl` sidecar and the `reconciliations.jsonl`
  trail, hands all three to the tested `formatPlansReport` and sets the exit code.
  Not read-only either — the fold it takes carries the event log's write-on-read
  quarantine maintenance, which its own header names — so importing it to assert
  it would run the act. No spawn test today: unlike the four orders/migration
  shells above, nothing in the tree drives this one, so it is excluded from the
  number AND untested by any suite.
- `app.ts` — the self-executing `pnpm dev` entry: path resolution, `prepareStartup`,
  openTUI renderer construction, fail-fast/exit codes, then `mountApp`. Also
  resolves the orders sidecar path and wires `loadAvailableCapital` so the
  dashboard joins `orders.jsonl` to the fold at read time (never merged). It is
  the only entry point that supplies `startup.ts`'s `livenessLines` and
  `foldLines` seams: both write to the pre-alternate-screen channel, because
  once `renderer.start()` opens the alternate screen anything on stderr is
  painted over.
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
`spine-reset.ts`, `plans-cli.ts`) are top-level orchestration with no unit to
assert. All are
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
