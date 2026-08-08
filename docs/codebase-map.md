# Codebase map

An orientation index for someone auditing or joining this repo. Every row says
what a thing owns and what question it answers, so you can go straight to the
file that matters instead of reading the tree.

Numisma is a private pnpm workspace: `packages/*` are imported libraries,
`apps/*` are runnable surfaces, split along a runtime boundary
([ADR-001](../context/adr/ADR-001-package-boundary-and-runtime-split.md)). All
members are versioned together with the monorepo.

## Where the truth lives

The durable source of truth is an append-only **event log** folded over an
immutable **genesis seed**. Everything else — the report, the dashboard, the
hosted projection, the Head Digest — is derived and rebuildable.

The store is **not in this checkout**. It lives in a private sibling repo
(`accumulus`, default `~/Dev/accumulus/data`, overridable with
`NUMISMA_DATA_DIR`), so no trade data is ever in this repository's history
([ADR-006](../context/adr/ADR-006-private-sibling-data-repo-commit-per-ingest.md)).
The layout of that directory is tabulated in the [root README](../README.md)
under *Local data*.

## Packages

| Path | Package | Runtime | What it owns | Read first |
| --- | --- | --- | --- | --- |
| `packages/engine` | `@numisma/engine` | Node, IO-free | The pure fund domain: parse → validate → fold → compose → format, plus the pure half of the price model and the whole Orders model. No file, network, or terminal IO. | `src/index.ts` (curated barrel, no `export *`), `src/events/types.ts` |
| `packages/event-store` | `@numisma/event-store` | Node | The durable log's **read** path — path resolution, genesis load, log load with quarantine, `loadFoldedReview` — plus the gap-report and heartbeat sidecars. | `README.md`, then `src/` |
| `packages/preferences` | `@numisma/preferences` | Node | Sidecar file IO for `preferences.jsonl` and `orders.jsonl`. Append-only, validated on load, cross-process locked for orders. | `README.md` |
| `apps/tui` | `@numisma/tui` | Bun (dashboard) + Node (CLIs) | The local access surface: the log's **write/ingest** half, startup orchestration, the openTUI dashboard, the three Orders CLIs, and the smokes. | `README.md` §Entry points, `src/event-store.ts` |
| `apps/price-feed` | `@numisma/price-feed` | Node, headless | The market-data runtime shell: three provider adapters, the disposable price store, the atomic inbox emit, and the fetch-time spine-guard pre-check. | `README.md`, `src/cli.ts` |
| `apps/web` | `@numisma/web` | TanStack Start (Vite + Nitro), React 19 | The hosted read-projection dashboard, its Better Auth server, and the push/provisioning scripts. | `README.md`, `src/push/push.ts` |

**The dependency rule:** apps depend on packages, never the reverse; packages
depend on `@numisma/engine` and never on each other beyond that. Every consumer
imports through the package root only. `pnpm typecheck` enforces both the public
surfaces and the no-deep-import boundary — it is a real gate, not a formality.

## The two IO boundaries worth understanding first

These are the seams most likely to be misread from the tree alone:

1. **The log's IO is split by direction.** Reads (genesis, log, quarantine) live
   in `@numisma/event-store` and are consumed by *both* the TUI and the web push.
   Writes (inbox detection, dedup, atomic append, archive, legacy migration) stay
   in `apps/tui/src/event-store.ts`. Both halves were once in the TUI; the read
   half was extracted (`5ef0c0b`), as was the preferences sidecar (`e5d6edd`).

2. **Orders are not events.** An Order is a claim on capital that has not become
   a transaction. It lives in `orders.jsonl` and is joined to the fold at *read*
   time — never folded into `FundReviewData` or NAV
   ([ADR-013](../context/adr/ADR-013-order-a-claim-on-capital-recorded-beside-the-log.md)).
   `packages/engine/src/orders/` depends on `contracts.ts` but deliberately never
   on `events/types.ts`, so it structurally cannot reach the fold.

## Runbooks and operational docs

| Doc | Answers |
| --- | --- |
| [`price-feed-ops.md`](./price-feed-ops.md) | How the hands-off daily price run is scheduled, where provider tokens live, and how to triage a failed or rejected run. |
| [`../ops/price-feed/launchagent-reinstall.md`](../ops/price-feed/launchagent-reinstall.md) | How to reinstall the launchd job from scratch, and the verify commands for each step. |
| [`durable-log-ops.md`](./durable-log-ops.md) | Day-to-day operations against the durable log. |
| [`accumulus-restore-runbook.md`](./accumulus-restore-runbook.md) | How to locate and reverse a bad-but-valid append using `head-digest.json` + `git revert` + re-fold. |
| [`projection-provisioning.md`](./projection-provisioning.md) | How the Postgres projection is provisioned idempotently and how the two-role grants work. |
| [`web-deploy-runbook.md`](./web-deploy-runbook.md) | How the hosted app is deployed and which credentials belong in which scope. |
| [`hosted-cutover-runbook.md`](./hosted-cutover-runbook.md) | The end-to-end cutover to hosted, step by step. |
| [`coverage-rationale.md`](./coverage-rationale.md) | What the measured coverage number includes, what is excluded, and why each exclusion is honest. |

## Decisions

Fourteen ADRs, indexed with current status in
[`context/adr/INDEX.md`](../context/adr/INDEX.md). The ones that explain the
most structure:

- **ADR-001** — the package boundary and runtime split (why engine is IO-free).
- **ADR-003** — event log, genesis, fold, persistence. Four amendments; the
  foundational record.
- **ADR-005** — the two-plane price model (pure domain vs. runtime shell).
- **ADR-006** — the private sibling data repo, commit-per-ingest.
- **ADR-007** / **ADR-011** — the hosted read projection and its single-tenant
  security posture.
- **ADR-013** / **ADR-014** — Orders as claims beside the log, and why a skipped
  export row is never persisted.

ADR bodies are **historical records**: they are not rewritten when a decision
later changes. Status changes are recorded in the header and in dated status-update
notes appended at the top. If a body and a status note disagree, the status note
is newer — ADR-012's Consequences section is a live example.

## Verifying the tree

```
pnpm typecheck   # all six members; guards public surfaces + no deep imports
pnpm test        # full Vitest suite
pnpm verify      # typecheck → test → smoke:startup, the full gate
pnpm coverage    # the measured Node-side number
```

`pnpm test` measured **1357 passed / 19 skipped across 104 files** at the time
this map was written; re-run rather than trusting the figure.

Tests are co-located with their subjects (`*.test.ts` beside the module), so the
test for any file is its sibling. Characterization snapshots and the engine↔TUI
formatter contract test are the two suites that pin cross-module behavior.

## Known open items

Surfaced during the documentation audit and deliberately left unfixed — they are
code or policy changes, not doc changes:

- **Stale `PROTOTYPE` comments in shipped code.**
  `packages/engine/src/index.ts:74-76` describes the event-sourcing spine as a
  prototype; 35 test files now depend on it.
  `packages/engine/src/reserve-opened.test.ts:1-2` calls itself prototype-era
  coverage for a verb that shipped in PR #162.
- **Coverage classification is not uniform.** `import-orders-cli.ts`,
  `record-fill-cli.ts`, `cancel-order-cli.ts`, and `migrate-legacy-log.ts` are
  thin CLI wiring counted in the coverage number with no dedicated test and no
  entry in `coverage-rationale.md` — while the structurally identical
  `report.ts` / `spine.ts` / `spine-reset.ts` are explicitly excluded *with*
  documented rationale. `apps/price-feed/src/index.ts` is a pure re-export barrel
  sitting at 0% for the same reason.
- **Vendored skill trees.** `.agents/`, `.codex/`, `.cursor/`, and `.opencode/`
  carry 60 files of `mvi-*` skill copies from a superseded tooling generation.
  They are not this project's process docs and should not be read as such.
