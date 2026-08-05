export {
  assertLogFullyLoaded,
  loadEventLog,
  loadFoldedReview,
  loadGenesis,
  quarantineLogPath,
  readOptional,
  resolveDataDirDefault,
  resolveEventStorePaths,
  type EventLogLoad,
  type EventStorePaths,
  type QuarantinedLine,
} from "./event-store.js";

// The gap report (#186): which calendar days in the launchd era did the price feed
// not run on. The derivation is pure and synchronous (`gap-report.js`); the log
// read is its one async shell (`gap-report-io.js`).
export {
  LAUNCHD_ERA_START,
  REPORT_TIME_ZONE,
  computeGapReport,
  dueThrough,
  formatGapReport,
  formatGapSummary,
  type GapReport,
  type GapWindow,
  type LostDay,
  type LostDayReason,
} from "./gap-report.js";
export { loadGapReport } from "./gap-report-io.js";
