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
 * through `FillPath` at every APP call site. Publishing them here would turn four
 * more capitalized functions into fixture obligations for a surface the object
 * already gives out. The workbench reaches all four by subpath instead, which is
 * the arrangement the paragraph below describes.
 *
 * `useFillPath` IS WITHDRAWN, and this is where the decision landed (spec #451
 * §4.5). It was published at S6 of spec #439 because the parts still lived in
 * `apps/web` and read this provider across the boundary; wave 2 moved them in and
 * left a published hook with no caller outside the package, which wave 3 took out.
 * The hook itself is untouched — it is still exported from `./ui/fill-path`, and
 * the four parts still read it directly, because each of them also needs `view`
 * and two need `selectIndex`. What changed is that a consuming app can no longer
 * reach it, which is the whole of the change.
 *
 * NOTHING IN THIS REPO COUNTED THE WITHDRAWAL, which is why it is asserted by hand.
 * `fixture-coverage.test.ts` filters to capitalized FUNCTIONS and `useFillPath` is
 * lowercase, so it was never a fixture obligation and no count moved when it came
 * out. The surface could grow the hook back tomorrow and every other test in the
 * repo would stay green. `fixture-coverage.test.ts` now says outright that it is
 * gone, that `useFillPathSelection` and `FillPathProvider` are not, that the module
 * still exports it, and that no file outside `packages/components/src` imports it
 * by ANY specifier — the index or the deep subpath. The compiler holds only the
 * first of those routes.
 *
 * `useFillPathSelection` STAYS, and it is the narrower shape: exactly `select`,
 * `selected` and `selectedIndex`, never `view`. Its one consumer is the workbench's
 * selection probe. That is what a hook published from this file is supposed to look
 * like, and it is the reason the withdrawal above costs nobody anything.
 *
 * `Figure`, `Expectation`, `formatUnits` and the module's class strings are NOT
 * here on purpose, and the subpath they cross by is NOT dead (spec #439 review
 * finding 7). What died at S9 is the `apps/web` CROSSING: `FillPath.tsx` imported
 * ten transitional names over
 * `@numisma/components/ui/fill-path.tsx` while the parts were in the package and
 * the cards that read them were not, and `routes/route-move.test.ts` correctly
 * dropped that subpath from its allow-list when the file went. The subpath itself
 * still has nine importers — `apps/workbench/src/ui/fill-path.fixture.tsx` mounts
 * `Chart`, `Expectation`, `Figure`, `formatUnits`, `Header`, `RungList`,
 * `SelectedRung`, `TornActBanner` and `UnrecordedWarnings` directly, and
 * `fill-path.tsx:1837` says so.
 *
 * SO THIS IS NOT A LICENCE TO UNEXPORT THEM. The workbench is not `apps/web`; it is
 * the package's own review surface, and the subpath is how it gets under the
 * arrangement `FillPath` hands out whole. What crossing by subpath bought is that
 * these names never became public API for a consuming APP, which is a narrower
 * claim than "nothing imports them" and the only one true here.
 */
export {
  FillPath,
  FillPathCards,
  FillPathProvider,
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
  type BigPictureView,
  type RowAbsenceReason,
  type RowDelta,
  type RowView,
} from "./ui/section-table";
export { Shell } from "./ui/shell";
/**
 * THE CLASS STRINGS THESE TWO MODULES SHARE ARE NOT PUBLISHED (spec #439 review
 * finding 6). `TABLE_CELL`, `TABLE_CELL_NUM`, `TABLE_HEAD_CELL`, `TABLE_HEAD_CELL_NUM`,
 * `TABLE_SCROLL`, `TABLE_SURFACE`, `METRICS_FIGURE`, `METRICS_LIST`, `METRICS_ROW`,
 * `METRICS_TERM`, `NEGATIVE` and `POSITIVE` are Tailwind strings the components share
 * WITH EACH OTHER, and every reader is a sibling reaching by relative path —
 * `section-table.tsx` and `glance-card.tsx` take `NEGATIVE`/`POSITIVE` from
 * `./summary-card`, `dca-card.tsx` takes the table box from `./section-table`. Not one
 * has an importer outside `packages/components/src`.
 *
 * THAT IS THE DIFFERENCE FROM `CARD_SURFACE` AND `NOTICE_CODE`, which are here because
 * `apps/web` route files read them. §4.1's rule about re-exporting from `index.ts` is
 * about PROP TYPES the app has to name. Before the move these strings were shared the
 * same way, across `apps/web/src/components/*.tsx`; moving the sharing inside the
 * package should have made the index entries unnecessary rather than required them.
 *
 * `fixture-coverage.test.ts` filters to capitalized FUNCTIONS, so string constants are
 * invisible to it by construction and this surface could accumulate indefinitely and
 * stay green. If an app-side caller ever needs one, publishing it then is a one-line
 * diff with a reason attached.
 */
export { SummaryCard } from "./ui/summary-card";
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
