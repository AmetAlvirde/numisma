export {
  MAX_FOLD_DISCARD_LINES,
  assertLogFullyLoaded,
  formatFoldDiscards,
  loadEventLog,
  loadFoldedReview,
  loadGenesis,
  quarantineLogPath,
  readOptional,
  resolveDataDirDefault,
  resolveEventStorePaths,
  unattendedFoldVerdict,
  type EventLogLoad,
  type EventStorePaths,
  type QuarantinedLine,
  type UnattendedFoldVerdict,
} from "./event-store.js";

// The gap report (#186, #266): which calendar days in the launchd era did the price
// feed not run on, and on which days did a whole VENUE owe marks and produce none.
// The derivation is pure and synchronous (`gap-report.js`); the log read is its one
// async shell (`gap-report-io.js`).
export {
  LAUNCHD_ERA_START,
  REPORT_TIME_ZONE,
  boundedEraFloor,
  computeGapReport,
  dueThrough,
  formatGapReport,
  formatGapSummary,
  formatLostDays,
  formatVenueDarkDays,
  type GapReport,
  type GapWindow,
  type LostDay,
  type LostDayReason,
  type VenueDarkDay,
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

// The operator notice (#357): the liveness banner's PUSH twin. The same two signals
// the TUI prints, composed into a file the shell profile cats on every new terminal
// — because every other surface in this repo is pull-only, and a lost day nobody
// goes looking for stays lost. It adds no derivation: the composition is pure
// (`operator-notice.js`) and the disk touch is its one shell
// (`operator-notice-io.js`).
export {
  formatNoticeCheckFailure,
  formatOperatorNotice,
  type NoticeGapFindings,
} from "./operator-notice.js";
export {
  OPERATOR_NOTICE_FILENAME,
  loadOperatorNoticeLines,
  operatorNoticePath,
  writeOperatorNotice,
  writeOperatorNoticeFile,
} from "./operator-notice-io.js";
