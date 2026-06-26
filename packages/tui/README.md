# @numisma/tui

The terminal surface for the Fund Composition dashboard — the product's first
coherence signal ("What is my Fund composed of right now?").

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
- `review-file.ts` — fund-review path resolution and loading (`review-file.test.ts`).

**Excluded from the coverage number (scripts + Bun-only wiring):**

- `report.ts` — the `tsx` CLI report entry (`pnpm report`). A thin script: a
  top-level `try/catch` orchestrating already-tested engine/review functions, no
  unit to assert. Its constituent functions are unit-tested directly.
- `app.ts` — the self-executing `pnpm dev` entry: path resolution, openTUI
  renderer construction, fail-fast/exit codes, then `mountApp`.
- `mount-app.ts` — the openTUI-coupled wiring: renderable construction, keypress
  subscription, `dashboard.content` writes, and `requestRender`. Holds the
  `@opentui/core` import and the engine calls (`buildDashboardDetail`,
  `buildDashboardLines`) whose results are passed into the pure core.
- `smoke-openTui.ts` — the Bun smoke (`pnpm smoke:tui`).

The openTUI files run under Bun against the real renderer and never execute under
Node's `vitest run`, so instrumenting them would only report dead 0% and make the
percentage dishonest; `report.ts` is a script entry with no unit to assert. All
four are excluded from the coverage `include` in `vitest.config.ts`, and the
exclusion (plus every remaining uncovered line) is accounted for concretely in
[`docs/coverage-rationale.md`](../../docs/coverage-rationale.md).

## Coverage

Run `pnpm coverage` (from the repo root) for the measured Node-side number. The
reported percentage covers the Node-runnable code listed above; it is **not**
"100% of everything" — the Bun-only `mountApp` wiring is excluded by design.

That wiring is guarded instead by the keypress smoke (`pnpm smoke:tui`), which
drives real `j`/`k`/`enter` keypresses through `mountApp` and the real openTUI
test renderer and asserts the cursor moved and a detail row rendered. The
measured number replaces the prior "all the codebase is reliable" inference from
reading. No coverage threshold or CI gate is enforced.

Everything the number does **not** cover — the excluded scripts/wiring above,
the defensive/unreachable guards, and the real behavior still deferred (tracked
in [#72](https://github.com/AmetAlvirde/numisma/issues/72)) — is accounted for
line-by-line in [`docs/coverage-rationale.md`](../../docs/coverage-rationale.md),
so no gap is silent.

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
