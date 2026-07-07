# @numisma/tui

The terminal surface for the Fund Composition dashboard — the product's first
coherence signal ("What is my Fund composed of right now?").

It is also the access-surface half of the event-sourcing spine
([ADR-003](../../context/adr/ADR-003-event-log-genesis-fold-persistence.md)): the
durable file IO — inbox detection, validated ingest, dedup, atomic append,
archive, and quarantine — lives here, while the pure fold and event validation
stay in `@numisma/engine`.

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
- `event-store.ts` — the durable event-store IO: path resolution, genesis load,
  log load with quarantine, the validated ingest boundary (dedup / atomic append
  / archive), and `loadFoldedReview`. The reliability core
  (`event-store.test.ts`).
- `startup.ts` — `prepareStartup`, the data path that runs before the renderer
  (`--as-of` → ingest → surface report → fold), shared by `app.ts` and the
  openTUI verification harness (`startup.test.ts`).

**Excluded from the coverage number (scripts + Bun-only wiring):**

- `report.ts` — the `tsx` CLI report entry (`pnpm report`). A thin script: a
  top-level `try/catch` that folds genesis + log (`loadFoldedReview`) and renders
  the already-tested composition report — no unit to assert. Read-only; it never
  ingests.
- `spine.ts` — the `tsx` Node tracer (`pnpm spine`): ingest → fold → render,
  orchestrating already-tested `event-store`/engine functions.
- `spine-reset.ts` — the `tsx` iteration helper (`pnpm spine:reset`): clear the
  log and restore the most recent archived inbox. A dev utility, no unit to assert.
- `app.ts` — the self-executing `pnpm dev` entry: path resolution, `prepareStartup`,
  openTUI renderer construction, fail-fast/exit codes, then `mountApp`.
- `mount-app.ts` — the openTUI-coupled wiring: renderable construction, keypress
  subscription, `dashboard.content` writes, and `requestRender`. Holds the
  `@opentui/core` import and the engine calls (`buildDashboardDetail`,
  `buildDashboardLines`) whose results are passed into the pure core.
- `smoke-openTui.ts` — the keypress Bun smoke (`pnpm smoke:tui`).
- `smoke-startup-openTui.ts` — the startup Bun smoke (`pnpm smoke:startup`):
  drives `prepareStartup` + `mountApp` through the real openTUI renderer against
  an on-disk store.

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
