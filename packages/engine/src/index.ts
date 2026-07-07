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
  // Realized closed book + invalidation read-model types.
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
  PositionTrimmedEvent,
  PositionAddedToEvent,
  TierRemoval,
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
  splitTierRemoval,
} from "./events/fold.js";

// The derived, descriptive-only profit-split layer + its preferences-sidecar policy
// selector (decoupled from the log).
export type {
  SplitBasis,
  ProfitPolicy,
  ProfitPolicyEntry,
  ProfitSplit,
} from "./compose/profit-split.js";
export {
  pickPolicyAsOf,
  composeProfitSplit,
  defaultProfitPolicyEntry,
} from "./compose/profit-split.js";
export {
  buildEventReference,
  applyEventToReference,
  crossReferenceEvent,
  PRICE_MARK_MAGNITUDE_THRESHOLD,
  SETTLEMENT_MAGNITUDE_THRESHOLD,
} from "./events/crossref.js";

// Pure derivations for the git-backed durable event log — a compact Head Digest
// of a folded read model, and a deterministic ingest commit message.
export type { HeadDigest, IngestCommitInput } from "./durable-log.js";
export { deriveHeadDigest, formatIngestCommitMessage } from "./durable-log.js";

// The pure price-feed core (ADR-005 two-plane price model). Everything that turns
// a raw provider observation into a fund-history mark WITHOUT any IO: the typed
// instrument registry, the trading-day/mark-instant contract, quote → real
// `PriceMarkedEvent` construction, and the non-clobbering inbox merge. The fetch/
// IO/scheduling shell lives in `@numisma/price-feed`, which depends only on this.
export type {
  PriceSource,
  InstrumentRegistryEntry,
} from "./price-feed/registry.js";
export { instrumentsForSource, resolveInstrument } from "./price-feed/registry.js";
export type { Quote, MarkClock } from "./price-feed/mark.js";
export {
  tradingDayAsOf,
  isAtOrAfterMarkTime,
  priceMarkId,
  markFromQuote,
} from "./price-feed/mark.js";
export type { FixObservation } from "./price-feed/derive.js";
export { requireFreshFix, deriveMxnMark } from "./price-feed/derive.js";
export type { InboxRecord, InboxMergeResult } from "./price-feed/inbox-merge.js";
export {
  mergeInbox,
  INBOX_PATH_SEGMENTS,
  PRICE_STORE_DIR_SEGMENT,
  priceStoreFileName,
} from "./price-feed/inbox-merge.js";

// The ONE pure resolver for the durable ledger's data root, honoring the
// `NUMISMA_DATA_DIR` env override with an absolute, homedir-derived accumulus
// default. Shared by the tui event-store, the price-feed config, and the
// preferences sidecar so every plane resolves the same store.
export { resolveDataDir } from "./data-dir.js";

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
  formatProfitSplit,
} from "./format.js";
