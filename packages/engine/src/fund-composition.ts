// The engine concerns now live in their own modules: domain types/contracts in
// ./contracts.js, the cross-concern kernel in ./internal.js, parsing in
// ./parse.js, composition in ./compose.js, and price journeys in
// ./price-journey.js. This file is a thin transitional barrel that keeps the
// public surface (reached via index.ts) byte-identical while the curated
// index.ts is a later slice — it re-exports the same types and the same three
// public functions, none added or removed.
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

export { parseFundReview } from "./parse.js";
export { buildCompositionReport, buildDashboardDetail } from "./compose.js";
