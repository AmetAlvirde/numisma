# Scripts

The full root script reference for the [root README](../README.md). Root
scripts own the user-facing commands and stay stable across internal
refactors.

## Local review and the spine

| Script               | What it does                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Run the interactive openTUI dashboard (Bun). On startup it ingests any dropped inbox, then folds genesis + log to current state (or `--as-of`), joining the orders sidecar at read time.            |
| `pnpm report`        | Print the one-shot text composition report (tsx), rendered from the fold over genesis + log. Read-only — it folds and renders, never ingests.                                                       |
| `pnpm spine`         | Node tracer for the event-sourcing spine (no Bun/openTUI): ingest the inbox (dedup / append / archive), fold to `--as-of` (or current), then render. Accepts `--magnitude-threshold=<n>` (or `SPINE_MAGNITUDE_THRESHOLD`). |
| `pnpm spine:reset`   | Iteration helper: clear the event log and restore the most recent archived inbox so an edited inbox can be re-folded. Genesis is never touched. **Refuses to run against the default `<fund>` dataDir** — requires a non-default `NUMISMA_DATA_DIR`. |
| `pnpm migrate:log`   | One-shot ADR-003 v2 cash-leg migration driven by `migration-cash-legs.json`; rewrites `events.jsonl` in place and fails loud on any invalid or missing leg.                                          |

`pnpm dev`, `pnpm report`, and `pnpm spine` accept an optional `--as-of
<YYYY-MM-DD>` to render the composition as of a prior date; with no flag they
render current state. An `--as-of` earlier than the genesis date fails loud.

## Orders

| Script                            | What it does                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm orders:import <csv>`        | Import a `<exchange>` open-orders CSV export into `orders.jsonl` behind a funding-coverage guard. Never touches the event log; exits 0 on a partial import by design (ADR-014). |
| `pnpm orders:fill`                | Interactive: record a fill — atomically retires the claim in `orders.jsonl` **and** appends the resulting transaction to `events.jsonl`. The only orders command that writes the log. |
| `pnpm orders:cancel <orderId> [YYYY-MM-DDTHH:MM:SS]` | Retire one resting rung in `orders.jsonl`. Scriptable — the whole assertion is in argv, no readline; never touches the event log.                |

## Plans

| Script        | What it does                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm plans`  | Render the plan sidecar at the desk: per position the state (`none` / `pending` / `active` / `ended` / `unreadable`), the `effectiveAt` selected, and the rung count or cadence and anchor. Accepts `--as-of <YYYY-MM-DD>`. It reads **two** files — the page heads with `Plans — <path>` and `Trail — <path>` — and marks each `active` row against `reconciliations.jsonl`: whether the position's most recent fill agreed with its plan (`!! FILL … DISAGREED`), or why that is unknown (`?? NO TRAIL`, `?? NO TRAIL LINE`, `?? TRAIL UNREADABLE`, `?? PLANS WERE UNREADABLE`). A gap is never rendered as clean. Read-only — it writes neither file and never touches git. It exits 0 only when **both** files loaded and every line in each was readable, so an unreadable trail exits non-zero even with a perfect `plans.jsonl`; any skip on either side prints prose diagnostics that never quote a line of a file. An absent `plans.jsonl` is the normal starting state and exits 0; an absent `reconciliations.jsonl` likewise exits 0, but it says so — after the first recorded fill, absence means the trail write has never succeeded. |

## Market data

| Script              | What it does                                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prices:fetch` | Fetch free market data (crypto via keyless Binance, US equities via Twelve Data, and MXN-listed instruments derived as `USD close × Banxico USD/MXN FIX`) into the disposable price store and queue one `PriceMarked` per instrument per trading day in the inbox; at/after the mark time it also pre-checks each mark against the spine's ±50% guard and exits non-zero on a provider failure or a would-be rejection. Never writes the event log — `pnpm spine` owns the guarded append. |
| `pnpm operator-notice` | Rewrite `operator-notice.txt` beside the durable log from the gap report: the data half of the liveness banner, composed for a shell profile to `cat` on every new terminal. Takes no arguments by design (an unattended step that accepts a date eventually writes the wrong one) and resolves the store through `NUMISMA_DATA_DIR` like every other plane. An empty notice means healthy. Step 5b of the daily wrapper runs it; run it by hand to refresh the banner between scheduled runs. |

## Hosted projection

| Script             | What it does                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm push`        | Fold the local log, narrow it to the ADR-007 allow-listed shape, and upsert one row into `composition_snapshot` via `PROJECTION_WRITE_DATABASE_URL`.             |
| `pnpm backfill`    | Idempotently replay every anchored date in the log into the projection database.                                                                                |
| `pnpm gap-report`  | Report missing days in the event log against a calendar window. No database or env required; exits 0 even when days are lost.                                    |
| `pnpm db:init`     | Apply only the `composition_snapshot` DDL — no fold, no upsert.                                                                                                 |
| `pnpm db:provision`| Idempotent DDL plus the ADR-007 two-role grants, via `PROJECTION_ADMIN_DATABASE_URL`.                                                                           |

## Quality gates

| Script               | What it does                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`     | Typecheck all six workspace members, then the repo tooling (`ops/**` and `vitest.config.ts`) through `tsconfig.ops.json` — the guard for each package's public surface, the no-deep-import boundary, and the test-discovery config nothing else typechecks. |
| `pnpm test`          | Run the full Vitest suite, including characterization snapshots and the engine↔TUI formatter contract test.                                                          |
| `pnpm test:wrapper`  | Run the price-feed wrapper harness on demand, with `NUMISMA_WRAPPER_TEST=always` bypassing the arming trigger (the platform gate still applies). Under `pnpm test` the same suite arms itself only when the trigger says the wrapper is in play; `NUMISMA_WRAPPER_TEST=never` mutes it and says so. |
| `pnpm verify`        | The full gate: `typecheck` → `test` → `smoke:startup`.                                                                                                              |
| `pnpm coverage`      | The measured Node-side coverage number (see [`docs/coverage-rationale.md`](./coverage-rationale.md)).                                                                |
| `pnpm smoke:tui`     | Headless openTUI keypress smoke render (Bun).                                                                                                                       |
| `pnpm smoke:startup` | Bun: drives the real startup data path + `mountApp` through the openTUI test renderer against an on-disk store, asserting the spine targets on the rendered surface. |

The web app additionally carries its own `dev` / `build` / `start` and five
`auth:*` scripts (`auth:generate`, `auth:apply`, `auth:migrate`, `auth:seed`,
`auth:verify-limit`), scoped to `apps/web` rather than hoisted to the root.
`push` / `backfill` / `gap-report` / `db:init` / `db:provision` / `typecheck`
are NOT web-only — the root aliases above (`apps/web/package.json` also
carries package-scoped copies for `pnpm --filter @numisma/web run <script>`
use). See [its README](../apps/web/README.md).
