import type { DashboardSummary } from "@numisma/engine";

/**
 * `SummaryCard`'s prop literal, beside the component (spec #439 §4.3).
 *
 * IT WAS ALREADY WRITTEN; IT WAS JUST TRAPPED IN A TEST. This factory came out of
 * `summary-card-structure.test.tsx`, where it had been the only authored
 * `DashboardSummary` in the repo. Three consumers want it now — the moved structure
 * test, the workbench's cosmos fixture, and whatever renders the card next — and a
 * literal that lives in a test file can be read by exactly one of them.
 *
 * A LITERAL, NEVER A COMPOSE CALL, and that is forced rather than chosen. The
 * functions that build this shape in production stay in `apps/web`, and
 * `seam-isolation.test.ts` forbids the workbench importing from there. The card takes
 * `@numisma/engine`'s own `DashboardSummary`, so the type is the check: a field that
 * moves upstream stops compiling here.
 *
 * SYNTHESIZED. `Test Fund` and every figure below are placeholders. No ledger output
 * has been near this file.
 */
export function cleanSummary(): DashboardSummary {
  return {
    fundName: "Test Fund",
    asOf: "2026-01-05",
    fundValueUsd: 1000,
    usdMxn: 18.5,
    totalUnrealizedPnlUsd: 100,
    dataSafety: {
      nonLiveExcluded: 0,
      invalidExcluded: 0,
      shortDeferredExcluded: 0,
      hasWarnings: false,
    },
  };
}
