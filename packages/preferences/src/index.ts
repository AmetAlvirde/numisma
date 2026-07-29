export {
  appendPreference,
  loadPreferences,
  resolvePreferencesPath,
  seedDefaultPreferences,
} from "./preferences.js";

// PROTOTYPE (`prototype/plans-sidecar`) — the DCA plan sidecar's IO half, hosted here
// rather than in a new package (`S3`) so it inherits this package's import guard. The
// pure as-of selectors (`pickPlanAsOf` / `listPlansAsOf`) live in `@numisma/engine`.
// Specimen code: does not merge.
export {
  appendNoPlan,
  appendPlan,
  loadPlans,
  resolvePlansPath,
  PLANS_DURABILITY_OBLIGATION,
} from "./plans.js";
