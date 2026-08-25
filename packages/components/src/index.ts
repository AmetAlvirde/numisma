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
/**
 * THE FILL PATH, WHOLE (spec #439 S9), AND WHAT IS STILL DELIBERATELY NOT HERE.
 *
 * `FillPathCards` is the house arrangement and the only thing the two ladder
 * routes mount; `FillPath` is the frozen object its four parts hang off, so a
 * caller can arrange them differently. The object is not a function, so
 * `fixture-coverage.test.ts` skips it; `FillPathCards` is a capitalized
 * function, so the guard demands a fixture for it and the workbench carries one.
 *
 * THE FOUR PARTS THEMSELVES ARE NOT NAMED HERE. `Header`, `Chart`,
 * `SelectedRung` and `RungList` are module exports of `./ui/fill-path`, reached
 * through `FillPath` at every call site. Publishing them here would turn four
 * more capitalized functions into fixture obligations for a surface the object
 * already gives out.
 *
 * `useFillPath` was published at S6 because the parts still lived in `apps/web`
 * and read this provider across the boundary. They do not any more: it is now
 * published surface with no caller outside the package, and wave 3 decides
 * whether to withdraw it. `useFillPathSelection` has one — the workbench's
 * selection probe.
 *
 * `Figure`, `Expectation`, `formatUnits` and the module's class strings are NOT
 * here on purpose. The subpath they used to cross by,
 * `@numisma/components/ui/fill-path.tsx`, died with
 * `apps/web/src/components/FillPath.tsx` at S9 rather than becoming public API,
 * which is what crossing by subpath bought.
 */
export {
  FillPath,
  FillPathCards,
  FillPathProvider,
  useFillPath,
  useFillPathSelection,
} from "./ui/fill-path";
export type {
  ChartCircle,
  ChartGeometry,
  ExpectedFigures,
  FillPathFigures,
  FillPathView,
  TornActReading,
  WaitingSplit,
} from "./ui/fill-path";
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
  PriceDropPathChart,
  type FillPathRungView,
  type MeasuredFigure,
} from "./ui/price-drop-path-chart";
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
