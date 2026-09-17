import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import type { SquareEnvironmentName } from "@/lib/square-subscription-plans";
import type { BillingCycle, ZenciergePlanId } from "@/lib/zencierge-plans";
import {
  SquareBillingStoreError,
  assertNoSquareBillingTokenKeys,
  isEnrollableSquareSubscriptionStatus,
  mapSquareSubscriptionStatusToHostStatus,
  type CompleteSquareSubscriptionIntentInput,
  type CorrelateSquareInvoicePaymentInput,
  type CreateSquareSubscriptionIntentInput,
  type DisableSquarePaymentMethodInput,
  type ExpireSquareSubscriptionIntentInput,
  type FailSquareSubscriptionIntentInput,
  type PersistSquarePaymentMethodInput,
  type PersistSquareSubscriptionInput,
  type PersistSquareSubscriptionInvoiceInput,
  type RecordSquareCustomerInput,
  type SquareBillingStores,
  type SquareCorrelatablePaymentRow,
  type SquareHostSubscriptionCorrelation,
  type SquareHostSubscriptionPersistence,
  type SquareInvoicePaymentCorrelationResult,
  type SquareInvoicePersistenceResult,
  type SquareIntentPersistenceResult,
  type SquarePaymentMethodPersistenceResult,
  type SquarePaymentMethodRow,
  type SquareSubscriptionInvoiceRow,
  type SquareSubscriptionIntentRow,
  type SquareSubscriptionIntentStatus,
  type SquareSubscriptionPersistenceResult,
} from "@/lib/square-billing-stores";

/** Server-only. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("square-billing-supabase-stores is server-only");
}

const OPEN_INTENT_STATUSES = new Set<SquareSubscriptionIntentStatus>([
  "pending",
  "customer_ready",
  "card_ready",
  "subscription_ready",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const LAST_FOUR_PATTERN = /^\d{4}$/;
const PLAN_IDS = new Set<ZenciergePlanId>([
  "starter",
  "pro",
  "portfolio",
  "agency",
]);
const BILLING_CYCLE_VALUES = new Set<BillingCycle>(["monthly", "annual"]);
const INTENT_STATUSES = new Set<SquareSubscriptionIntentStatus>([
  "pending",
  "customer_ready",
  "card_ready",
  "subscription_ready",
  "completed",
  "failed",
  "expired",
]);
const MAX_NUMERIC_CENTS = 9_999_999_999;

const INTENT_COLUMNS =
  "id, user_id, plan_id, billing_cycle, billing_amount_usd, status, square_environment, square_location_id, square_plan_variation_id, square_customer_id, square_card_id, square_subscription_id, customer_idempotency_key, card_idempotency_key, subscription_idempotency_key, complimentary_until, expires_at, last_error_code, created_at, updated_at";
const PAYMENT_METHOD_COLUMNS =
  "id, user_id, square_environment, square_customer_id, square_card_id, card_brand, last_4, exp_month, exp_year, enabled, consented_at, created_at, updated_at";
const INVOICE_COLUMNS =
  "square_environment, square_invoice_id, square_subscription_id, square_order_id, square_location_id, user_id, plan_id, billing_cycle, square_plan_variation_id, square_invoice_status, square_invoice_version, amount_usd, currency, due_date, paid_at, created_at, updated_at";
const PAYMENT_CORRELATION_COLUMNS =
  "id, provider_payment_id, billing_cycle, square_environment, square_location_id, square_subscription_id, square_invoice_id, square_order_id";

export type SquareBillingDbError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const HOST_CORRELATION_UPSERT_RPC =
  "square_billing_upsert_host_square_correlation" as const;

export type HostCorrelationUpsertDiagnosticKind =
  | "rpc_error"
  | "unexpected_row_count";

export type HostCorrelationUpsertDiagnostic = {
  operation: typeof HOST_CORRELATION_UPSERT_RPC;
  diagnosticKind: HostCorrelationUpsertDiagnosticKind;
  errorCode?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  rowCount?: number | null;
};

function isSensitiveHostCorrelationDiagnosticText(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("token") ||
    normalized.includes("nonce") ||
    normalized.includes("sourceid") ||
    normalized.includes("source_id") ||
    normalized.includes("service_role") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("authorization") ||
    normalized.includes("bearer") ||
    normalized.includes("customer_id") ||
    normalized.includes("user_id") ||
    normalized.includes("card_id") ||
    normalized.includes("subscription_id") ||
    /eyj[\w-]+\.[\w-]+\.[\w-]+/i.test(value) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(
      value,
    )
  );
}

export function safeHostCorrelationDiagnosticText(
  value: unknown,
  maxLength = 160,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  if (!trimmed) return null;
  if (isSensitiveHostCorrelationDiagnosticText(trimmed)) return null;
  return trimmed;
}

/** Dev/server only. Never logs payload, ids, tokens, or headers. */
export function logSafeHostCorrelationUpsertDiagnostic(
  diagnostic: HostCorrelationUpsertDiagnostic,
): void {
  const payload: Record<string, unknown> = {
    operation: HOST_CORRELATION_UPSERT_RPC,
    diagnosticKind: diagnostic.diagnosticKind,
  };
  if (diagnostic.diagnosticKind === "rpc_error") {
    payload.errorCode = diagnostic.errorCode ?? null;
    payload.message = safeHostCorrelationDiagnosticText(diagnostic.message);
    payload.details = safeHostCorrelationDiagnosticText(diagnostic.details);
    payload.hint = safeHostCorrelationDiagnosticText(diagnostic.hint);
    if (diagnostic.rowCount !== undefined) {
      payload.rowCount = diagnostic.rowCount;
    }
  } else {
    payload.rowCount = diagnostic.rowCount ?? null;
  }
  console.info(JSON.stringify(payload));
}

export type SquareBillingDbResponse<T> = {
  data: T;
  error: SquareBillingDbError | null;
  count?: number | null;
};

/**
 * Minimal Supabase/PostgREST surface used by this module.
 * Injected in production (service-role client) and replaced by fakes in tests.
 */
export type SquareBillingSupabaseQuery = {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => SquareBillingSupabaseQuery;
  insert: (values: Record<string, unknown>) => SquareBillingSupabaseQuery;
  update: (values: Record<string, unknown>) => SquareBillingSupabaseQuery;
  eq: (column: string, value: unknown) => SquareBillingSupabaseQuery;
  in: (column: string, values: readonly unknown[]) => SquareBillingSupabaseQuery;
  is: (column: string, value: null) => SquareBillingSupabaseQuery;
  or: (filters: string) => SquareBillingSupabaseQuery;
  order: (
    column: string,
    options?: { ascending?: boolean },
  ) => SquareBillingSupabaseQuery;
  limit: (count: number) => SquareBillingSupabaseQuery;
  maybeSingle: () => Promise<SquareBillingDbResponse<Record<string, unknown> | null>>;
  then: <TResult1 = SquareBillingDbResponse<Record<string, unknown>[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: SquareBillingDbResponse<Record<string, unknown>[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

export type SquareBillingSupabaseClient = {
  from: (table: string) => SquareBillingSupabaseQuery;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<
    SquareBillingDbResponse<
      Record<string, unknown>[] | Record<string, unknown> | null
    >
  >;
};

export type CreateSupabaseSquareBillingStoresOptions = {
  client: SquareBillingSupabaseClient;
  now?: () => Date;
  uuid?: () => string;
};

function invalidInput(): never {
  throw new SquareBillingStoreError("invalid_input");
}
function conflict(): never {
  throw new SquareBillingStoreError("conflict");
}
function invalidLifecycle(): never {
  throw new SquareBillingStoreError("invalid_lifecycle");
}
function notFound(): never {
  throw new SquareBillingStoreError("not_found");
}
function unavailable(): never {
  throw new SquareBillingStoreError("unavailable");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  assertNoSquareBillingTokenKeys(value);
  if (!isRecord(value)) invalidInput();
  return value;
}

function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalidInput();
  return value;
}

function requireNonblank(value: unknown, maximum = 1024): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    invalidInput();
  }
  return value;
}

function requireNullableNonblank(value: unknown, maximum = 1024): string | null {
  if (value === null) return null;
  return requireNonblank(value, maximum);
}

function requireEnvironment(value: unknown): SquareEnvironmentName {
  if (value !== "sandbox" && value !== "production") invalidInput();
  return value;
}

function requirePlan(value: unknown): ZenciergePlanId {
  if (!PLAN_IDS.has(value as ZenciergePlanId)) invalidInput();
  return value as ZenciergePlanId;
}

function requireBillingCycle(value: unknown): BillingCycle {
  if (!BILLING_CYCLE_VALUES.has(value as BillingCycle)) invalidInput();
  return value as BillingCycle;
}

function requireIntentStatus(value: unknown): SquareSubscriptionIntentStatus {
  if (!INTENT_STATUSES.has(value as SquareSubscriptionIntentStatus)) invalidInput();
  return value as SquareSubscriptionIntentStatus;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalidInput();
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) invalidInput();
  requireCalendarDate(value.slice(0, 10));
  if (!Number.isFinite(Date.parse(value))) invalidInput();
  return value;
}

function requireNullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return requireTimestamp(value);
}

function requireCalendarDate(value: unknown): string {
  if (typeof value !== "string" || !CALENDAR_DATE_PATTERN.test(value)) invalidInput();
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    invalidInput();
  }
  return value;
}

function requireNullableCalendarDate(value: unknown): string | null {
  if (value === null) return null;
  return requireCalendarDate(value);
}

function requireMoney(value: unknown, allowZero: boolean): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) invalidInput();
  if ((allowZero && numeric < 0) || (!allowZero && numeric <= 0)) invalidInput();
  const roundedToCents = Number(numeric.toFixed(2));
  if (roundedToCents !== numeric || numeric * 100 > MAX_NUMERIC_CENTS) invalidInput();
  return numeric;
}

function requireNullableMoney(value: unknown): number | null {
  if (value === null) return null;
  return requireMoney(value, true);
}

function requireNullableVersion(value: unknown): number | null {
  if (value === null) return null;
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(numeric) || numeric < 0) invalidInput();
  return numeric;
}

function requireNullableExpirationMonth(value: unknown): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 12) invalidInput();
  return numeric;
}

function requireNullableExpirationYear(value: unknown): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 2000 || numeric > 2_147_483_647) {
    invalidInput();
  }
  return numeric;
}

function requireNullableLastFour(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !LAST_FOUR_PATTERN.test(value)) invalidInput();
  return value;
}

function currentIso(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalidInput();
  return value.toISOString();
}

function generatedUuid(uuid: () => string): string {
  return requireUuid(uuid());
}

function timestampFromDb(value: unknown): string {
  if (typeof value !== "string") invalidInput();
  if (ISO_TIMESTAMP_PATTERN.test(value)) return requireTimestamp(value);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalidInput();
  return new Date(parsed).toISOString();
}

function nullableTimestampFromDb(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return timestampFromDb(value);
}

function dateFromDb(value: unknown): string {
  if (typeof value !== "string") invalidInput();
  return requireCalendarDate(value.slice(0, 10));
}

function nullableDateFromDb(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return dateFromDb(value);
}

/** Maps Postgres/PostgREST failures without leaking credentials or SQL payloads. */
export function mapSquareBillingDbError(error: SquareBillingDbError | null | undefined): never {
  if (!error) unavailable();
  if (error.code === "23505" || error.code === "ZB409") conflict();
  if (error.code === "ZB001") invalidInput();
  unavailable();
}

function throwIfDbError(error: SquareBillingDbError | null | undefined): void {
  if (error) mapSquareBillingDbError(error);
}

function cloneIntent(row: SquareSubscriptionIntentRow): SquareSubscriptionIntentRow {
  return { ...row };
}
function clonePaymentMethod(row: SquarePaymentMethodRow): SquarePaymentMethodRow {
  return { ...row };
}
function cloneInvoice(row: SquareSubscriptionInvoiceRow): SquareSubscriptionInvoiceRow {
  return { ...row };
}
function cloneSubscription(
  row: SquareHostSubscriptionPersistence,
): SquareHostSubscriptionPersistence {
  return { ...row };
}
function clonePayment(row: SquareCorrelatablePaymentRow): SquareCorrelatablePaymentRow {
  return { ...row };
}

function parseIntentRow(value: Record<string, unknown>): SquareSubscriptionIntentRow {
  return {
    id: requireUuid(value.id),
    user_id: requireUuid(value.user_id),
    plan_id: requirePlan(value.plan_id),
    billing_cycle: requireBillingCycle(value.billing_cycle),
    billing_amount_usd: requireMoney(value.billing_amount_usd, false),
    status: requireIntentStatus(value.status),
    square_environment: requireEnvironment(value.square_environment),
    square_location_id: requireNonblank(value.square_location_id),
    square_plan_variation_id: requireNonblank(value.square_plan_variation_id),
    square_customer_id: requireNullableNonblank(value.square_customer_id ?? null),
    square_card_id: requireNullableNonblank(value.square_card_id ?? null),
    square_subscription_id: requireNullableNonblank(value.square_subscription_id ?? null),
    customer_idempotency_key: requireNonblank(value.customer_idempotency_key, 45),
    card_idempotency_key: requireNonblank(value.card_idempotency_key, 45),
    subscription_idempotency_key: requireNonblank(value.subscription_idempotency_key, 45),
    complimentary_until: nullableTimestampFromDb(value.complimentary_until ?? null),
    expires_at: timestampFromDb(value.expires_at),
    last_error_code: requireNullableNonblank(value.last_error_code ?? null, 128),
    created_at: timestampFromDb(value.created_at),
    updated_at: timestampFromDb(value.updated_at),
  };
}

function parsePaymentMethodRow(value: Record<string, unknown>): SquarePaymentMethodRow {
  return {
    id: requireUuid(value.id),
    user_id: requireUuid(value.user_id),
    square_environment: requireEnvironment(value.square_environment),
    square_customer_id: requireNonblank(value.square_customer_id),
    square_card_id: requireNonblank(value.square_card_id),
    card_brand: requireNullableNonblank(value.card_brand ?? null),
    last_4: requireNullableLastFour(value.last_4 ?? null),
    exp_month: requireNullableExpirationMonth(value.exp_month ?? null),
    exp_year: requireNullableExpirationYear(value.exp_year ?? null),
    enabled: requireBoolean(value.enabled),
    consented_at: timestampFromDb(value.consented_at),
    created_at: timestampFromDb(value.created_at),
    updated_at: timestampFromDb(value.updated_at),
  };
}

function parseInvoiceRow(value: Record<string, unknown>): SquareSubscriptionInvoiceRow {
  return {
    square_environment: requireEnvironment(value.square_environment),
    square_invoice_id: requireNonblank(value.square_invoice_id),
    square_subscription_id: requireNonblank(value.square_subscription_id),
    square_order_id: requireNullableNonblank(value.square_order_id ?? null),
    square_location_id: requireNonblank(value.square_location_id),
    user_id: requireUuid(value.user_id),
    plan_id: requirePlan(value.plan_id),
    billing_cycle: requireBillingCycle(value.billing_cycle),
    square_plan_variation_id: requireNonblank(value.square_plan_variation_id),
    square_invoice_status: requireNonblank(value.square_invoice_status),
    square_invoice_version: requireNullableVersion(value.square_invoice_version ?? null),
    amount_usd: requireNullableMoney(value.amount_usd ?? null),
    currency: requireNullableNonblank(value.currency ?? null, 16),
    due_date: nullableDateFromDb(value.due_date ?? null),
    paid_at: nullableTimestampFromDb(value.paid_at ?? null),
    created_at: timestampFromDb(value.created_at),
    updated_at: timestampFromDb(value.updated_at),
  };
}

function parseHostSubscription(
  value: Record<string, unknown>,
): SquareHostSubscriptionPersistence {
  return {
    user_id: requireUuid(value.user_id),
    plan_id: requirePlan(value.plan_id),
    billing_cycle: requireBillingCycle(value.billing_cycle),
    billing_amount_usd: requireMoney(value.billing_amount_usd, false),
    square_environment: requireEnvironment(value.square_environment),
    square_location_id: requireNonblank(value.square_location_id),
    square_plan_variation_id: requireNonblank(value.square_plan_variation_id),
    square_customer_id: requireNonblank(value.square_customer_id),
    square_subscription_id: requireNonblank(value.square_subscription_id),
    square_subscription_status: requireNonblank(value.square_subscription_status),
    square_subscription_version: requireNullableVersion(
      value.square_subscription_version ?? null,
    ),
    square_start_date: nullableDateFromDb(value.square_start_date ?? null),
    square_charged_through_date: nullableDateFromDb(
      value.square_charged_through_date ?? null,
    ),
    square_canceled_date: nullableDateFromDb(value.square_canceled_date ?? null),
    complimentary_ends_at: nullableTimestampFromDb(value.complimentary_ends_at ?? null),
  };
}

function parsePaymentRow(value: Record<string, unknown>): SquareCorrelatablePaymentRow {
  return {
    id: requireUuid(value.id),
    provider_payment_id: requireNonblank(value.provider_payment_id),
    billing_cycle:
      value.billing_cycle === null || value.billing_cycle === undefined
        ? null
        : requireBillingCycle(value.billing_cycle),
    square_environment:
      value.square_environment === null || value.square_environment === undefined
        ? null
        : requireEnvironment(value.square_environment),
    square_location_id: requireNullableNonblank(value.square_location_id ?? null),
    square_subscription_id: requireNullableNonblank(value.square_subscription_id ?? null),
    square_invoice_id: requireNullableNonblank(value.square_invoice_id ?? null),
    square_order_id: requireNullableNonblank(value.square_order_id ?? null),
  };
}

function subscriptionsEqual(
  left: SquareHostSubscriptionPersistence,
  right: SquareHostSubscriptionPersistence,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function paymentMethodsEqual(
  row: SquarePaymentMethodRow,
  input: {
    squareCardId: string;
    cardBrand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    consentedAt: string;
  },
) {
  return (
    row.enabled &&
    row.square_card_id === input.squareCardId &&
    row.card_brand === input.cardBrand &&
    row.last_4 === input.last4 &&
    row.exp_month === input.expMonth &&
    row.exp_year === input.expYear &&
    row.consented_at === input.consentedAt
  );
}

function invoicesHaveSameProviderValues(
  row: SquareSubscriptionInvoiceRow,
  input: PersistSquareSubscriptionInvoiceInput,
) {
  return (
    row.square_environment === input.squareEnvironment &&
    row.square_invoice_id === input.squareInvoiceId &&
    row.square_subscription_id === input.squareSubscriptionId &&
    row.square_order_id === input.squareOrderId &&
    row.square_invoice_status === input.squareInvoiceStatus &&
    row.square_invoice_version === input.squareInvoiceVersion &&
    row.amount_usd === input.amountUsd &&
    row.currency === input.currency &&
    row.due_date === input.dueDate &&
    row.paid_at === input.paidAt
  );
}

function trustedSubscription(
  row: SquareSubscriptionIntentRow,
  provider: {
    squareSubscriptionId: string;
    squareSubscriptionStatus: string;
    squareSubscriptionVersion: number | null;
    startDate: string | null;
    chargedThroughDate: string | null;
    canceledDate: string | null;
  },
): SquareHostSubscriptionPersistence {
  if (!row.square_customer_id || !row.square_card_id) invalidLifecycle();
  return {
    user_id: row.user_id,
    plan_id: row.plan_id,
    billing_cycle: row.billing_cycle,
    billing_amount_usd: row.billing_amount_usd,
    square_environment: row.square_environment,
    square_location_id: row.square_location_id,
    square_plan_variation_id: row.square_plan_variation_id,
    square_customer_id: row.square_customer_id,
    square_subscription_id: provider.squareSubscriptionId,
    square_subscription_status: provider.squareSubscriptionStatus,
    square_subscription_version: provider.squareSubscriptionVersion,
    square_start_date: provider.startDate,
    square_charged_through_date: provider.chargedThroughDate,
    square_canceled_date: provider.canceledDate,
    complimentary_ends_at: row.complimentary_until,
  };
}

async function awaitRows(
  query: SquareBillingSupabaseQuery,
): Promise<Record<string, unknown>[]> {
  const response = (await query) as SquareBillingDbResponse<Record<string, unknown>[]>;
  throwIfDbError(response.error);
  return response.data ?? [];
}

/**
 * Production Supabase-backed SquareBillingStores.
 * Uses service-role client only. No Square API calls. No route wiring.
 */
export function createSupabaseSquareBillingStores(
  options: CreateSupabaseSquareBillingStoresOptions,
): SquareBillingStores {
  // Do not deep-inspect `client` — Supabase clients expose auth getters that
  // falsely trip assertNoSquareBillingTokenKeys.
  if (options.now !== undefined) assertNoSquareBillingTokenKeys({ nowLabel: "now" });
  if (options.uuid !== undefined) assertNoSquareBillingTokenKeys({ uuidLabel: "uuid" });
  const client = options.client;
  if (
    !client ||
    typeof client.from !== "function" ||
    typeof client.rpc !== "function"
  ) {
    invalidInput();
  }
  const now = options.now ?? (() => new Date());
  const uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());

  async function getIntentRow(intentId: string): Promise<SquareSubscriptionIntentRow | null> {
    const response = await client
      .from("square_subscription_intents")
      .select(INTENT_COLUMNS)
      .eq("id", intentId)
      .maybeSingle();
    throwIfDbError(response.error);
    if (!response.data) return null;
    return parseIntentRow(response.data);
  }

  async function markExpired(
    row: SquareSubscriptionIntentRow,
    nowIso: string,
  ): Promise<SquareSubscriptionIntentRow> {
    const response = await client
      .from("square_subscription_intents")
      .update({ status: "expired", updated_at: nowIso })
      .eq("id", row.id)
      .in("status", [...OPEN_INTENT_STATUSES])
      .select(INTENT_COLUMNS)
      .maybeSingle();
    throwIfDbError(response.error);
    if (!response.data) {
      const latest = await getIntentRow(row.id);
      if (!latest) notFound();
      return latest;
    }
    return parseIntentRow(response.data);
  }

  async function expireIfNecessary(
    row: SquareSubscriptionIntentRow,
    nowIso: string,
  ): Promise<SquareSubscriptionIntentRow> {
    if (
      OPEN_INTENT_STATUSES.has(row.status) &&
      Date.parse(row.expires_at) <= Date.parse(nowIso)
    ) {
      return markExpired(row, nowIso);
    }
    return row;
  }

  async function requireLiveIntent(intentId: string, nowIso: string) {
    const loaded = await getIntentRow(intentId);
    if (!loaded) notFound();
    const row = await expireIfNecessary(loaded, nowIso);
    if (row.status === "expired") throw new SquareBillingStoreError("expired");
    return row;
  }

  async function findOpenIntent(userId: string, environment: SquareEnvironmentName) {
    const rows = await awaitRows(
      client
        .from("square_subscription_intents")
        .select(INTENT_COLUMNS)
        .eq("user_id", userId)
        .eq("square_environment", environment)
        .in("status", [...OPEN_INTENT_STATUSES])
        .limit(2),
    );
    if (rows.length > 1) conflict();
    return rows[0] ? parseIntentRow(rows[0]) : null;
  }

  function rpcRows(
    data: Record<string, unknown>[] | Record<string, unknown> | null | undefined,
  ): Record<string, unknown>[] {
    if (data == null) return [];
    return Array.isArray(data) ? data : [data];
  }

  async function hostCustomerOwners(
    environment: SquareEnvironmentName,
    squareCustomerId: string,
  ): Promise<string[]> {
    const response = await client.rpc("square_billing_host_customer_owners", {
      p_square_environment: environment,
      p_square_customer_id: squareCustomerId,
    });
    throwIfDbError(response.error);
    return rpcRows(response.data).map((row) => requireUuid(row.user_id));
  }

  async function findHostBySubscription(
    environment: SquareEnvironmentName,
    squareSubscriptionId: string,
  ) {
    const response = await client.rpc("square_billing_host_by_subscription", {
      p_square_environment: environment,
      p_square_subscription_id: squareSubscriptionId,
    });
    throwIfDbError(response.error);
    const rows = rpcRows(response.data);
    if (rows.length === 0) return null;
    if (rows.length > 1) conflict();
    return parseHostSubscription(rows[0]!);
  }

  async function writeHostSubscription(
    trusted: SquareHostSubscriptionPersistence,
    _nowIso: string,
  ) {
    void _nowIso;
    const response = await client.rpc(HOST_CORRELATION_UPSERT_RPC, {
      p_user_id: trusted.user_id,
      p_plan_id: trusted.plan_id,
      p_billing_cycle: trusted.billing_cycle,
      p_billing_amount_usd: trusted.billing_amount_usd,
      p_square_environment: trusted.square_environment,
      p_square_location_id: trusted.square_location_id,
      p_square_plan_variation_id: trusted.square_plan_variation_id,
      p_square_customer_id: trusted.square_customer_id,
      p_square_subscription_id: trusted.square_subscription_id,
      p_square_subscription_status: trusted.square_subscription_status,
      p_square_subscription_version: trusted.square_subscription_version,
      p_square_start_date: trusted.square_start_date,
      p_square_charged_through_date: trusted.square_charged_through_date,
      p_square_canceled_date: trusted.square_canceled_date,
      p_complimentary_ends_at: trusted.complimentary_ends_at,
    });
    const rows = rpcRows(response.data);
    if (response.error) {
      logSafeHostCorrelationUpsertDiagnostic({
        operation: HOST_CORRELATION_UPSERT_RPC,
        diagnosticKind: "rpc_error",
        errorCode: response.error.code ?? null,
        message: response.error.message ?? null,
        details: response.error.details ?? null,
        hint: response.error.hint ?? null,
        rowCount: rows.length,
      });
      throwIfDbError(response.error);
    }
    if (rows.length !== 1) {
      logSafeHostCorrelationUpsertDiagnostic({
        operation: HOST_CORRELATION_UPSERT_RPC,
        diagnosticKind: "unexpected_row_count",
        rowCount: rows.length,
      });
      unavailable();
    }
    return parseHostSubscription(rows[0]!);
  }

  return {
    intents: {
      async createIntent(input: CreateSquareSubscriptionIntentInput): Promise<SquareIntentPersistenceResult> {
        const value = requireRecord(input);
        const createdAt = currentIso(now);
        const normalized = {
          userId: requireUuid(value.userId),
          planId: requirePlan(value.planId),
          billingCycle: requireBillingCycle(value.billingCycle),
          billingAmountUsd: requireMoney(value.billingAmountUsd, false),
          squareEnvironment: requireEnvironment(value.squareEnvironment),
          squareLocationId: requireNonblank(value.squareLocationId),
          squarePlanVariationId: requireNonblank(value.squarePlanVariationId),
          complimentaryUntil: requireNullableTimestamp(value.complimentaryUntil),
          expiresAt: requireTimestamp(value.expiresAt),
        };
        if (Date.parse(normalized.expiresAt) <= Date.parse(createdAt)) invalidInput();

        let open = await findOpenIntent(normalized.userId, normalized.squareEnvironment);
        if (open) {
          open = await expireIfNecessary(open, createdAt);
        }
        if (open && OPEN_INTENT_STATUSES.has(open.status)) {
          const exact =
            open.status === "pending" &&
            open.plan_id === normalized.planId &&
            open.billing_cycle === normalized.billingCycle &&
            open.billing_amount_usd === normalized.billingAmountUsd &&
            open.square_location_id === normalized.squareLocationId &&
            open.square_plan_variation_id === normalized.squarePlanVariationId &&
            open.complimentary_until === normalized.complimentaryUntil &&
            open.expires_at === normalized.expiresAt;
          if (!exact) conflict();
          return { intent: cloneIntent(open), replayed: true };
        }

        const row: SquareSubscriptionIntentRow = {
          id: generatedUuid(uuid),
          user_id: normalized.userId,
          plan_id: normalized.planId,
          billing_cycle: normalized.billingCycle,
          billing_amount_usd: normalized.billingAmountUsd,
          status: "pending",
          square_environment: normalized.squareEnvironment,
          square_location_id: normalized.squareLocationId,
          square_plan_variation_id: normalized.squarePlanVariationId,
          square_customer_id: null,
          square_card_id: null,
          square_subscription_id: null,
          customer_idempotency_key: generatedUuid(uuid),
          card_idempotency_key: generatedUuid(uuid),
          subscription_idempotency_key: generatedUuid(uuid),
          complimentary_until: normalized.complimentaryUntil,
          expires_at: normalized.expiresAt,
          last_error_code: null,
          created_at: createdAt,
          updated_at: createdAt,
        };

        const inserted = await client
          .from("square_subscription_intents")
          .insert({ ...row })
          .select(INTENT_COLUMNS)
          .maybeSingle();
        if (inserted.error?.code === "23505") {
          const raced = await findOpenIntent(
            normalized.userId,
            normalized.squareEnvironment,
          );
          if (!raced) conflict();
          const exact =
            raced.status === "pending" &&
            raced.plan_id === normalized.planId &&
            raced.billing_cycle === normalized.billingCycle &&
            raced.billing_amount_usd === normalized.billingAmountUsd &&
            raced.square_location_id === normalized.squareLocationId &&
            raced.square_plan_variation_id === normalized.squarePlanVariationId &&
            raced.complimentary_until === normalized.complimentaryUntil &&
            raced.expires_at === normalized.expiresAt;
          if (!exact) conflict();
          return { intent: cloneIntent(raced), replayed: true };
        }
        throwIfDbError(inserted.error);
        if (!inserted.data) unavailable();
        return { intent: parseIntentRow(inserted.data), replayed: false };
      },

      async getIntent(intentId: string) {
        assertNoSquareBillingTokenKeys(intentId);
        const id = requireUuid(intentId);
        const row = await getIntentRow(id);
        return row ? cloneIntent(row) : null;
      },

      async recordCustomer(
        input: RecordSquareCustomerInput,
      ): Promise<SquareIntentPersistenceResult> {
        const value = requireRecord(input);
        const intentId = requireUuid(value.intentId);
        const squareCustomerId = requireNonblank(value.squareCustomerId);
        const nowIso = currentIso(now);
        const row = await requireLiveIntent(intentId, nowIso);

        if (row.square_customer_id !== null) {
          if (row.square_customer_id !== squareCustomerId) conflict();
          return { intent: cloneIntent(row), replayed: true };
        }
        if (row.status !== "pending") invalidLifecycle();

        const duplicateIntent = await awaitRows(
          client
            .from("square_subscription_intents")
            .select("id, user_id")
            .eq("square_environment", row.square_environment)
            .eq("square_customer_id", squareCustomerId)
            .limit(2),
        );
        if (
          duplicateIntent.some(
            (candidate) =>
              candidate.id !== row.id && candidate.user_id !== row.user_id,
          )
        ) {
          conflict();
        }
        const duplicateHostOwners = await hostCustomerOwners(
          row.square_environment,
          squareCustomerId,
        );
        if (duplicateHostOwners.some((ownerId) => ownerId !== row.user_id)) {
          conflict();
        }

        const updated = await client
          .from("square_subscription_intents")
          .update({
            square_customer_id: squareCustomerId,
            status: "customer_ready",
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .eq("status", "pending")
          .is("square_customer_id", null)
          .select(INTENT_COLUMNS)
          .maybeSingle();
        throwIfDbError(updated.error);
        if (!updated.data) {
          const latest = await requireLiveIntent(intentId, nowIso);
          if (latest.square_customer_id === squareCustomerId) {
            return { intent: cloneIntent(latest), replayed: true };
          }
          conflict();
        }
        return { intent: parseIntentRow(updated.data), replayed: false };
      },

      async persistSubscription(
        input: PersistSquareSubscriptionInput,
      ): Promise<SquareSubscriptionPersistenceResult> {
        const value = requireRecord(input);
        const normalized = {
          intentId: requireUuid(value.intentId),
          squareSubscriptionId: requireNonblank(value.squareSubscriptionId),
          squareSubscriptionStatus: requireNonblank(value.squareSubscriptionStatus),
          squareSubscriptionVersion: requireNullableVersion(
            value.squareSubscriptionVersion,
          ),
          startDate: requireNullableCalendarDate(value.startDate),
          chargedThroughDate: requireNullableCalendarDate(value.chargedThroughDate),
          canceledDate: requireNullableCalendarDate(value.canceledDate),
        };
        const nowIso = currentIso(now);
        let row = await getIntentRow(normalized.intentId);
        if (!row) notFound();

        const existing = await findHostBySubscription(
          row.square_environment,
          normalized.squareSubscriptionId,
        );
        if (row.status === "completed" && existing) {
          const expected = trustedSubscription(row, normalized);
          if (!subscriptionsEqual(existing, expected)) conflict();
          return {
            intent: cloneIntent(row),
            subscription: cloneSubscription(existing),
            replayed: true,
          };
        }
        row = await expireIfNecessary(row, nowIso);
        if (row.status === "expired") throw new SquareBillingStoreError("expired");
        if (row.status !== "card_ready" && row.status !== "subscription_ready") {
          invalidLifecycle();
        }
        if (!row.square_customer_id || !row.square_card_id) invalidLifecycle();
        if (
          row.square_subscription_id !== null &&
          row.square_subscription_id !== normalized.squareSubscriptionId
        ) {
          conflict();
        }

        const duplicateIntent = await awaitRows(
          client
            .from("square_subscription_intents")
            .select("id")
            .eq("square_environment", row.square_environment)
            .eq("square_subscription_id", normalized.squareSubscriptionId)
            .limit(2),
        );
        if (duplicateIntent.some((candidate) => candidate.id !== row.id)) conflict();

        const trusted = trustedSubscription(row, normalized);
        const customerOwners = await hostCustomerOwners(
          trusted.square_environment,
          trusted.square_customer_id,
        );
        if (customerOwners.some((ownerId) => ownerId !== trusted.user_id)) {
          conflict();
        }
        if (existing && !subscriptionsEqual(existing, trusted)) conflict();

        mapSquareSubscriptionStatusToHostStatus(normalized.squareSubscriptionStatus);

        // Non-atomic pair: intent completion + host_subscriptions allowlisted write.
        const host = await writeHostSubscription(trusted, nowIso);
        if (!isEnrollableSquareSubscriptionStatus(normalized.squareSubscriptionStatus)) {
          return {
            intent: cloneIntent(row),
            subscription: cloneSubscription(host),
            replayed: false,
          };
        }
        const updated = await client
          .from("square_subscription_intents")
          .update({
            square_subscription_id: normalized.squareSubscriptionId,
            status: "completed",
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .in("status", ["card_ready", "subscription_ready"])
          .select(INTENT_COLUMNS)
          .maybeSingle();
        throwIfDbError(updated.error);
        if (!updated.data) {
          const latest = await getIntentRow(row.id);
          if (
            latest?.status === "completed" &&
            latest.square_subscription_id === normalized.squareSubscriptionId
          ) {
            return {
              intent: cloneIntent(latest),
              subscription: cloneSubscription(host),
              replayed: true,
            };
          }
          conflict();
        }
        return {
          intent: parseIntentRow(updated.data),
          subscription: cloneSubscription(host),
          replayed: false,
        };
      },

      async completeIntent(
        input: CompleteSquareSubscriptionIntentInput,
      ): Promise<SquareIntentPersistenceResult> {
        const value = requireRecord(input);
        const intentId = requireUuid(value.intentId);
        const nowIso = currentIso(now);
        let row = await getIntentRow(intentId);
        if (!row) notFound();
        if (row.status === "completed") {
          return { intent: cloneIntent(row), replayed: true };
        }
        row = await expireIfNecessary(row, nowIso);
        if (row.status === "expired") throw new SquareBillingStoreError("expired");
        if (row.status !== "subscription_ready") invalidLifecycle();
        const host = await findHostBySubscription(
          row.square_environment,
          row.square_subscription_id ?? "",
        );
        if (!host) invalidLifecycle();
        const updated = await client
          .from("square_subscription_intents")
          .update({ status: "completed", updated_at: nowIso })
          .eq("id", row.id)
          .eq("status", "subscription_ready")
          .select(INTENT_COLUMNS)
          .maybeSingle();
        throwIfDbError(updated.error);
        if (!updated.data) {
          const latest = await getIntentRow(intentId);
          if (latest?.status === "completed") {
            return { intent: cloneIntent(latest), replayed: true };
          }
          conflict();
        }
        return { intent: parseIntentRow(updated.data), replayed: false };
      },

      async failIntent(
        input: FailSquareSubscriptionIntentInput,
      ): Promise<SquareIntentPersistenceResult> {
        const value = requireRecord(input);
        const intentId = requireUuid(value.intentId);
        const errorCode = requireNonblank(value.errorCode, 128);
        const nowIso = currentIso(now);
        let row = await getIntentRow(intentId);
        if (!row) notFound();
        if (row.status === "failed") {
          if (row.last_error_code !== errorCode) conflict();
          return { intent: cloneIntent(row), replayed: true };
        }
        row = await expireIfNecessary(row, nowIso);
        if (row.status === "expired") throw new SquareBillingStoreError("expired");
        if (!OPEN_INTENT_STATUSES.has(row.status)) invalidLifecycle();
        const updated = await client
          .from("square_subscription_intents")
          .update({
            status: "failed",
            last_error_code: errorCode,
            updated_at: nowIso,
          })
          .eq("id", row.id)
          .in("status", [...OPEN_INTENT_STATUSES])
          .select(INTENT_COLUMNS)
          .maybeSingle();
        throwIfDbError(updated.error);
        if (!updated.data) {
          const latest = await getIntentRow(intentId);
          if (latest?.status === "failed" && latest.last_error_code === errorCode) {
            return { intent: cloneIntent(latest), replayed: true };
          }
          conflict();
        }
        return { intent: parseIntentRow(updated.data), replayed: false };
      },

      async expireIntent(
        input: ExpireSquareSubscriptionIntentInput,
      ): Promise<SquareIntentPersistenceResult> {
        const value = requireRecord(input);
        const intentId = requireUuid(value.intentId);
        const nowIso = currentIso(now);
        const row = await getIntentRow(intentId);
        if (!row) notFound();
        if (row.status === "expired") {
          return { intent: cloneIntent(row), replayed: true };
        }
        if (!OPEN_INTENT_STATUSES.has(row.status)) invalidLifecycle();
        if (Date.parse(row.expires_at) > Date.parse(nowIso)) invalidLifecycle();
        const updated = await markExpired(row, nowIso);
        return { intent: cloneIntent(updated), replayed: false };
      },
    },

    paymentMethods: {
      async persistPaymentMethod(
        input: PersistSquarePaymentMethodInput,
      ): Promise<SquarePaymentMethodPersistenceResult> {
        const value = requireRecord(input);
        const normalized = {
          intentId: requireUuid(value.intentId),
          squareCardId: requireNonblank(value.squareCardId),
          cardBrand: requireNullableNonblank(value.cardBrand),
          last4: requireNullableLastFour(value.last4),
          expMonth: requireNullableExpirationMonth(value.expMonth),
          expYear: requireNullableExpirationYear(value.expYear),
          consentedAt: requireTimestamp(value.consentedAt),
        };
        const nowIso = currentIso(now);
        const intent = await requireLiveIntent(normalized.intentId, nowIso);
        if (!intent.square_customer_id) invalidLifecycle();

        const existingResponse = await client
          .from("square_payment_methods")
          .select(PAYMENT_METHOD_COLUMNS)
          .eq("square_environment", intent.square_environment)
          .eq("square_card_id", normalized.squareCardId)
          .maybeSingle();
        throwIfDbError(existingResponse.error);
        const existing = existingResponse.data
          ? parsePaymentMethodRow(existingResponse.data)
          : null;

        if (intent.square_card_id !== null) {
          if (
            intent.square_card_id !== normalized.squareCardId ||
            !existing ||
            existing.user_id !== intent.user_id ||
            existing.square_customer_id !== intent.square_customer_id ||
            !paymentMethodsEqual(existing, normalized)
          ) {
            conflict();
          }
          return {
            intent: cloneIntent(intent),
            paymentMethod: clonePaymentMethod(existing),
            replayed: true,
          };
        }
        if (intent.status !== "customer_ready") invalidLifecycle();
        if (existing) conflict();

        const paymentMethod: SquarePaymentMethodRow = {
          id: generatedUuid(uuid),
          user_id: intent.user_id,
          square_environment: intent.square_environment,
          square_customer_id: intent.square_customer_id,
          square_card_id: normalized.squareCardId,
          card_brand: normalized.cardBrand,
          last_4: normalized.last4,
          exp_month: normalized.expMonth,
          exp_year: normalized.expYear,
          enabled: true,
          consented_at: normalized.consentedAt,
          created_at: nowIso,
          updated_at: nowIso,
        };

        // Non-atomic pair: payment method insert + intent card_ready update.
        const inserted = await client
          .from("square_payment_methods")
          .insert({ ...paymentMethod })
          .select(PAYMENT_METHOD_COLUMNS)
          .maybeSingle();
        throwIfDbError(inserted.error);
        if (!inserted.data) unavailable();
        const saved = parsePaymentMethodRow(inserted.data);

        const updatedIntent = await client
          .from("square_subscription_intents")
          .update({
            square_card_id: saved.square_card_id,
            status: "card_ready",
            updated_at: nowIso,
          })
          .eq("id", intent.id)
          .eq("status", "customer_ready")
          .is("square_card_id", null)
          .select(INTENT_COLUMNS)
          .maybeSingle();
        throwIfDbError(updatedIntent.error);
        if (!updatedIntent.data) {
          const latest = await getIntentRow(intent.id);
          if (
            latest?.square_card_id === saved.square_card_id &&
            latest.status === "card_ready"
          ) {
            return {
              intent: cloneIntent(latest),
              paymentMethod: clonePaymentMethod(saved),
              replayed: true,
            };
          }
          conflict();
        }
        return {
          intent: parseIntentRow(updatedIntent.data),
          paymentMethod: clonePaymentMethod(saved),
          replayed: false,
        };
      },

      async listPaymentMethods(
        userId: string,
        squareEnvironment: SquareEnvironmentName,
      ) {
        assertNoSquareBillingTokenKeys({ userId, squareEnvironment });
        const normalizedUserId = requireUuid(userId);
        const environment = requireEnvironment(squareEnvironment);
        const rows = await awaitRows(
          client
            .from("square_payment_methods")
            .select(PAYMENT_METHOD_COLUMNS)
            .eq("user_id", normalizedUserId)
            .eq("square_environment", environment)
            .order("created_at", { ascending: false }),
        );
        return rows.map((row) => clonePaymentMethod(parsePaymentMethodRow(row)));
      },

      async disablePaymentMethod(input: DisableSquarePaymentMethodInput) {
        const value = requireRecord(input);
        const id = requireUuid(value.paymentMethodId);
        const existing = await client
          .from("square_payment_methods")
          .select(PAYMENT_METHOD_COLUMNS)
          .eq("id", id)
          .maybeSingle();
        throwIfDbError(existing.error);
        if (!existing.data) notFound();
        const row = parsePaymentMethodRow(existing.data);
        if (!row.enabled) return clonePaymentMethod(row);
        const nowIso = currentIso(now);
        const updated = await client
          .from("square_payment_methods")
          .update({ enabled: false, updated_at: nowIso })
          .eq("id", id)
          .eq("enabled", true)
          .select(PAYMENT_METHOD_COLUMNS)
          .maybeSingle();
        throwIfDbError(updated.error);
        if (!updated.data) {
          const latest = await client
            .from("square_payment_methods")
            .select(PAYMENT_METHOD_COLUMNS)
            .eq("id", id)
            .maybeSingle();
          throwIfDbError(latest.error);
          if (!latest.data) notFound();
          return clonePaymentMethod(parsePaymentMethodRow(latest.data));
        }
        return clonePaymentMethod(parsePaymentMethodRow(updated.data));
      },
    },

    invoicePayments: {
      async persistInvoice(
        input: PersistSquareSubscriptionInvoiceInput,
      ): Promise<SquareInvoicePersistenceResult> {
        const value = requireRecord(input);
        const normalized: PersistSquareSubscriptionInvoiceInput = {
          squareEnvironment: requireEnvironment(value.squareEnvironment),
          squareInvoiceId: requireNonblank(value.squareInvoiceId),
          squareSubscriptionId: requireNonblank(value.squareSubscriptionId),
          squareOrderId: requireNullableNonblank(value.squareOrderId),
          squareInvoiceStatus: requireNonblank(value.squareInvoiceStatus),
          squareInvoiceVersion: requireNullableVersion(value.squareInvoiceVersion),
          amountUsd: requireNullableMoney(value.amountUsd),
          currency: requireNullableNonblank(value.currency, 16),
          dueDate: requireNullableCalendarDate(value.dueDate),
          paidAt: requireNullableTimestamp(value.paidAt),
        };
        const trusted = await findHostBySubscription(
          normalized.squareEnvironment,
          normalized.squareSubscriptionId,
        );
        if (!trusted) notFound();

        const existingResponse = await client
          .from("square_subscription_invoices")
          .select(INVOICE_COLUMNS)
          .eq("square_environment", normalized.squareEnvironment)
          .eq("square_invoice_id", normalized.squareInvoiceId)
          .maybeSingle();
        throwIfDbError(existingResponse.error);
        const existing = existingResponse.data
          ? parseInvoiceRow(existingResponse.data)
          : null;

        if (existing) {
          if (
            existing.square_subscription_id !== normalized.squareSubscriptionId ||
            existing.user_id !== trusted.user_id ||
            existing.square_location_id !== trusted.square_location_id ||
            existing.plan_id !== trusted.plan_id ||
            existing.billing_cycle !== trusted.billing_cycle ||
            existing.square_plan_variation_id !== trusted.square_plan_variation_id
          ) {
            conflict();
          }
          if (invoicesHaveSameProviderValues(existing, normalized)) {
            return { invoice: cloneInvoice(existing), replayed: true };
          }
          if (
            existing.square_invoice_version === null ||
            normalized.squareInvoiceVersion === null ||
            normalized.squareInvoiceVersion <= existing.square_invoice_version
          ) {
            conflict();
          }
          if (normalized.squareOrderId !== null) {
            const orderRows = await awaitRows(
              client
                .from("square_subscription_invoices")
                .select(INVOICE_COLUMNS)
                .eq("square_environment", normalized.squareEnvironment)
                .eq("square_order_id", normalized.squareOrderId)
                .limit(2),
            );
            if (
              orderRows.some(
                (row) => parseInvoiceRow(row).square_invoice_id !== existing.square_invoice_id,
              )
            ) {
              conflict();
            }
          }
          const nowIso = currentIso(now);
          const updated = await client
            .from("square_subscription_invoices")
            .update({
              square_order_id: normalized.squareOrderId,
              square_invoice_status: normalized.squareInvoiceStatus,
              square_invoice_version: normalized.squareInvoiceVersion,
              amount_usd: normalized.amountUsd,
              currency: normalized.currency,
              due_date: normalized.dueDate,
              paid_at: normalized.paidAt,
              updated_at: nowIso,
            })
            .eq("square_environment", existing.square_environment)
            .eq("square_invoice_id", existing.square_invoice_id)
            .eq("square_invoice_version", existing.square_invoice_version)
            .select(INVOICE_COLUMNS)
            .maybeSingle();
          throwIfDbError(updated.error);
          if (!updated.data) conflict();
          return { invoice: parseInvoiceRow(updated.data), replayed: false };
        }

        if (normalized.squareOrderId !== null) {
          const orderRows = await awaitRows(
            client
              .from("square_subscription_invoices")
              .select("square_invoice_id")
              .eq("square_environment", normalized.squareEnvironment)
              .eq("square_order_id", normalized.squareOrderId)
              .limit(1),
          );
          if (orderRows.length > 0) conflict();
        }

        const nowIso = currentIso(now);
        const row: SquareSubscriptionInvoiceRow = {
          square_environment: normalized.squareEnvironment,
          square_invoice_id: normalized.squareInvoiceId,
          square_subscription_id: normalized.squareSubscriptionId,
          square_order_id: normalized.squareOrderId,
          square_location_id: trusted.square_location_id,
          user_id: trusted.user_id,
          plan_id: trusted.plan_id,
          billing_cycle: trusted.billing_cycle,
          square_plan_variation_id: trusted.square_plan_variation_id,
          square_invoice_status: normalized.squareInvoiceStatus,
          square_invoice_version: normalized.squareInvoiceVersion,
          amount_usd: normalized.amountUsd,
          currency: normalized.currency,
          due_date: normalized.dueDate,
          paid_at: normalized.paidAt,
          created_at: nowIso,
          updated_at: nowIso,
        };
        const inserted = await client
          .from("square_subscription_invoices")
          .insert({ ...row })
          .select(INVOICE_COLUMNS)
          .maybeSingle();
        throwIfDbError(inserted.error);
        if (!inserted.data) unavailable();
        return { invoice: parseInvoiceRow(inserted.data), replayed: false };
      },

      async correlatePayment(
        input: CorrelateSquareInvoicePaymentInput,
      ): Promise<SquareInvoicePaymentCorrelationResult> {
        const value = requireRecord(input);
        const normalized = {
          providerPaymentId: requireNonblank(value.providerPaymentId),
          squareEnvironment: requireEnvironment(value.squareEnvironment),
          squareInvoiceId: requireNullableNonblank(value.squareInvoiceId),
          squareOrderId: requireNullableNonblank(value.squareOrderId),
          squareSubscriptionId: requireNullableNonblank(value.squareSubscriptionId),
        };
        if (
          normalized.squareInvoiceId === null &&
          normalized.squareOrderId === null &&
          normalized.squareSubscriptionId === null
        ) {
          invalidInput();
        }

        let invoiceQuery = client
          .from("square_subscription_invoices")
          .select(INVOICE_COLUMNS)
          .eq("square_environment", normalized.squareEnvironment);
        if (normalized.squareInvoiceId !== null) {
          invoiceQuery = invoiceQuery.eq("square_invoice_id", normalized.squareInvoiceId);
        }
        if (normalized.squareOrderId !== null) {
          invoiceQuery = invoiceQuery.eq("square_order_id", normalized.squareOrderId);
        }
        if (normalized.squareSubscriptionId !== null) {
          invoiceQuery = invoiceQuery.eq(
            "square_subscription_id",
            normalized.squareSubscriptionId,
          );
        }
        const invoiceRows = await awaitRows(invoiceQuery.limit(2));
        if (invoiceRows.length > 1) conflict();
        const invoice = invoiceRows[0] ? parseInvoiceRow(invoiceRows[0]) : null;

        const paymentResponse = await client
          .from("subscription_payments")
          .select(PAYMENT_CORRELATION_COLUMNS)
          .eq("provider_payment_id", normalized.providerPaymentId)
          .maybeSingle();
        throwIfDbError(paymentResponse.error);
        const payment = paymentResponse.data
          ? parsePaymentRow(paymentResponse.data)
          : null;

        if (!invoice) {
          return {
            correlated: false,
            replayed: false,
            reason: "invoice_not_found",
            invoice: null,
            payment: payment ? clonePayment(payment) : null,
          };
        }
        if (!payment) {
          return {
            correlated: false,
            replayed: false,
            reason: "payment_not_found",
            invoice: cloneInvoice(invoice),
            payment: null,
          };
        }

        const expected = {
          billing_cycle: invoice.billing_cycle,
          square_environment: invoice.square_environment,
          square_location_id: invoice.square_location_id,
          square_subscription_id: invoice.square_subscription_id,
          square_invoice_id: invoice.square_invoice_id,
          square_order_id: invoice.square_order_id,
        };
        const fields: Array<[string | null, string | null]> = [
          [payment.billing_cycle, expected.billing_cycle],
          [payment.square_environment, expected.square_environment],
          [payment.square_location_id, expected.square_location_id],
          [payment.square_subscription_id, expected.square_subscription_id],
          [payment.square_invoice_id, expected.square_invoice_id],
          [payment.square_order_id, expected.square_order_id],
        ];
        if (fields.some(([current, next]) => current !== null && current !== next)) {
          conflict();
        }
        const replayed = fields.every(([current, next]) => current === next);
        if (replayed) {
          return {
            correlated: true,
            replayed: true,
            invoice: cloneInvoice(invoice),
            payment: clonePayment(payment),
          };
        }

        const updated = await client
          .from("subscription_payments")
          .update(expected)
          .eq("id", payment.id)
          .eq("provider_payment_id", payment.provider_payment_id)
          .select(PAYMENT_CORRELATION_COLUMNS)
          .maybeSingle();
        throwIfDbError(updated.error);
        if (!updated.data) conflict();
        return {
          correlated: true,
          replayed: false,
          invoice: cloneInvoice(invoice),
          payment: parsePaymentRow(updated.data),
        };
      },
    },
    hostSubscriptions: {
      async getByUserId(userId: string): Promise<SquareHostSubscriptionCorrelation | null> {
        const id = requireUuid(userId);
        const rows = await awaitRows(
          client
            .from("square_subscription_intents")
            .select(INTENT_COLUMNS)
            .eq("user_id", id)
            .limit(20),
        );
        const withSubscription = rows
          .map((row) => parseIntentRow(row))
          .filter(
            (row) =>
              typeof row.square_subscription_id === "string" &&
              row.square_subscription_id.trim().length > 0,
          );
        const uniqueIds = [
          ...new Set(
            withSubscription.map((row) => row.square_subscription_id as string),
          ),
        ];
        if (uniqueIds.length === 0) return null;
        if (uniqueIds.length > 1) conflict();
        const subscriptionId = uniqueIds[0]!;
        const intent = withSubscription.find(
          (row) => row.square_subscription_id === subscriptionId,
        );
        if (!intent) conflict();
        const host = await findHostBySubscription(
          intent.square_environment,
          subscriptionId,
        );
        if (host) {
          if (host.user_id !== id) conflict();
          return {
            user_id: host.user_id,
            square_environment: host.square_environment,
            square_location_id: host.square_location_id,
            square_customer_id: host.square_customer_id,
            square_subscription_id: host.square_subscription_id,
          };
        }
        const customerId = intent.square_customer_id;
        if (!customerId) conflict();
        return {
          user_id: intent.user_id,
          square_environment: intent.square_environment,
          square_location_id: intent.square_location_id,
          square_customer_id: customerId,
          square_subscription_id: subscriptionId,
        };
      },
    },
  };
}

/**
 * Builds stores from the local service-role admin client when configured.
 * Returns null when service-role credentials are unavailable.
 */
export function tryCreateSupabaseSquareBillingStores(
  options: Omit<CreateSupabaseSquareBillingStoresOptions, "client"> = {},
): SquareBillingStores | null {
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return null;
  return createSupabaseSquareBillingStores({
    ...options,
    client: admin as unknown as SquareBillingSupabaseClient,
  });
}

export const SUBSCRIPTION_STATUS_WEBHOOK_RPC =
  "square_billing_apply_subscription_status_webhook" as const;

export type SquareSubscriptionStatusWebhookRpcArgs = {
  p_provider: "square";
  p_event_id: string;
  p_event_type: "subscription.created" | "subscription.updated" | string;
  p_payload_sha256: string;
  p_square_environment: "sandbox" | "production";
  p_square_subscription_id: string;
  p_square_customer_id: string;
  p_square_location_id: string;
  p_square_plan_variation_id: string;
  p_square_subscription_status: string;
  p_square_subscription_version: number;
  p_square_start_date: string | null;
  p_square_charged_through_date: string | null;
  p_square_canceled_date: string | null;
};

export type SquareSubscriptionStatusWebhookRpcResult = {
  processed: boolean;
  replayed: boolean;
  skipped_subscription: boolean;
  resolved_user_id: string | null;
  subscription_status: string | null;
};

export class SquareSubscriptionStatusWebhookRpcError extends Error {
  readonly code: "ZB001" | "ZB002" | "ZB003" | "unavailable";

  constructor(code: "ZB001" | "ZB002" | "ZB003" | "unavailable") {
    super(code);
    this.name = "SquareSubscriptionStatusWebhookRpcError";
    this.code = code;
  }
}

function parseSubscriptionStatusWebhookRow(
  value: unknown,
): SquareSubscriptionStatusWebhookRpcResult | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  if (
    typeof row.processed !== "boolean" ||
    typeof row.replayed !== "boolean" ||
    typeof row.skipped_subscription !== "boolean"
  ) {
    return null;
  }
  return {
    processed: row.processed,
    replayed: row.replayed,
    skipped_subscription: row.skipped_subscription,
    resolved_user_id:
      typeof row.resolved_user_id === "string" ? row.resolved_user_id : null,
    subscription_status:
      typeof row.subscription_status === "string"
        ? row.subscription_status
        : null,
  };
}

function throwSubscriptionStatusWebhookRpcError(
  error: SquareBillingDbError | null | undefined,
): never {
  const code = error?.code?.trim() ?? "";
  if (code === "ZB001") {
    throw new SquareSubscriptionStatusWebhookRpcError("ZB001");
  }
  if (code === "ZB002") {
    throw new SquareSubscriptionStatusWebhookRpcError("ZB002");
  }
  if (code === "ZB003") {
    throw new SquareSubscriptionStatusWebhookRpcError("ZB003");
  }
  throw new SquareSubscriptionStatusWebhookRpcError("unavailable");
}

export async function applySquareSubscriptionStatusWebhookRpc(
  args: SquareSubscriptionStatusWebhookRpcArgs,
  client?: SquareBillingSupabaseClient | null,
): Promise<SquareSubscriptionStatusWebhookRpcResult> {
  const rpcClient =
    client ??
    (tryCreateSupabaseAdminClient() as unknown as SquareBillingSupabaseClient | null);
  if (!rpcClient) {
    throw new SquareSubscriptionStatusWebhookRpcError("unavailable");
  }

  const response = await rpcClient.rpc(SUBSCRIPTION_STATUS_WEBHOOK_RPC, {
    p_provider: args.p_provider,
    p_event_id: args.p_event_id,
    p_event_type: args.p_event_type,
    p_payload_sha256: args.p_payload_sha256,
    p_square_environment: args.p_square_environment,
    p_square_subscription_id: args.p_square_subscription_id,
    p_square_customer_id: args.p_square_customer_id,
    p_square_location_id: args.p_square_location_id,
    p_square_plan_variation_id: args.p_square_plan_variation_id,
    p_square_subscription_status: args.p_square_subscription_status,
    p_square_subscription_version: args.p_square_subscription_version,
    p_square_start_date: args.p_square_start_date,
    p_square_charged_through_date: args.p_square_charged_through_date,
    p_square_canceled_date: args.p_square_canceled_date,
  });

  if (response.error) {
    throwSubscriptionStatusWebhookRpcError(response.error);
  }

  const parsed = parseSubscriptionStatusWebhookRow(response.data);
  if (!parsed) {
    throw new SquareSubscriptionStatusWebhookRpcError("unavailable");
  }
  return parsed;
}
