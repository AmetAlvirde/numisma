# Numisma

Numisma builds a canonical Fund composition read model from a local Fund review
file and renders it for review — both as a one-shot text report and as an
interactive terminal dashboard.

## Architecture

A private pnpm workspace (`packages/*`) split along a runtime boundary
([ADR-001](./context/adr/ADR-001-package-boundary-and-runtime-split.md)):

| Package                                          | Runtime                         | Owns                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@numisma/engine`](./packages/engine/README.md) | Node-compatible, no Bun/openTUI | Parsing the review file, building the `CompositionReport` read model, and the shared formatters. The reusable domain.                                                 |
| `@numisma/tui`                                   | Bun + openTUI                   | The local access surface: review-file path resolution and loading, the interactive dashboard, and smoke rendering. Consumes the engine through its package root only. |

The engine is decomposed into concern-sized modules (contracts, an internal
kernel, parse, compose, price-journey, format) behind a curated `index.ts`; see
its [README](./packages/engine/README.md) for the module layout and public
surface.

### Scripts

Root scripts own the user-facing commands and stay stable across internal
refactors:

| Script           | What it does                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`       | Run the interactive openTUI dashboard (Bun).                                                                 |
| `pnpm report`    | Print the one-shot text composition report (tsx).                                                            |
| `pnpm smoke:tui` | Headless openTUI smoke render.                                                                               |
| `pnpm typecheck` | Typecheck both packages — the guard for the engine's public surface and the no-deep-import boundary.         |
| `pnpm test`      | Run the full Vitest suite, including characterization snapshots and the engine↔TUI formatter contract test. |

`pnpm dev` and `pnpm report` accept a fund-review file via the resolution order
below.

## Local Fund Review Data

Fund review JSON is local-only and not tracked in git.

Resolution order:

1. `--file /path/to/review.json`
2. A single bare positional `.json` path, for compatibility
3. `NUMISMA_FUND_REVIEW_FILE=/path/to/review.json`
4. `data/fund-review.local.json`

Default local file:

- `data/fund-review.local.json` via `data/.gitignore`

You can also provide a file explicitly:

- `pnpm report -- --file /path/to/review.json`
- `pnpm dev -- --file /path/to/review.json`

Or through an environment variable:

- `NUMISMA_FUND_REVIEW_FILE=/path/to/review.json pnpm report`

If more than one bare positional `.json` path is provided, Numisma exits with a
clear error and asks you to use `--file`.

If `--file` is provided without a value, Numisma exits with a clear error rather
than silently falling back to another path.

The repo intentionally does not ship real or sample portfolio data.
