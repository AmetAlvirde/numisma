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
// PRD #146 C1: a NEW pure export, not a widening of any existing contract. Row id →
// the instrument ids that row descends from — the fact 19 aggregate row ids do not
// carry. (19 is invariant across every measured anchor; the row TOTAL is not — it is 31 or 33
// depending on whether the late-opened instruments exist yet, which is exactly why the
// linkage cannot be recovered from a count or a name.)
export { composeRowDependencies } from "./compose/row-dependencies.js";
export type { RowDependencies } from "./compose/row-dependencies.js";

// The event-sourcing spine (ADR-003): pure event validation + the fold to the
// FundReviewData read model. Ten verbs, all shipped; every durable surface in
// the workspace reads through this.
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
  ReserveOpenedEvent,
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
// The `orders.jsonl` sidecar (ADR-013) — recorded BESIDE the log, never in it. The
// record contract and the pure as-of selector only; the file IO lives in
// `@numisma/preferences`, per ADR-001.
// MANUAL BLOCK, and saying so is the point: this list is NOT derived from the
// `OrderRecord` union, so a kind added to the union is exported only if it is added HERE
// too. A missing entry is not a type error anywhere — it just leaves the new record
// unnameable outside the package.
export type {
  OrderKind,
  OrderSide,
  OrderRecord,
  OrderPlacedRecord,
  OrderCancelledRecord,
  OrderFilledRecord,
  OrderFillObservedRecord,
  ObservedFillClaim,
  OrderFillObservedBuild,
  OrderRecordProblem,
  OrderRecordParse,
} from "./orders/records.js";
export {
  serializeOrderRecord,
  parseOrderRecord,
  buildOrderFillObserved,
  isObservedAtStamp,
  OBSERVED_AT_RULE,
  formatObservedAt,
} from "./orders/records.js";
export type { RestingOrder } from "./orders/select.js";
export {
  bookedFills,
  pickRestingOrdersAsOf,
  selectOrdersThrough,
} from "./orders/select.js";
// Ingest: the PURE Bitget open-orders parse and the venue-neutral join to the one
// declared field. The IO shell — reading the export, prompting, appending — is the
// TUI's, per ADR-001.
export type { ObservedOpenOrder, OrderIdentity, OrderAttribution } from "./orders/ingest.js";
// The ONE reserve admission policy and rung-placement rule, shared by the `O1` guard and
// the available-capital report. `FundableReserve` replaces the old `ReserveBalance`: it
// carries `currency`, and only `fundableReserves(data)` can produce one (#172).
export type {
  FundableReserve,
  RungAttribution,
  UnmatchedReason,
  UnmatchedRung,
} from "./orders/attribution.js";
export { fundableReserves, attributeRungs } from "./orders/attribution.js";
export {
  canonicalDecimal,
  synthesizeOrderId,
  buildOrderPlacedRecords,
  mergeCollidingClaims,
  detectChangedClaims,
  isDescriptorDifference,
  isFilledDifference,
} from "./orders/ingest.js";
export type {
  MergedOrderClaim,
  ChangedClaim,
  ClaimDifference,
  NumericClaimDifference,
  TextClaimDifference,
  NumericClaimField,
  TextClaimField,
} from "./orders/ingest.js";
// THE DECLARED RUNG JOIN (#286) — the pure half: which `dcaLadder` plans are in force at
// an import's stamp, what a price match PROPOSES over them, and what a ratified pick
// declares. The pick-list itself (prompting, ratifying) is the TUI's, per ADR-001. This
// is a MANUAL block like every other in this file: a function added to the module is
// nameable outside the package only if it is added here too.
export type { InForceLadder, RungPick } from "./orders/rung-picks.js";
export {
  inForceLadders,
  proposeRungByPrice,
  matchRungsByPrice,
  declaredRungPrice,
} from "./orders/rung-picks.js";
// THE FILL PATH RECONCILIATION (#287) — every spot-independent conclusion the Fill Path
// surface renders, from one pure function over a declared ladder, the whole order stream and
// the recorded lots. Spot is deliberately NOT an input; the two spot-dependent decorations
// are computed at render. A MANUAL block: nothing here is nameable outside the package
// unless it is added here too.
export type {
  FillVenueAxis,
  FillBookAxis,
  RungJoinProvenance,
  FillPathRung,
  FillPathOrphan,
  FillPathFigures,
  FillPathInput,
  FillPathView,
} from "./fill-path.js";
export { reconcileFillPath, ORPHAN_LABEL } from "./fill-path.js";
// The `O1` funding-coverage guard, split from ingest because it changes with
// reserve-admission policy rather than with the venue's row shape (#172, #179, #183).
export type { FundingShortfall, FundingCoverage } from "./orders/coverage.js";
export { checkFundingCoverage } from "./orders/coverage.js";
export type {
  BitgetOpenOrder,
  BitgetRowProblem,
  BitgetRowSkip,
  BitgetOpenOrdersParse,
} from "./orders/bitget.js";
export {
  BITGET_OPEN_ORDERS_HEADER,
  BITGET_RESTING_STATUS,
  leavesRungUnweighed,
  parseBitgetOpenOrdersCsv,
} from "./orders/bitget.js";
// `S7` — committed vs available. The ONE committed formula (`./orders/committed.js`)
// that both the `O1` import guard and the rendered report call, and the new PURE
// EXPORT over `buildCanonicalState` that joins the sidecar to the fold at read time.
// A NEW EXPORT, NOT A WIDENING: `CompositionReport`, `DashboardSummary` and
// `CompositionRow` are untouched by this slice.
export type { CommittedRung } from "./orders/committed.js";
export { committedRungs, committedByReserve, isNegativeSlack, SLACK_EPSILON } from "./orders/committed.js";
// `UnmatchedReason`/`UnmatchedRung` are exported once, above, from the module that owns
// them (`./orders/attribution.js`); `available.ts` re-exports them for its own readers.
export type { ReserveCapital, AvailableCapitalReport } from "./orders/available.js";
export { composeAvailableCapital } from "./orders/available.js";
// `S8` — the fill act. Monotonicity PROPOSES a verdict (stamped `derived`, carrying its
// evidence) and refuses on an impossible one; it never writes, and being pure it cannot.
// The act's two records are built together so no caller can author half of one.
export type {
  ObservedRungState,
  BookObservation,
  FillVerdict,
  VerdictEvidence,
  ProposedVerdict,
  MonotonicityContradiction,
  MonotonicityProposal,
  ScopedBook,
} from "./orders/monotonicity.js";
export { proposeFillVerdicts, scopeBookForFill } from "./orders/monotonicity.js";
export type {
  TornFillAct,
  LadderPosition,
  FundingTier,
  OpenLadderTarget,
  AddLadderTarget,
  LadderTarget,
  FillActInput,
  FillAct,
} from "./orders/fill.js";
export {
  fillEventId,
  parseFillEventId,
  reconcileFillActs,
  resolveLadderPosition,
  deriveFundingTier,
  buildFillAct,
} from "./orders/fill.js";

// ADR-015 (one world-state): `buildEventReference` PROJECTS `foldEvents(genesis,
// acceptedSoFar)` — it is the gate's read of the fold, not a second model of the
// world. `applyEventToReference` was withdrawn with the shadow it advanced; a caller
// that needs the world after accepting an event rebuilds from the accepted prefix
// (`walkPendingInbox` does this for both ingest paths).
export {
  buildEventReference,
  crossReferenceEvent,
  PRICE_MARK_MAGNITUDE_THRESHOLD,
  SETTLEMENT_MAGNITUDE_THRESHOLD,
} from "./events/crossref.js";

// The ONE pending-inbox walk both ingest paths fold with (audit finding 9): the
// TUI spine's `ingestInbox` and the price-feed's fetch-time rejection pre-check.
// Each keeps its own error policy; the walk itself cannot drift.
export type {
  IngestWalkInvalid,
  IngestWalkRejection,
  IngestWalkResult,
  IngestWalkOptions,
  IngestWalkWorld,
} from "./events/ingest-walk.js";
export { walkPendingInbox } from "./events/ingest-walk.js";

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
// The venue calendar: how often each source is expected to mark, and the last date
// it owed one. ONE home, shared by the push glance builder and the durable log's
// gap report — two copies would compile happily while disagreeing about whether a
// venue marks on weekends (#266 D4).
export type { VenueCadence } from "./price-feed/venue-calendar.js";
export {
  VENUE_CADENCE,
  PRICE_SOURCES,
  lastExpectedMarkDate,
  owesMarkOn,
} from "./price-feed/venue-calendar.js";
export type { Quote, MarkClock } from "./price-feed/mark.js";
// The trading-day contract every plane must agree on, authored once. The price-feed
// config, the gap report's `REPORT_TIME_ZONE` and the daily wrapper's `MARK_TZ` all
// derive from these rather than restating them.
export {
  TRADING_DAY_TIME_ZONE,
  MARK_HOUR,
  MARK_TIME,
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

// Calendar-date arithmetic over the `asOf`-as-`YYYY-MM-DD`-string convention that
// `tradingDayAsOf` above already owns. The ONE home: the web projection's as-of
// module and the push glance builder both import from here rather than keeping
// private copies (guarded by apps/web/src/calendar-contract.test.ts). Also
// reachable browser-side via the pure `@numisma/engine/calendar` subpath.
export { addDays, daysBetween, isWeekend, weekdayName } from "./calendar.js";

// The `plans.jsonl` sidecar (ADR-004's class, THIRD member) — the operator's
// durable DECLARATION OF INTENT per position, recorded BESIDE the log and never
// folded. Pure declarations only: the record contract, the strict calendar-date
// predicate, and the two closed vocabularies. The file IO lives in
// `@numisma/preferences`, per ADR-001.
//
// Beside them, the pure as-of SELECTORS: `pickPlanAsOf` answers for one position and
// `listPlansAsOf` for every position the sidecar names, both through the five-arm
// `PlanLookup` union — a type, not a convention, so a caller cannot reach `plan`
// without first naming the status.
//
// MANUAL BLOCK, exactly like the orders one above and for the same reason: this
// list is NOT derived from the `PlanRecord` union, so a kind added to the union is
// nameable outside the package only if it is added HERE too.
export type {
  PlanKind,
  DcaCadence,
  IsoDate,
  DcaRung,
  DcaLadderPlanRecord,
  DcaTimePlanRecord,
  NoPlanRecord,
  PlanRecord,
  LoadedPlanRecord,
  PlanSkipReason,
  SkippedPlanLine,
  LoadedPlans,
  ActivePlan,
  LoadedNoPlanRecord,
  PlanLookup,
  PlanRow,
  PlansAsOf,
} from "./plans.js";
export {
  PLAN_KINDS,
  DCA_CADENCES,
  isIsoCalendarDate,
  pickPlanAsOf,
  listPlansAsOf,
} from "./plans.js";

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
  formatAvailableCapital,
  formatClosedBook,
  formatInvalidationWatch,
  formatProfitSplit,
} from "./format.js";
