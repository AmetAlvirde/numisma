/**
 * Base types and enums for the Numisma application
 * These are the foundational types that other types will build upon
 */

// ===================================================================
// CORE ENUMS
// ===================================================================

/**
 * Position lifecycle states
 */
export enum PositionLifecycle {
  PLANNED = "PLANNED",
  ACTIVE = "ACTIVE",
  CLOSED = "CLOSED",
  CANCELLED = "CANCELLED",
}

/**
 * Capital tier classification
 * Tracks the origin of capital used in positions
 */
export enum CapitalTier {
  C1 = "C1", // Fresh capital from external sources
  C2 = "C2", // Realized profits from previous trades
  C3 = "C3", // Compound growth from C2 profits
  C4 = "C4", // Compound growth from C3 profits
  C5 = "C5", // Compound growth from C4 profits
}

/**
 * Asset location types
 */
export enum AssetLocationType {
  EXCHANGE = "EXCHANGE",
  DEX = "DEX",
  COLD_STORAGE = "COLD_STORAGE",
  DEFI = "DEFI",
  STAKING = "STAKING",
  LENDING = "LENDING",
}

/**
 * Order status states
 */
export enum OrderStatus {
  SUBMITTED = "SUBMITTED",
  FILLED = "FILLED",
  CANCELLED = "CANCELLED",
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  EXPIRED = "EXPIRED",
}

/**
 * Order types
 */
export enum OrderType {
  TRIGGER = "TRIGGER",
  MARKET = "MARKET",
  LIMIT = "LIMIT",
  TRAILING_STOP = "TRAILING_STOP",
  OCO = "OCO",
}

/**
 * Order purpose
 */
export enum OrderPurpose {
  ENTRY = "ENTRY",
  EXIT = "EXIT",
  STOP_LOSS = "STOP_LOSS",
  TAKE_PROFIT = "TAKE_PROFIT",
}

/**
 * Portfolio status
 */
export enum PortfolioStatus {
  ACTIVE = "ACTIVE",
  ARCHIVED = "ARCHIVED",
  DELETED = "DELETED",
}

/**
 * Risk profile classification
 */
export enum RiskProfile {
  CONSERVATIVE = "CONSERVATIVE",
  MODERATE = "MODERATE",
  AGGRESSIVE = "AGGRESSIVE",
  CUSTOM = "CUSTOM",
}

/**
 * Asset types
 */
export enum AssetType {
  CRYPTO = "CRYPTO",
  STOCK = "STOCK",
  FOREX = "FOREX",
  COMMODITY = "COMMODITY",
  STABLECOIN = "STABLECOIN",
  NFT = "NFT",
  TOKEN = "TOKEN",
}

// ===================================================================
// CORE UTILITY TYPES
// ===================================================================

/**
 * Type-safe foreign key with brand to prevent type confusion
 */
export type ForeignKey<T> = string & { readonly brand: unique symbol };

/**
 * Cascade behavior options
 */
export enum CascadeBehavior {
  CASCADE = "CASCADE",
  RESTRICT = "RESTRICT",
  SET_NULL = "SET_NULL",
  NO_ACTION = "NO_ACTION",
}

/**
 * Relation options for type-safe relationships
 */
export interface RelationOptions {
  onDelete?: CascadeBehavior;
  onUpdate?: CascadeBehavior;
}

/**
 * Type-safe many-to-many relationship helper
 */
export interface ManyToMany<T> {
  items: T[];
  add: (item: T) => void;
  remove: (item: T) => void;
}

// ===================================================================
// DATE HANDLING
// ===================================================================

/**
 * Pre-tracking status for positions that existed before system tracking
 */
export interface PreTrackingStatus {
  isPreTracking: boolean;
  dateOpened: Date | null;
}

// ===================================================================
// VALIDATION TYPES
// ===================================================================

/**
 * Type for validation results
 */
export interface ValidationResult<T> {
  isValid: boolean;
  errors: ValidationError[];
  data?: T;
}

/**
 * Type for validation errors
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  details?: Record<string, any>;
}

/**
 * Type for validation rules
 */
export interface ValidationRule<T> {
  validate: (value: T, context: ValidationContext) => ValidationResult<T>;
  message: string;
  code: string;
}

/**
 * Type for validation context
 */
export interface ValidationContext {
  field: string;
  parent?: any;
  options?: Record<string, any>;
}

// ==========================================
// RELATIONSHIP TYPES
// ==========================================

/**
 * Cascade behavior options for relationships
 */
export enum CascadeBehavior {
  Cascade = "Cascade",
  Restrict = "Restrict",
  SetNull = "SetNull",
  NoAction = "NoAction",
}

/**
 * Options for relationship configuration
 */
export interface RelationOptions {
  onDelete?: CascadeBehavior;
  onUpdate?: CascadeBehavior;
}

/**
 * Type for one-to-one relationships
 */
export type OneToOne<T> = T | null;

/**
 * Type for one-to-many relationships
 */
export type OneToMany<T> = T[];

/**
 * Type for many-to-many relationships
 */
export interface ManyToMany<T> {
  items: T[];
  add: (item: T) => void;
  remove: (item: T) => void;
}

/**
 * Type for relationship metadata
 */
export interface RelationMetadata {
  cascade: CascadeBehavior;
  isRequired: boolean;
  isUnique: boolean;
}

// ==========================================
// UTILITY TYPES
// ==========================================

/**
 * Type for pagination parameters
 */
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * Type for paginated results
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Type for filtering parameters
 */
export interface FilterParams {
  field: string;
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "startsWith"
    | "endsWith"
    | "in"
    | "nin";
  value: any;
}

/**
 * Type for query parameters
 */
export interface QueryParams {
  filters?: FilterParams[];
  pagination?: PaginationParams;
  includes?: string[];
}

/**
 * Type for operation results
 */
export interface OperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Type for batch operation results
 */
export interface BatchOperationResult<T> {
  success: boolean;
  results: OperationResult<T>[];
  total: number;
  successful: number;
  failed: number;
}

// ==========================================
// TYPE GUARDS
// ==========================================

/**
 * Type guard for foreign keys
 */
export function isForeignKey<T>(value: unknown): value is ForeignKey<T> {
  return typeof value === "string" && value.length > 0;
}

/**
 * Type guard for cascade behavior
 */
export function isCascadeBehavior(value: unknown): value is CascadeBehavior {
  return Object.values(CascadeBehavior).includes(value as CascadeBehavior);
}

/**
 * Type guard for relation options
 */
export function isRelationOptions(value: unknown): value is RelationOptions {
  if (typeof value !== "object" || value === null) return false;
  const options = value as RelationOptions;
  return (
    (options.onDelete === undefined || isCascadeBehavior(options.onDelete)) &&
    (options.onUpdate === undefined || isCascadeBehavior(options.onUpdate))
  );
}

/**
 * Type guard for pagination parameters
 */
export function isPaginationParams(value: unknown): value is PaginationParams {
  if (typeof value !== "object" || value === null) return false;
  const params = value as PaginationParams;
  return (
    typeof params.page === "number" &&
    typeof params.limit === "number" &&
    (params.sortBy === undefined || typeof params.sortBy === "string") &&
    (params.sortOrder === undefined ||
      ["asc", "desc"].includes(params.sortOrder))
  );
}

/**
 * Type guard for filter parameters
 */
export function isFilterParams(value: unknown): value is FilterParams {
  if (typeof value !== "object" || value === null) return false;
  const params = value as FilterParams;
  return (
    typeof params.field === "string" &&
    typeof params.operator === "string" &&
    typeof params.value !== "undefined"
  );
}

/**
 * Type guard for query parameters
 */
export function isQueryParams(value: unknown): value is QueryParams {
  if (typeof value !== "object" || value === null) return false;
  const params = value as QueryParams;
  return (
    (params.filters === undefined || Array.isArray(params.filters)) &&
    (params.pagination === undefined ||
      isPaginationParams(params.pagination)) &&
    (params.includes === undefined || Array.isArray(params.includes))
  );
}

/**
 * Type guard for operation results
 */
export function isOperationResult<T>(
  value: unknown
): value is OperationResult<T> {
  if (typeof value !== "object" || value === null) return false;
  const result = value as OperationResult<T>;
  return (
    typeof result.success === "boolean" &&
    (result.data === undefined || result.data !== null) &&
    (result.error === undefined || typeof result.error === "string") &&
    (result.metadata === undefined || typeof result.metadata === "object")
  );
}

/**
 * Type guard for batch operation results
 */
export function isBatchOperationResult<T>(
  value: unknown
): value is BatchOperationResult<T> {
  if (typeof value !== "object" || value === null) return false;
  const result = value as BatchOperationResult<T>;
  return (
    typeof result.success === "boolean" &&
    Array.isArray(result.results) &&
    typeof result.total === "number" &&
    typeof result.successful === "number" &&
    typeof result.failed === "number"
  );
}
