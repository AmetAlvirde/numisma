// The `preferences.jsonl` sidecar's IO half. `loadPreferences` returns a
// `LoadedPreferences` envelope — its load outcome, the accepted entries, and one record
// per discarded line. Those types are PURE contracts and live in `@numisma/engine`
// beside `ProfitPolicyEntry` (ADR-001), and per the house rule recorded below they are
// NOT re-exported here: call sites import them from `@numisma/engine`, exactly as
// `LoadedPlans` is imported.
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
