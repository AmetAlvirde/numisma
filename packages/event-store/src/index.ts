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
// The daily job's heartbeat (#191): the one fact the durable log cannot contain —
// whether the job ran. Written by bash from an EXIT trap; read here.
export {
  HEARTBEAT_FILENAME,
  HEARTBEAT_SCHEMA_VERSION,
  formatHeartbeatWarning,
  parseHeartbeat,
  type JobHeartbeat,
} from "./heartbeat.js";
export { heartbeatPath, loadHeartbeat, loadHeartbeatLines } from "./heartbeat-io.js";

export {
  GAP_REPORT_FILENAME,
  GAP_REPORT_SCHEMA_VERSION,
  gapReportPath,
  loadGapReport,
  writeGapReportFile,
} from "./gap-report-io.js";
