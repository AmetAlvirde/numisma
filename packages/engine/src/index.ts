// Curated public surface of @numisma/engine. This is the ONE place the package
// names what it exports — deliberately, not via a blanket `export *`. Engine
// internals stay internal: the shared kernel helpers (./internal.js), the
// canonical-state types (`CanonicalLine`, `GroupAccumulator` in ./compose/*.js),
// and the package-internal contracts (`NamedRecord`, `CapitalRecordBase`) are
// intentionally absent here. `pnpm typecheck` is the mechanical guard that both
// this surface and the no-deep-import discipline hold.

// Public domain types, read models, and the assurance vocabulary.
export type {
  Currency,
  ExecutionMode,
  Direction,
  CapitalTier,
  Lot,
  PositionLot,
  FundReviewData,
  Close,
  ReserveRecord,
  PositionRecord,
  Ok,
  InvalidJson,
  SchemaError,
  UnsupportedBaseCurrency,
  InvalidFxRate,
  InvalidAsOf,
  DuplicateReferenceId,
  DuplicateCapitalRecordId,
  ParseResult,
  ValidationSeverity,
  LoadedOutcome,
  LoadFailedOutcome,
  LoadOutcome,
  WarningCode,
  ValidationCode,
  Warning,
  DashboardRowKind,
  DashboardSectionId,
  CompositionRow,
  DashboardFocus,
  DashboardSummary,
  DashboardSection,
  DashboardModel,
  PriceJourneyPoint,
  PriceJourney,
  CompositionReport,
  ReserveReconciliationLine,
  DetailRecordKind,
  DashboardDetailRow,
  DashboardDetail,
  TierContribution,
  // PROTOTYPE (mvi 2026-07-01-realized-pnl): realized closed book + invalidation.
  ClosedPositionRecord,
  RealizedTierAttribution,
  InvalidationLevel,
  ClosedBook,
  RealizedRollupRow,
  InvalidationWatchRow,
} from "./contracts.js";
export { validationSeverityByCode } from "./contracts.js";

// Public functions: parse untrusted input, compose the read model, drill down.
export { parseFundReview } from "./parse.js";
export { buildCompositionReport } from "./compose/report.js";
export { buildDashboardDetail } from "./compose/detail.js";

// PROTOTYPE (mvi 2026-06-29-portfolio-persistence): the event-sourcing spine —
// pure event validation + the fold to the existing FundReviewData read model.
export type {
  PortfolioEventType,
  PositionDecision,
  OpenFunding,
  CloseSettlement,
  PositionOpenedEvent,
  PositionClosedEvent,
  PriceMarkedEvent,
  DepositEvent,
  WithdrawEvent,
  TransferEvent,
  InvalidationMarkedEvent,
  InvalidationDirection,
  PortfolioEvent,
  TierDelta,
  EventOk,
  EventError,
  EventParseResult,
} from "./events/types.js";
export type { SuppliedCashLeg } from "./events/parse.js";
export type { EventReference } from "./events/crossref.js";
export { parseEvent, migrateLegacyEvent, EVENT_SCHEMA_VERSION } from "./events/parse.js";
export {
  foldEvents,
  applyReserveDelta,
  reserveDeltasForOpen,
  reserveDeltasForClose,
} from "./events/fold.js";
export {
  buildEventReference,
  applyEventToReference,
  crossReferenceEvent,
  PRICE_MARK_MAGNITUDE_THRESHOLD,
  SETTLEMENT_MAGNITUDE_THRESHOLD,
} from "./events/crossref.js";

// Shared formatters (the engine's one source of truth for the cents-precision /
// padding conventions, consumed by the TUI) + the CLI composition renderer.
export {
  formatUsd,
  formatMaybeUsd,
  formatPrice,
  formatSignedPercent,
  formatPercent,
  pad,
  padLeft,
  divider,
  formatCompositionReport,
  formatReserveReconciliation,
  formatClosedBook,
  formatInvalidationWatch,
} from "./format.js";
