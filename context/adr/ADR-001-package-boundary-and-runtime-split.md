# ADR-001: Package boundary and runtime split

## Status

Accepted

## Context

- The reliable Fund review PRD requires a reusable engine that future access
  surfaces can consume without inheriting terminal or Bun runtime assumptions.
- The prototype currently mixes canonical Fund composition logic with openTUI,
  Bun runtime loading, and local review-file concerns inside one `src/`
  layout.
- The first reliable slice needs a reviewable package boundary before later
  slices extract engine APIs, add tests, and remove duplicated TUI logic.

## Decision

- Adopt a private pnpm workspace with `packages/engine` and `packages/tui`.
- `@numisma/engine` owns the Node-compatible composition domain surface used in
  this slice: review parsing, canonical composition building, and report
  formatting. It does not depend on Bun, openTUI, or terminal rendering.
- `@numisma/tui` owns the local access-surface runtime: openTUI rendering, Bun
  execution, review-file path resolution, file loading, and smoke rendering.
- The root package remains private and owns the workspace entry scripts
  (`dev`, `report`, `smoke:tui`, `typecheck`, `test`) so the user-facing repo
  commands stay stable during the split.

## Trade-offs

- The first slice adds workspace and package structure before deeper behavior
  hardening, which increases file movement now in exchange for cleaner seams in
  later slices.
- Some prototype duplication remains temporarily in the TUI until the follow-on
  slice routes drilldown and selection behavior fully through engine read
  models.
- Root-owned scripts preserve the current user workflow, but package-level
  scripts still exist so the split is explicit and independently typecheckable.

## Consequences

- Future web or automation access surfaces can import `@numisma/engine`
  directly without terminal-specific runtime coupling.
- Subsequent reliable slices can add root vitest coverage and evolve engine
  contracts without re-deciding package ownership.
- Runtime-specific failures, such as openTUI loading constraints, remain
  isolated to `@numisma/tui`.
