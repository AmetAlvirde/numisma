/**
 * The curated public surface of `@numisma/components`.
 *
 * Named here one at a time, deliberately, rather than by a blanket `export *` —
 * the same discipline `@numisma/engine` keeps. What is absent is absent on
 * purpose.
 *
 * THE PACKAGE SHIPS UNBUILT TSX. There is no `dist`, no build script, and no
 * `main`. Consumers import this source and transform it with their own
 * toolchain, which is what lets a component's utility classes be scanned by
 * each consumer's Tailwind build. Adding a build step here would break that.
 *
 * THE PACKAGE SHIPS NO CSS. Not a stylesheet, not a `@theme` block, not a token
 * file. The consumer owns the palette; this package owns only the token NAMES,
 * in `./tokens`. See that file for the two silent failures that arrangement
 * costs and the contract that makes them testable.
 */

export { Absent } from "./ui/absent";
export { Button, buttonVariants } from "./ui/button";
export { Card, CardTitle, CARD_SURFACE } from "./ui/card";
export { Crumb } from "./ui/crumb";
export {
  DcaCard,
  type DcaAlertView,
  type DcaPositionView,
  type DcaRungView,
  type DcaView,
} from "./ui/dca-card";
export {
  GlanceCard,
  referenceLabel,
  type ChangeSlot,
  type FiredTrigger,
  type FundValueSlot,
  type ReserveSlot,
  type SuppressionReason,
  type TriggerName,
  type Verdict,
} from "./ui/glance-card";
export {
  SectionTable,
  TABLE_CELL,
  TABLE_CELL_NUM,
  TABLE_HEAD_CELL,
  TABLE_HEAD_CELL_NUM,
  TABLE_SCROLL,
  TABLE_SURFACE,
  type BigPictureView,
  type RowAbsenceReason,
  type RowDelta,
  type RowView,
} from "./ui/section-table";
export { Shell } from "./ui/shell";
export {
  METRICS_FIGURE,
  METRICS_LIST,
  METRICS_ROW,
  METRICS_TERM,
  NEGATIVE,
  POSITIVE,
  SummaryCard,
} from "./ui/summary-card";
export {
  NOTICE_CODE,
  SnapshotEmptyNotice,
  SnapshotStaleNotice,
} from "./ui/snapshot-notice";
export { cn } from "./lib/utils";
export {
  NMS_PREFIX,
  NMS_TOKENS,
  NMS_TOKEN_NAMES,
  type NmsToken,
} from "./tokens";
