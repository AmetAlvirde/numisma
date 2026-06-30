// Curated public surface of @numisma/engine. This is the ONE place the package
// names what it exports — deliberately, not via a blanket `export *`. Engine
// internals stay internal: the shared kernel helpers (./internal.js), the
// canonical-state types (`CanonicalLine`, `GroupAccumulator` in ./compose.js),
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
  DetailRecordKind,
  DashboardDetailRow,
  DashboardDetail,
  TierContribution,
} from "./contracts.js";
export { validationSeverityByCode } from "./contracts.js";

// Public functions: parse untrusted input, compose the read model, drill down.
export { parseFundReview } from "./parse.js";
export { buildCompositionReport, buildDashboardDetail } from "./compose.js";

// PROTOTYPE (mvi 2026-06-29-portfolio-persistence): the event-sourcing spine —
// pure event validation + the fold to the existing FundReviewData read model.
export type {
  PortfolioEventType,
  PositionDecision,
  PositionOpenedEvent,
  PositionClosedEvent,
  PriceMarkedEvent,
  PortfolioEvent,
  EventOk,
  EventError,
  EventParseResult,
  EventReference,
} from "./fold.js";
export {
  parseEvent,
  foldEvents,
  buildEventReference,
  applyEventToReference,
  crossReferenceEvent,
  PRICE_MARK_MAGNITUDE_THRESHOLD,
} from "./fold.js";

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
} from "./format.js";
