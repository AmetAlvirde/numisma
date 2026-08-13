export {
  loadPreferences,
  resolvePreferencesPath,
  seedDefaultPreferences,
} from "./preferences.js";
export type { OrderSkip, OrdersLoad, LoadOrdersOptions } from "./orders.js";
export { resolveOrdersPath, loadOrders, appendOrders } from "./orders.js";
// The `plans.jsonl` sidecar's IO half. The record contract and the strict
// calendar-date predicate stay pure in `@numisma/engine` (ADR-001) and are NOT
// re-exported here — a re-export block would give every consumer two names for one
// type and no way to tell which is canonical.
export type { NoPlanInput, UnattendedPlansVerdict } from "./plans.js";
export {
  resolvePlansPath,
  loadPlans,
  appendPlan,
  appendNoPlan,
  unattendedPlansVerdict,
} from "./plans.js";
// The `reconciliations.jsonl` trail's IO half, on the same terms: the record
// contract, the closed mismatch vocabulary, the verdict function and the canonical
// serializer stay pure in `@numisma/engine` (ADR-001) and are NOT re-exported here.
export type { UnattendedReconciliationsVerdict } from "./reconciliations.js";
export {
  resolveReconciliationsPath,
  loadReconciliations,
  appendReconciliation,
  unattendedReconciliationsVerdict,
} from "./reconciliations.js";
