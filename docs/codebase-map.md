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
(placeholder `<fund>`, default `~/Dev/<fund>/data`, overridable with
`NUMISMA_DATA_DIR`), so no trade data is ever in this repository's history
([ADR-006](../context/adr/ADR-006-private-sibling-data-repo-commit-per-ingest.md)).
The layout of that directory, and the `<fund>`/`<dataDir>`/`<exchange>`
placeholder convention itself, are documented in
[`local-data.md`](./local-data.md).

## Packages

| Path | Package | Runtime | What it owns | Read first |
| --- | --- | --- | --- | --- |
| `packages/engine` | `@numisma/engine` | Node, IO-free | The pure fund domain: parse → validate → fold → compose → format, plus the pure half of the price model, the whole Orders model, the pure halves of the plans and reconciliations sidecars, and the one data-dir predicate (`normalizeDataDirOverride`) every runtime plane routes through. No file, network, or terminal IO. | `src/index.ts` (curated barrel, no `export *`), `src/events/types.ts` |
| `packages/event-store` | `@numisma/event-store` | Node | The durable log's **read** path — path resolution, genesis load, log load with quarantine, `loadFoldedReview` — plus the gap-report, heartbeat, and operator-notice sidecars. | `README.md`, then `src/` |
| `packages/preferences` | `@numisma/preferences` | Node | Sidecar file IO for `preferences.jsonl`, `orders.jsonl`, `plans.jsonl`, and `reconciliations.jsonl`. Append-only, validated on load, appended through one cross-process lock + temp + rename shell (`src/sidecar-io.ts`). | `README.md` |
| `apps/tui` | `@numisma/tui` | Bun (dashboard) + Node (CLIs) | The local access surface: the log's **write/ingest** half, startup orchestration, the openTUI dashboard, the three Orders CLIs, the `pnpm plans` desk report, and the smokes. | `README.md` §Entry points, `src/event-store.ts` |
| `apps/price-feed` | `@numisma/price-feed` | Node, headless | The market-data runtime shell: three provider adapters, the disposable price store, the atomic inbox emit, the fetch-time spine-guard pre-check, and the `operator-notice` CLI the daily wrapper runs. Its `src/wrapper-harness/` drives the real `ops/price-feed/run-daily-fetch.sh` against a fake bin. | `README.md`, `src/cli.ts` (wiring only — the report and exit contract are in `src/cli-main.ts`, the argv parser in `src/cli-args.ts`) |
| `apps/web` | `@numisma/web` | TanStack Start (Vite + Nitro), React 19 | The hosted read-projection dashboard, its Better Auth server, and the push/provisioning scripts. | `README.md`, `src/push/push.ts` |

**The dependency rule:** apps depend on packages, never the reverse; packages
depend on `@numisma/engine` and never on each other beyond that. Every consumer
imports through a package's **declared** entry points only — the root plus the
four deliberate subpath exports (`@numisma/engine/format`,
`@numisma/engine/calendar`, `@numisma/engine/testkit`,
`@numisma/event-store/testkit`) — never an undeclared deep path into a
package's `src/`. `pnpm typecheck` enforces both
the public surfaces and the no-deep-import boundary — it is a real gate, not a
formality.

## Repo tooling: `ops/`

`ops/` is outside the workspace globs and belongs to no package. Two things live
there.

| Path | What it owns |
| --- | --- |
| `ops/price-feed/` | The launchd side of the daily price run: `run-daily-fetch.sh` (the wrapper the scheduler executes), the `com.numisma.pricefeed.daily.plist` template, and `launchagent-reinstall.md`. |
| `ops/testkit/` | The git-backed substrate the repo-wide guards and test discovery share. `repo-sources.testkit.ts` answers "what files are part of this repo" with `git ls-files` instead of a hand-maintained directory denylist, and `gitignored-path-globs.ts` derives vitest's `exclude` globs from `git ls-files --others --ignored` instead of parsing `.gitignore` as text. Both replaced denylists that failed *toward green* — silently dropping tests while the shortened suite still reported success. |

`gitignored-path-globs.ts` deliberately does **not** carry the `.testkit.ts`
suffix: that suffix marks coverage-excluded test-only substrate, and this module
is imported by `vitest.config.ts`, so it runs before every test on every
invocation. Nothing else typechecks this directory — no package tsconfig
includes it and the root config has no `include` — so `tsconfig.ops.json` covers
`ops/**` plus `vitest.config.ts`, and `pnpm typecheck` runs it as its last step.

## The two IO boundaries worth understanding first

These are the seams most likely to be misread from the tree alone:

1. **The log's IO is split by direction.** Reads (genesis, log, quarantine) live
   in `@numisma/event-store` and are consumed by *both* the TUI and the web push.
   Writes (inbox detection, dedup, atomic append, archive, legacy migration) stay
   in `apps/tui/src/event-store.ts`. Both halves were once in the TUI; the read
   half was extracted (`c2d9357`), as was the preferences sidecar (`50c93f7`).

2. **Orders are not events.** An Order is a claim on capital that has not become
   a transaction. It lives in `orders.jsonl` and is joined to the fold at *read*
   time. The invariant ADR-013 actually guards is narrower than "orders/ cannot
   reach the fold": a line in `orders.jsonl` is never a `PortfolioEvent` —
   `parseEvent` rejects it, pinned by `orders-not-events.test.ts`
   ([ADR-013](../context/adr/ADR-013-order-a-claim-on-capital-recorded-beside-the-log.md)).
   The ADR leaves module structure undecided, and one deliberate crossing
   exists: `packages/engine/src/orders/fill.ts` imports `PortfolioEvent` /
   `PositionOpenedEvent` / `PositionAddedToEvent` / `PositionDecision` directly
   — still the only non-test direct `events/types.ts` import in `orders/` —
   because the fill act constructs the fold events it writes.
   `orders/attribution.ts`, `orders/coverage.ts`, and `orders/available.ts`
   reach folded state too, but only transitively — through
   `compose/canonical.js`, which `attribution.ts` alone imports.

## Runbooks and operational docs

| Doc | Answers |
| --- | --- |
| [`price-feed-ops.md`](./price-feed-ops.md) | How the hands-off daily price run is scheduled, where provider tokens live, and how to triage a failed or rejected run. |
| [`../ops/price-feed/launchagent-reinstall.md`](../ops/price-feed/launchagent-reinstall.md) | How to reinstall the launchd job from scratch, and the verify commands for each step. |
| [`durable-log-ops.md`](./durable-log-ops.md) | Day-to-day operations against the durable log. |
| [`accumulus-restore-runbook.md`](./accumulus-restore-runbook.md) | How to locate and reverse a bad-but-valid append (in the `<fund>` sibling repo) using `head-digest.json` + `git revert` + re-fold. |
| [`projection-provisioning.md`](./projection-provisioning.md) | How the Postgres projection is provisioned idempotently and how the two-role grants work. |
| [`web-deploy-runbook.md`](./web-deploy-runbook.md) | How the hosted app is deployed and which credentials belong in which scope. |
| [`hosted-cutover-runbook.md`](./hosted-cutover-runbook.md) | The end-to-end cutover to hosted, step by step. |
| [`coverage-rationale.md`](./coverage-rationale.md) | What the measured coverage number includes, what is excluded, and why each exclusion is honest. |
| [`domain-model.md`](./domain-model.md) | The domain vocabulary: the verbs, position semantics, the closed book, the invalidation watch, the profit-split, and Orders. |
| [`ladder-fill-path.md`](./ladder-fill-path.md) | The DCA ladder card's two product rules: the day-zero projection (and why it is already reliable by construction), and the three-colour state key the picture and the rung list share. |
| [`plans-authoring-runbook.md`](./plans-authoring-runbook.md) | How to write a `plans.jsonl` line by hand, what the allowlist edit costs, and how to read `pnpm plans` back. |
| [`scripts.md`](./scripts.md) | The full `pnpm` script reference across all workspace members. |
| [`local-data.md`](./local-data.md) | The durable-store rule, the `<dataDir>` layout, the write allowlist, and the `<fund>`/`<exchange>` placeholder convention. |

## Decisions

Twenty-one ADRs, indexed with current status in
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
- **ADR-020** / **ADR-021** — the Discard Channel: a component that drops an
  input returns that discard as part of its own result rather than refusing the
  run, and every `FoldSkipReason` means the same thing about what the fold
  applied (nothing at all).

ADR bodies are **historical records**: they are not rewritten when a decision
later changes. Status changes are recorded in the header and in dated status-update
notes appended at the top. If a body and a status note disagree, the status note
is newer — ADR-012's Consequences section is a live example.

## Verifying the tree

```
pnpm typecheck    # all six members, then ops/ + vitest.config.ts via tsconfig.ops.json
pnpm test         # full Vitest suite
pnpm test:wrapper # the price-feed wrapper harness, trigger bypassed
pnpm verify       # typecheck → test → smoke:startup, the full gate
pnpm coverage     # the measured Node-side number
```

The tree carries **166 test files** as of this writing. No pass/skip count is
recorded here on purpose: the last one this map printed went stale within days
and was believed anyway. Run the suite. Two families of skip are expected and
are not failures — the Postgres integration suites opt out unless
`NUMISMA_TEST_DATABASE_URL` is set, and the price-feed wrapper harness arms
itself only when its trigger says the wrapper is in play (`pnpm test:wrapper`
forces it, `NUMISMA_WRAPPER_TEST=never` mutes it). Each says which it is.

Tests are co-located with their subjects (`*.test.ts` beside the module), so the
test for any file is its sibling. Characterization snapshots and the engine↔TUI
formatter contract test are the two suites that pin cross-module behavior.

## Open items — none at present

The one item the documentation audit left open here has since been resolved;
its resolution stays in place as the decision record:

- **`@numisma/price-feed` has no consumers — RESOLVED by narrowing the surface
  to the shape a consumer would need.** Nothing in the workspace still imports
  the package by its root — not `apps/web`, not `apps/tui`, and not even its own
  `cli.ts`, which reaches its siblings by relative path. That has not changed;
  what changed is the response to it. The earlier reading was that with no
  consumer there is no evidence, so the incidental-looking exports were pinned
  rather than narrowed. The codebase review (finding 18) showed the barrel was
  not merely over-broad but actively **wrong**: it published
  `fetchTwelveDataDailyClose` (singular, zero non-test callers) and omitted the
  batched `fetchTwelveDataDailyCloses` that `runPriceFetch` actually drives — so
  the obvious front-door use for the registry's 9 Twelve Data symbols would issue
  9 requests against Twelve Data's 8-credit/minute cap and 429, the exact failure
  the chunking and 60s pacing exist to prevent.

  The decision (no ADR — it is a surface trim, not an architectural trade-off):
  shape the barrel for the consumer the package header promises, in the absence
  of a real one.
  - `fetchTwelveDataDailyCloses` + `ProviderFetchResult` are now exported; the
    singular wrapper was **deleted**, not just un-exported. Its test cases moved
    onto the batched fetch as one-element batches.
  - `atomicWrite` / `AtomicWriteIo` and `upsertQuote` were **un-exported from the
    barrel only**. The modules stay — three modules use them by relative import;
    they were dead at the front door, not dead code.

  `src/index.ts`'s header and the exact-set lock in `src/index.test.ts` carry this
  decision; the lock is what makes any future change to the set deliberate.

Three classes of finding from that audit were closed rather than deferred, and
the guards that keep them closed are worth knowing about:

- **Prototype markers.** `de-prototype.test.ts` is a regression lock asserting
  that no shipped source under `packages/engine`, `apps/tui`, or
  `apps/price-feed` carries a prototype marker. Its needles match the marker
  *shape*, not enumerated dates, so a new marker on any future date fails the
  suite. An earlier per-increment version of this guard is why ten markers once
  survived onto `main` in load-bearing code.
- **Coverage classification.** Thin CLI shells are excluded from the coverage
  number, and every exclusion has a row in
  [`coverage-rationale.md`](./coverage-rationale.md) naming the flow module and
  the tests that cover its logic. The shells are unmeasurable for a structural
  reason, not a convenient one: importing one *runs the act*, which is exactly
  why each flow lives in its own injectable module.
- **Public surfaces.** `pnpm typecheck` is the workspace's mechanical guard for
  both package surfaces and the no-deep-import discipline, and it is sufficient
  for *type* exports. It cannot catch a dropped **value** export that nothing
  imports — so `apps/price-feed/src/index.test.ts` asserts that barrel's runtime
  surface by exact set equality, deriving both its presence and kind checks from
  a single source list. It is currently the only test of its kind in the repo;
  the other packages rely on being imported through their roots by real
  consumers.
