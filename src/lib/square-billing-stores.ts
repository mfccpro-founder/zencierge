import type { SquareEnvironmentName } from "./square-subscription-plans";
import type { BillingCycle, ZenciergePlanId } from "./zencierge-plans";

/** Server-only. Do not import this module at runtime from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("square-billing-stores is server-only");
}

export type SquareSubscriptionIntentStatus =
  | "pending"
  | "customer_ready"
  | "card_ready"
  | "subscription_ready"
  | "completed"
  | "failed"
  | "expired";

/** Exact application representation of public.square_payment_methods. */
export type SquarePaymentMethodRow = {
  id: string;
  user_id: string;
  square_environment: SquareEnvironmentName;
  square_customer_id: string;
  square_card_id: string;
  card_brand: string | null;
  last_4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  enabled: boolean;
  consented_at: string;
  created_at: string;
  updated_at: string;
};

/** Exact application representation of public.square_subscription_intents. */
export type SquareSubscriptionIntentRow = {
  id: string;
  user_id: string;
  plan_id: ZenciergePlanId;
  billing_cycle: BillingCycle;
  billing_amount_usd: number;
  status: SquareSubscriptionIntentStatus;
  square_environment: SquareEnvironmentName;
  square_location_id: string;
  square_plan_variation_id: string;
  square_customer_id: string | null;
  square_card_id: string | null;
  square_subscription_id: string | null;
  customer_idempotency_key: string;
  card_idempotency_key: string;
  subscription_idempotency_key: string;
  complimentary_until: string | null;
  expires_at: string;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

/** Exact application representation of public.square_subscription_invoices. */
export type SquareSubscriptionInvoiceRow = {
  square_environment: SquareEnvironmentName;
  square_invoice_id: string;
  square_subscription_id: string;
  square_order_id: string | null;
  square_location_id: string;
  user_id: string;
  plan_id: ZenciergePlanId;
  billing_cycle: BillingCycle;
  square_plan_variation_id: string;
  square_invoice_status: string;
  square_invoice_version: number | null;
  amount_usd: number | null;
  currency: string | null;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateSquareSubscriptionIntentInput = {
  userId: string;
  planId: ZenciergePlanId;
  billingCycle: BillingCycle;
  billingAmountUsd: number;
  squareEnvironment: SquareEnvironmentName;
  squareLocationId: string;
  squarePlanVariationId: string;
  complimentaryUntil: string | null;
  expiresAt: string;
};

export type RecordSquareCustomerInput = {
  intentId: string;
  squareCustomerId: string;
};

export type PersistSquarePaymentMethodInput = {
  intentId: string;
  squareCardId: string;
  cardBrand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  consentedAt: string;
};

export type PersistSquareSubscriptionInput = {
  intentId: string;
  squareSubscriptionId: string;
  squareSubscriptionStatus: string;
  squareSubscriptionVersion: number | null;
  startDate: string | null;
  chargedThroughDate: string | null;
  canceledDate: string | null;
};

export type CompleteSquareSubscriptionIntentInput = {
  intentId: string;
};

export type FailSquareSubscriptionIntentInput = {
  intentId: string;
  errorCode: string;
};

export type ExpireSquareSubscriptionIntentInput = {
  intentId: string;
};

export type DisableSquarePaymentMethodInput = {
  paymentMethodId: string;
};

/**
 * Allowlisted host_subscriptions values derived from a trusted intent. Callers
 * cannot supply ownership, catalog, location, customer, or card values here.
 */
export type SquareHostSubscriptionPersistence = {
  user_id: string;
  plan_id: ZenciergePlanId;
  billing_cycle: BillingCycle;
  billing_amount_usd: number;
  square_environment: SquareEnvironmentName;
  square_location_id: string;
  square_plan_variation_id: string;
  square_customer_id: string;
  square_subscription_id: string;
  square_subscription_status: string;
  square_subscription_version: number | null;
  square_start_date: string | null;
  square_charged_through_date: string | null;
  square_canceled_date: string | null;
  complimentary_ends_at: string | null;
};

export type SquareIntentPersistenceResult = {
  intent: SquareSubscriptionIntentRow;
  replayed: boolean;
};

export type SquarePaymentMethodPersistenceResult = {
  intent: SquareSubscriptionIntentRow;
  paymentMethod: SquarePaymentMethodRow;
  replayed: boolean;
};

export type SquareSubscriptionPersistenceResult = {
  intent: SquareSubscriptionIntentRow;
  subscription: SquareHostSubscriptionPersistence;
  replayed: boolean;
};

export type PersistSquareSubscriptionInvoiceInput = {
  squareEnvironment: SquareEnvironmentName;
  squareInvoiceId: string;
  squareSubscriptionId: string;
  squareOrderId: string | null;
  squareInvoiceStatus: string;
  squareInvoiceVersion: number | null;
  amountUsd: number | null;
  currency: string | null;
  dueDate: string | null;
  paidAt: string | null;
};

export type SquareInvoicePersistenceResult = {
  invoice: SquareSubscriptionInvoiceRow;
  replayed: boolean;
};

/** Relevant database-shaped columns from public.subscription_payments. */
export type SquareCorrelatablePaymentRow = {
  id: string;
  provider_payment_id: string;
  billing_cycle: BillingCycle | null;
  square_environment: SquareEnvironmentName | null;
  square_location_id: string | null;
  square_subscription_id: string | null;
  square_invoice_id: string | null;
  square_order_id: string | null;
};

export type CorrelateSquareInvoicePaymentInput = {
  providerPaymentId: string;
  squareEnvironment: SquareEnvironmentName;
  squareInvoiceId: string | null;
  squareOrderId: string | null;
  squareSubscriptionId: string | null;
};

export type SquareInvoicePaymentCorrelationResult =
  | {
      correlated: true;
      replayed: boolean;
      invoice: SquareSubscriptionInvoiceRow;
      payment: SquareCorrelatablePaymentRow;
    }
  | {
      correlated: false;
      replayed: false;
      reason: "invoice_not_found" | "payment_not_found";
      invoice: SquareSubscriptionInvoiceRow | null;
      payment: SquareCorrelatablePaymentRow | null;
    };

export type SquareSubscriptionIntentStore = {
  createIntent(
    input: CreateSquareSubscriptionIntentInput,
  ): Promise<SquareIntentPersistenceResult>;
  getIntent(intentId: string): Promise<SquareSubscriptionIntentRow | null>;
  recordCustomer(
    input: RecordSquareCustomerInput,
  ): Promise<SquareIntentPersistenceResult>;
  persistSubscription(
    input: PersistSquareSubscriptionInput,
  ): Promise<SquareSubscriptionPersistenceResult>;
  completeIntent(
    input: CompleteSquareSubscriptionIntentInput,
  ): Promise<SquareIntentPersistenceResult>;
  failIntent(
    input: FailSquareSubscriptionIntentInput,
  ): Promise<SquareIntentPersistenceResult>;
  expireIntent(
    input: ExpireSquareSubscriptionIntentInput,
  ): Promise<SquareIntentPersistenceResult>;
};

export type SquarePaymentMethodStore = {
  persistPaymentMethod(
    input: PersistSquarePaymentMethodInput,
  ): Promise<SquarePaymentMethodPersistenceResult>;
  listPaymentMethods(
    userId: string,
    squareEnvironment: SquareEnvironmentName,
  ): Promise<SquarePaymentMethodRow[]>;
  disablePaymentMethod(
    input: DisableSquarePaymentMethodInput,
  ): Promise<SquarePaymentMethodRow>;
};

export type SquareInvoicePaymentStore = {
  persistInvoice(
    input: PersistSquareSubscriptionInvoiceInput,
  ): Promise<SquareInvoicePersistenceResult>;
  correlatePayment(
    input: CorrelateSquareInvoicePaymentInput,
  ): Promise<SquareInvoicePaymentCorrelationResult>;
};

/** Read-only host_subscriptions correlation used by enroll's single-active guard. */
export type SquareHostSubscriptionCorrelation = {
  user_id: string;
  square_environment: SquareEnvironmentName;
  square_location_id: string;
  square_customer_id: string;
  square_subscription_id: string;
};

export type SquareHostSubscriptionStore = {
  getByUserId(userId: string): Promise<SquareHostSubscriptionCorrelation | null>;
};

export type SquareBillingStores = {
  intents: SquareSubscriptionIntentStore;
  paymentMethods: SquarePaymentMethodStore;
  invoicePayments: SquareInvoicePaymentStore;
  hostSubscriptions: SquareHostSubscriptionStore;
};

export const SQUARE_BILLING_STORE_ERROR_MESSAGES = Object.freeze({
  invalid_input: "Invalid Square billing store input",
  not_found: "Square billing record was not found",
  conflict: "Square billing store conflict",
  invalid_lifecycle: "Invalid Square billing lifecycle transition",
  expired: "Square subscription intent has expired",
  unavailable: "Square billing store is unavailable",
} as const);

export type SquareBillingStoreErrorCode =
  keyof typeof SQUARE_BILLING_STORE_ERROR_MESSAGES;

export type SerializedSquareBillingStoreError = {
  name: "SquareBillingStoreError";
  code: SquareBillingStoreErrorCode;
  message: (typeof SQUARE_BILLING_STORE_ERROR_MESSAGES)[SquareBillingStoreErrorCode];
};

/** Safe by construction: it retains no input object, provider error, or cause. */
export class SquareBillingStoreError extends Error {
  readonly code: SquareBillingStoreErrorCode;

  constructor(code: SquareBillingStoreErrorCode) {
    super(SQUARE_BILLING_STORE_ERROR_MESSAGES[code]);
    this.name = "SquareBillingStoreError";
    this.code = code;
  }

  toJSON(): SerializedSquareBillingStoreError {
    return {
      name: "SquareBillingStoreError",
      code: this.code,
      message: SQUARE_BILLING_STORE_ERROR_MESSAGES[this.code],
    };
  }
}

export function serializeSquareBillingStoreError(
  error: unknown,
): SerializedSquareBillingStoreError {
  if (error instanceof SquareBillingStoreError) return error.toJSON();
  return new SquareBillingStoreError("unavailable").toJSON();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const LAST_FOUR_PATTERN = /^\d{4}$/;
const OPEN_INTENT_STATUSES = new Set<SquareSubscriptionIntentStatus>([
  "pending",
  "customer_ready",
  "card_ready",
  "subscription_ready",
]);
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

function invalidInput(): never {
  throw new SquareBillingStoreError("invalid_input");
}

export type HostSubscriptionEntitlementStatus =
  | "active"
  | "inactive"
  | "canceled";

/** Only Square ACTIVE may complete enroll or grant paid entitlement. */
export function isEnrollableSquareSubscriptionStatus(status: string): boolean {
  return status.trim() === "ACTIVE";
}

/**
 * Map raw Square subscription status to local host_subscriptions.status.
 * Unsupported values fail closed.
 */
export function mapSquareSubscriptionStatusToHostStatus(
  status: string,
): HostSubscriptionEntitlementStatus {
  const normalized = status.trim();
  if (normalized === "ACTIVE") return "active";
  if (
    normalized === "PENDING" ||
    normalized === "PAUSED" ||
    normalized === "DEACTIVATED"
  ) {
    return "inactive";
  }
  if (normalized === "CANCELED") return "canceled";
  invalidInput();
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

function normalizedKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isForbiddenTokenKey(key: string) {
  const normalized = normalizedKey(key);
  return (
    normalized.includes("token") ||
    normalized.includes("nonce") ||
    normalized === "sourceid" ||
    normalized === "paymentkey" ||
    normalized === "cardkey"
  );
}

/**
 * Checks every own key recursively, including non-enumerable keys. Accessors
 * are treated as unsafe rather than invoked. Cycles are handled without
 * weakening nested-key inspection.
 */
export function squareBillingValueHasForbiddenTokenKey(value: unknown): boolean {
  const seen = new Set<object>();

  function visit(candidate: unknown): boolean {
    if (
      (typeof candidate !== "object" || candidate === null) &&
      typeof candidate !== "function"
    ) {
      return false;
    }
    const object = candidate as object;
    if (seen.has(object)) return false;
    seen.add(object);

    try {
      for (const key of Reflect.ownKeys(object)) {
        const keyText = typeof key === "string" ? key : key.description ?? "";
        if (isForbiddenTokenKey(keyText)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor) return true;
        if ("get" in descriptor || "set" in descriptor) return true;
        if (visit(descriptor.value)) return true;
      }
    } catch {
      return true;
    }
    return false;
  }

  return visit(value);
}

export function assertNoSquareBillingTokenKeys(value: unknown): void {
  if (squareBillingValueHasForbiddenTokenKey(value)) invalidInput();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
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

function requireNullableNonblank(
  value: unknown,
  maximum = 1024,
): string | null {
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
  if (!INTENT_STATUSES.has(value as SquareSubscriptionIntentStatus)) {
    invalidInput();
  }
  return value as SquareSubscriptionIntentStatus;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalidInput();
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    invalidInput();
  }
  requireCalendarDate(value.slice(0, 10));
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) invalidInput();
  return value;
}

function requireNullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return requireTimestamp(value);
}

function requireCalendarDate(value: unknown): string {
  if (typeof value !== "string" || !CALENDAR_DATE_PATTERN.test(value)) {
    invalidInput();
  }
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
  if (typeof value !== "number" || !Number.isFinite(value)) invalidInput();
  if ((allowZero && value < 0) || (!allowZero && value <= 0)) invalidInput();
  const roundedToCents = Number(value.toFixed(2));
  if (roundedToCents !== value || value * 100 > MAX_NUMERIC_CENTS) {
    invalidInput();
  }
  return value;
}

function requireNullableMoney(value: unknown): number | null {
  if (value === null) return null;
  return requireMoney(value, true);
}

function requireNullableVersion(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalidInput();
  return value as number;
}

function requireNullableExpirationMonth(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 12) {
    invalidInput();
  }
  return value as number;
}

function requireNullableExpirationYear(value: unknown): number | null {
  if (value === null) return null;
  if (
    !Number.isInteger(value) ||
    (value as number) < 2000 ||
    (value as number) > 2_147_483_647
  ) {
    invalidInput();
  }
  return value as number;
}

function requireNullableLastFour(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !LAST_FOUR_PATTERN.test(value)) {
    invalidInput();
  }
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

function clonePaymentMethod(row: SquarePaymentMethodRow): SquarePaymentMethodRow {
  return {
    id: row.id,
    user_id: row.user_id,
    square_environment: row.square_environment,
    square_customer_id: row.square_customer_id,
    square_card_id: row.square_card_id,
    card_brand: row.card_brand,
    last_4: row.last_4,
    exp_month: row.exp_month,
    exp_year: row.exp_year,
    enabled: row.enabled,
    consented_at: row.consented_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function cloneIntent(row: SquareSubscriptionIntentRow): SquareSubscriptionIntentRow {
  return {
    id: row.id,
    user_id: row.user_id,
    plan_id: row.plan_id,
    billing_cycle: row.billing_cycle,
    billing_amount_usd: row.billing_amount_usd,
    status: row.status,
    square_environment: row.square_environment,
    square_location_id: row.square_location_id,
    square_plan_variation_id: row.square_plan_variation_id,
    square_customer_id: row.square_customer_id,
    square_card_id: row.square_card_id,
    square_subscription_id: row.square_subscription_id,
    customer_idempotency_key: row.customer_idempotency_key,
    card_idempotency_key: row.card_idempotency_key,
    subscription_idempotency_key: row.subscription_idempotency_key,
    complimentary_until: row.complimentary_until,
    expires_at: row.expires_at,
    last_error_code: row.last_error_code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function cloneInvoice(row: SquareSubscriptionInvoiceRow): SquareSubscriptionInvoiceRow {
  return {
    square_environment: row.square_environment,
    square_invoice_id: row.square_invoice_id,
    square_subscription_id: row.square_subscription_id,
    square_order_id: row.square_order_id,
    square_location_id: row.square_location_id,
    user_id: row.user_id,
    plan_id: row.plan_id,
    billing_cycle: row.billing_cycle,
    square_plan_variation_id: row.square_plan_variation_id,
    square_invoice_status: row.square_invoice_status,
    square_invoice_version: row.square_invoice_version,
    amount_usd: row.amount_usd,
    currency: row.currency,
    due_date: row.due_date,
    paid_at: row.paid_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function cloneSubscription(
  row: SquareHostSubscriptionPersistence,
): SquareHostSubscriptionPersistence {
  return {
    user_id: row.user_id,
    plan_id: row.plan_id,
    billing_cycle: row.billing_cycle,
    billing_amount_usd: row.billing_amount_usd,
    square_environment: row.square_environment,
    square_location_id: row.square_location_id,
    square_plan_variation_id: row.square_plan_variation_id,
    square_customer_id: row.square_customer_id,
    square_subscription_id: row.square_subscription_id,
    square_subscription_status: row.square_subscription_status,
    square_subscription_version: row.square_subscription_version,
    square_start_date: row.square_start_date,
    square_charged_through_date: row.square_charged_through_date,
    square_canceled_date: row.square_canceled_date,
    complimentary_ends_at: row.complimentary_ends_at,
  };
}

function clonePayment(
  row: SquareCorrelatablePaymentRow,
): SquareCorrelatablePaymentRow {
  return {
    id: row.id,
    provider_payment_id: row.provider_payment_id,
    billing_cycle: row.billing_cycle,
    square_environment: row.square_environment,
    square_location_id: row.square_location_id,
    square_subscription_id: row.square_subscription_id,
    square_invoice_id: row.square_invoice_id,
    square_order_id: row.square_order_id,
  };
}

function buildPaymentMethodRow(value: unknown): SquarePaymentMethodRow {
  const row = requireRecord(value);
  return {
    id: requireUuid(row.id),
    user_id: requireUuid(row.user_id),
    square_environment: requireEnvironment(row.square_environment),
    square_customer_id: requireNonblank(row.square_customer_id),
    square_card_id: requireNonblank(row.square_card_id),
    card_brand: requireNullableNonblank(row.card_brand),
    last_4: requireNullableLastFour(row.last_4),
    exp_month: requireNullableExpirationMonth(row.exp_month),
    exp_year: requireNullableExpirationYear(row.exp_year),
    enabled: requireBoolean(row.enabled),
    consented_at: requireTimestamp(row.consented_at),
    created_at: requireTimestamp(row.created_at),
    updated_at: requireTimestamp(row.updated_at),
  };
}

function buildIntentRow(value: unknown): SquareSubscriptionIntentRow {
  const row = requireRecord(value);
  const built: SquareSubscriptionIntentRow = {
    id: requireUuid(row.id),
    user_id: requireUuid(row.user_id),
    plan_id: requirePlan(row.plan_id),
    billing_cycle: requireBillingCycle(row.billing_cycle),
    billing_amount_usd: requireMoney(row.billing_amount_usd, false),
    status: requireIntentStatus(row.status),
    square_environment: requireEnvironment(row.square_environment),
    square_location_id: requireNonblank(row.square_location_id),
    square_plan_variation_id: requireNonblank(row.square_plan_variation_id),
    square_customer_id: requireNullableNonblank(row.square_customer_id),
    square_card_id: requireNullableNonblank(row.square_card_id),
    square_subscription_id: requireNullableNonblank(row.square_subscription_id),
    customer_idempotency_key: requireNonblank(row.customer_idempotency_key, 45),
    card_idempotency_key: requireNonblank(row.card_idempotency_key, 45),
    subscription_idempotency_key: requireNonblank(
      row.subscription_idempotency_key,
      45,
    ),
    complimentary_until: requireNullableTimestamp(row.complimentary_until),
    expires_at: requireTimestamp(row.expires_at),
    last_error_code: requireNullableNonblank(row.last_error_code, 128),
    created_at: requireTimestamp(row.created_at),
    updated_at: requireTimestamp(row.updated_at),
  };
  if (Date.parse(built.expires_at) <= Date.parse(built.created_at)) invalidInput();
  validateIntentShape(built);
  return built;
}

function validateIntentShape(row: SquareSubscriptionIntentRow) {
  if (row.status === "pending") {
    if (
      row.square_customer_id !== null ||
      row.square_card_id !== null ||
      row.square_subscription_id !== null
    ) {
      invalidInput();
    }
  }
  if (row.status === "customer_ready") {
    if (
      row.square_customer_id === null ||
      row.square_card_id !== null ||
      row.square_subscription_id !== null
    ) {
      invalidInput();
    }
  }
  if (row.status === "card_ready") {
    if (
      row.square_customer_id === null ||
      row.square_card_id === null ||
      row.square_subscription_id !== null
    ) {
      invalidInput();
    }
  }
  if (row.status === "subscription_ready" || row.status === "completed") {
    if (
      row.square_customer_id === null ||
      row.square_card_id === null ||
      row.square_subscription_id === null
    ) {
      invalidInput();
    }
  }
}

function buildInvoiceRow(value: unknown): SquareSubscriptionInvoiceRow {
  const row = requireRecord(value);
  return {
    square_environment: requireEnvironment(row.square_environment),
    square_invoice_id: requireNonblank(row.square_invoice_id),
    square_subscription_id: requireNonblank(row.square_subscription_id),
    square_order_id: requireNullableNonblank(row.square_order_id),
    square_location_id: requireNonblank(row.square_location_id),
    user_id: requireUuid(row.user_id),
    plan_id: requirePlan(row.plan_id),
    billing_cycle: requireBillingCycle(row.billing_cycle),
    square_plan_variation_id: requireNonblank(row.square_plan_variation_id),
    square_invoice_status: requireNonblank(row.square_invoice_status),
    square_invoice_version: requireNullableVersion(row.square_invoice_version),
    amount_usd: requireNullableMoney(row.amount_usd),
    currency: requireNullableNonblank(row.currency, 16),
    due_date: requireNullableCalendarDate(row.due_date),
    paid_at: requireNullableTimestamp(row.paid_at),
    created_at: requireTimestamp(row.created_at),
    updated_at: requireTimestamp(row.updated_at),
  };
}

function buildSubscriptionPersistence(
  value: unknown,
): SquareHostSubscriptionPersistence {
  const row = requireRecord(value);
  return {
    user_id: requireUuid(row.user_id),
    plan_id: requirePlan(row.plan_id),
    billing_cycle: requireBillingCycle(row.billing_cycle),
    billing_amount_usd: requireMoney(row.billing_amount_usd, false),
    square_environment: requireEnvironment(row.square_environment),
    square_location_id: requireNonblank(row.square_location_id),
    square_plan_variation_id: requireNonblank(row.square_plan_variation_id),
    square_customer_id: requireNonblank(row.square_customer_id),
    square_subscription_id: requireNonblank(row.square_subscription_id),
    square_subscription_status: requireNonblank(row.square_subscription_status),
    square_subscription_version: requireNullableVersion(
      row.square_subscription_version,
    ),
    square_start_date: requireNullableCalendarDate(row.square_start_date),
    square_charged_through_date: requireNullableCalendarDate(
      row.square_charged_through_date,
    ),
    square_canceled_date: requireNullableCalendarDate(row.square_canceled_date),
    complimentary_ends_at: requireNullableTimestamp(row.complimentary_ends_at),
  };
}

function buildPaymentRow(value: unknown): SquareCorrelatablePaymentRow {
  const row = requireRecord(value);
  return {
    id: requireUuid(row.id),
    provider_payment_id: requireNonblank(row.provider_payment_id),
    billing_cycle:
      row.billing_cycle === null ? null : requireBillingCycle(row.billing_cycle),
    square_environment:
      row.square_environment === null
        ? null
        : requireEnvironment(row.square_environment),
    square_location_id: requireNullableNonblank(row.square_location_id),
    square_subscription_id: requireNullableNonblank(row.square_subscription_id),
    square_invoice_id: requireNullableNonblank(row.square_invoice_id),
    square_order_id: requireNullableNonblank(row.square_order_id),
  };
}

function subscriptionsEqual(
  left: SquareHostSubscriptionPersistence,
  right: SquareHostSubscriptionPersistence,
) {
  return (
    left.user_id === right.user_id &&
    left.plan_id === right.plan_id &&
    left.billing_cycle === right.billing_cycle &&
    left.billing_amount_usd === right.billing_amount_usd &&
    left.square_environment === right.square_environment &&
    left.square_location_id === right.square_location_id &&
    left.square_plan_variation_id === right.square_plan_variation_id &&
    left.square_customer_id === right.square_customer_id &&
    left.square_subscription_id === right.square_subscription_id &&
    left.square_subscription_status === right.square_subscription_status &&
    left.square_subscription_version === right.square_subscription_version &&
    left.square_start_date === right.square_start_date &&
    left.square_charged_through_date === right.square_charged_through_date &&
    left.square_canceled_date === right.square_canceled_date &&
    left.complimentary_ends_at === right.complimentary_ends_at
  );
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

export type MemorySquareBillingStoreSeeds = {
  paymentMethods?: readonly SquarePaymentMethodRow[];
  intents?: readonly SquareSubscriptionIntentRow[];
  invoices?: readonly SquareSubscriptionInvoiceRow[];
  subscriptions?: readonly SquareHostSubscriptionPersistence[];
  payments?: readonly SquareCorrelatablePaymentRow[];
};

export type MemorySquareBillingStoresOptions = {
  now?: () => Date;
  uuid?: () => string;
  randomUUID?: () => string;
  seeds?: MemorySquareBillingStoreSeeds;
  paymentMethods?: readonly SquarePaymentMethodRow[];
  intents?: readonly SquareSubscriptionIntentRow[];
  invoices?: readonly SquareSubscriptionInvoiceRow[];
  subscriptions?: readonly SquareHostSubscriptionPersistence[];
  payments?: readonly SquareCorrelatablePaymentRow[];
};

export type MemorySquareBillingStoreSnapshot = {
  paymentMethods: SquarePaymentMethodRow[];
  intents: SquareSubscriptionIntentRow[];
  invoices: SquareSubscriptionInvoiceRow[];
  subscriptions: SquareHostSubscriptionPersistence[];
  payments: SquareCorrelatablePaymentRow[];
};

export type MemorySquareBillingStores = SquareBillingStores & {
  snapshot(): MemorySquareBillingStoreSnapshot;
};

export function createMemorySquareBillingStores(
  options: MemorySquareBillingStoresOptions = {},
): MemorySquareBillingStores {
  assertNoSquareBillingTokenKeys(options);
  const now = options.now ?? (() => new Date());
  const uuid =
    options.uuid ??
    options.randomUUID ??
    (() => globalThis.crypto.randomUUID());
  const seeds = options.seeds;
  const paymentMethods = (options.paymentMethods ?? seeds?.paymentMethods ?? []).map(
    buildPaymentMethodRow,
  );
  const intents = (options.intents ?? seeds?.intents ?? []).map(buildIntentRow);
  const invoices = (options.invoices ?? seeds?.invoices ?? []).map(buildInvoiceRow);
  const subscriptions = (
    options.subscriptions ??
    seeds?.subscriptions ??
    []
  ).map(buildSubscriptionPersistence);
  const payments = (options.payments ?? seeds?.payments ?? []).map(buildPaymentRow);

  function assertSeedUniqueness() {
    for (let index = 0; index < intents.length; index += 1) {
      const row = intents[index];
      for (let otherIndex = index + 1; otherIndex < intents.length; otherIndex += 1) {
        const other = intents[otherIndex];
        if (row.id === other.id) invalidInput();
        if (row.square_environment === other.square_environment) {
          if (
            row.customer_idempotency_key === other.customer_idempotency_key ||
            row.card_idempotency_key === other.card_idempotency_key ||
            row.subscription_idempotency_key === other.subscription_idempotency_key
          ) {
            invalidInput();
          }
          if (
            row.square_subscription_id !== null &&
            row.square_subscription_id === other.square_subscription_id
          ) {
            invalidInput();
          }
          if (
            row.user_id === other.user_id &&
            OPEN_INTENT_STATUSES.has(row.status) &&
            OPEN_INTENT_STATUSES.has(other.status)
          ) {
            invalidInput();
          }
        }
      }
    }

    for (let index = 0; index < paymentMethods.length; index += 1) {
      const row = paymentMethods[index];
      for (
        let otherIndex = index + 1;
        otherIndex < paymentMethods.length;
        otherIndex += 1
      ) {
        const other = paymentMethods[otherIndex];
        if (
          row.id === other.id ||
          (row.square_environment === other.square_environment &&
            row.square_card_id === other.square_card_id)
        ) {
          invalidInput();
        }
      }
    }

    for (let index = 0; index < invoices.length; index += 1) {
      const row = invoices[index];
      for (let otherIndex = index + 1; otherIndex < invoices.length; otherIndex += 1) {
        const other = invoices[otherIndex];
        if (
          row.square_environment === other.square_environment &&
          (row.square_invoice_id === other.square_invoice_id ||
            (row.square_order_id !== null &&
              row.square_order_id === other.square_order_id))
        ) {
          invalidInput();
        }
      }
    }

    for (let index = 0; index < subscriptions.length; index += 1) {
      const row = subscriptions[index];
      for (
        let otherIndex = index + 1;
        otherIndex < subscriptions.length;
        otherIndex += 1
      ) {
        const other = subscriptions[otherIndex];
        if (
          row.user_id === other.user_id ||
          (row.square_environment === other.square_environment &&
            (row.square_customer_id === other.square_customer_id ||
              row.square_subscription_id === other.square_subscription_id))
        ) {
          invalidInput();
        }
      }
    }

    for (let index = 0; index < payments.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < payments.length; otherIndex += 1) {
        if (
          payments[index].id === payments[otherIndex].id ||
          payments[index].provider_payment_id ===
            payments[otherIndex].provider_payment_id
        ) {
          invalidInput();
        }
      }
    }
  }

  assertSeedUniqueness();

  function getIntentInternal(intentId: string) {
    return intents.find((row) => row.id === intentId) ?? null;
  }

  function expireIfNecessary(row: SquareSubscriptionIntentRow, nowIso: string) {
    if (
      OPEN_INTENT_STATUSES.has(row.status) &&
      Date.parse(row.expires_at) <= Date.parse(nowIso)
    ) {
      row.status = "expired";
      row.updated_at = nowIso;
      return true;
    }
    return false;
  }

  function requireLiveIntent(intentId: string, nowIso: string) {
    const row = getIntentInternal(intentId);
    if (!row) notFound();
    if (expireIfNecessary(row, nowIso) || row.status === "expired") {
      throw new SquareBillingStoreError("expired");
    }
    return row;
  }

  const intentStore: SquareSubscriptionIntentStore = {
    async createIntent(input) {
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

      const open = intents.find((row) => {
        if (
          row.user_id !== normalized.userId ||
          row.square_environment !== normalized.squareEnvironment ||
          !OPEN_INTENT_STATUSES.has(row.status)
        ) {
          return false;
        }
        expireIfNecessary(row, createdAt);
        return OPEN_INTENT_STATUSES.has(row.status);
      });
      if (open) {
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
      if (
        intents.some(
          (candidate) =>
            candidate.id === row.id ||
            (candidate.square_environment === row.square_environment &&
              (candidate.customer_idempotency_key ===
                row.customer_idempotency_key ||
                candidate.card_idempotency_key === row.card_idempotency_key ||
                candidate.subscription_idempotency_key ===
                  row.subscription_idempotency_key)),
        )
      ) {
        conflict();
      }
      intents.push(row);
      return { intent: cloneIntent(row), replayed: false };
    },

    async getIntent(intentId) {
      assertNoSquareBillingTokenKeys(intentId);
      const id = requireUuid(intentId);
      const row = getIntentInternal(id);
      return row ? cloneIntent(row) : null;
    },

    async recordCustomer(input) {
      const value = requireRecord(input);
      const intentId = requireUuid(value.intentId);
      const squareCustomerId = requireNonblank(value.squareCustomerId);
      const nowIso = currentIso(now);
      const row = requireLiveIntent(intentId, nowIso);

      if (row.square_customer_id !== null) {
        if (row.square_customer_id !== squareCustomerId) conflict();
        return { intent: cloneIntent(row), replayed: true };
      }
      if (row.status !== "pending") invalidLifecycle();
      const duplicate = intents.some(
        (candidate) =>
          candidate.id !== row.id &&
          candidate.square_environment === row.square_environment &&
          candidate.square_customer_id === squareCustomerId &&
          candidate.user_id !== row.user_id,
      );
      const persistedDuplicate = subscriptions.some(
        (candidate) =>
          candidate.square_environment === row.square_environment &&
          candidate.square_customer_id === squareCustomerId &&
          candidate.user_id !== row.user_id,
      );
      if (duplicate || persistedDuplicate) conflict();
      row.square_customer_id = squareCustomerId;
      row.status = "customer_ready";
      row.updated_at = nowIso;
      return { intent: cloneIntent(row), replayed: false };
    },

    async persistSubscription(input) {
      const value = requireRecord(input);
      const normalized = {
        intentId: requireUuid(value.intentId),
        squareSubscriptionId: requireNonblank(value.squareSubscriptionId),
        squareSubscriptionStatus: requireNonblank(
          value.squareSubscriptionStatus,
        ),
        squareSubscriptionVersion: requireNullableVersion(
          value.squareSubscriptionVersion,
        ),
        startDate: requireNullableCalendarDate(value.startDate),
        chargedThroughDate: requireNullableCalendarDate(
          value.chargedThroughDate,
        ),
        canceledDate: requireNullableCalendarDate(value.canceledDate),
      };
      const nowIso = currentIso(now);
      const row = getIntentInternal(normalized.intentId);
      if (!row) notFound();

      const existing = subscriptions.find(
        (candidate) =>
          candidate.square_environment === row.square_environment &&
          candidate.square_subscription_id === normalized.squareSubscriptionId,
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
      if (expireIfNecessary(row, nowIso) || row.status === "expired") {
        throw new SquareBillingStoreError("expired");
      }
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
      const duplicateIntent = intents.some(
        (candidate) =>
          candidate.id !== row.id &&
          candidate.square_environment === row.square_environment &&
          candidate.square_subscription_id === normalized.squareSubscriptionId,
      );
      if (duplicateIntent) conflict();
      const trusted = trustedSubscription(row, normalized);
      const otherOwnerConflict = subscriptions.some(
        (candidate) =>
          candidate !== existing &&
          candidate.user_id !== trusted.user_id &&
          candidate.square_environment === trusted.square_environment &&
          (candidate.square_customer_id === trusted.square_customer_id ||
            candidate.square_subscription_id === trusted.square_subscription_id),
      );
      if (
        otherOwnerConflict ||
        (existing &&
          existing.user_id === trusted.user_id &&
          !subscriptionsEqual(existing, trusted))
      ) {
        conflict();
      }
      mapSquareSubscriptionStatusToHostStatus(normalized.squareSubscriptionStatus);
      const sameUserIndex = subscriptions.findIndex(
        (candidate) => candidate.user_id === trusted.user_id,
      );
      if (sameUserIndex >= 0) {
        subscriptions[sameUserIndex] = trusted;
      } else if (!existing) {
        subscriptions.push(trusted);
      }
      if (!isEnrollableSquareSubscriptionStatus(normalized.squareSubscriptionStatus)) {
        return {
          intent: cloneIntent(row),
          subscription: cloneSubscription(existing ?? trusted),
          replayed: false,
        };
      }
      row.square_subscription_id = normalized.squareSubscriptionId;
      row.status = "completed";
      row.updated_at = nowIso;
      return {
        intent: cloneIntent(row),
        subscription: cloneSubscription(existing ?? trusted),
        replayed: false,
      };
    },

    async completeIntent(input) {
      const value = requireRecord(input);
      const intentId = requireUuid(value.intentId);
      const nowIso = currentIso(now);
      const row = getIntentInternal(intentId);
      if (!row) notFound();
      if (row.status === "completed") {
        return { intent: cloneIntent(row), replayed: true };
      }
      if (expireIfNecessary(row, nowIso) || row.status === "expired") {
        throw new SquareBillingStoreError("expired");
      }
      if (row.status !== "subscription_ready") invalidLifecycle();
      if (
        !subscriptions.some(
          (candidate) =>
            candidate.square_environment === row.square_environment &&
            candidate.square_subscription_id === row.square_subscription_id,
        )
      ) {
        invalidLifecycle();
      }
      row.status = "completed";
      row.updated_at = nowIso;
      return { intent: cloneIntent(row), replayed: false };
    },

    async failIntent(input) {
      const value = requireRecord(input);
      const intentId = requireUuid(value.intentId);
      const errorCode = requireNonblank(value.errorCode, 128);
      const nowIso = currentIso(now);
      const row = getIntentInternal(intentId);
      if (!row) notFound();
      if (row.status === "failed") {
        if (row.last_error_code !== errorCode) conflict();
        return { intent: cloneIntent(row), replayed: true };
      }
      if (expireIfNecessary(row, nowIso) || row.status === "expired") {
        throw new SquareBillingStoreError("expired");
      }
      if (!OPEN_INTENT_STATUSES.has(row.status)) invalidLifecycle();
      row.status = "failed";
      row.last_error_code = errorCode;
      row.updated_at = nowIso;
      return { intent: cloneIntent(row), replayed: false };
    },

    async expireIntent(input) {
      const value = requireRecord(input);
      const intentId = requireUuid(value.intentId);
      const nowIso = currentIso(now);
      const row = getIntentInternal(intentId);
      if (!row) notFound();
      if (row.status === "expired") {
        return { intent: cloneIntent(row), replayed: true };
      }
      if (!OPEN_INTENT_STATUSES.has(row.status)) invalidLifecycle();
      if (Date.parse(row.expires_at) > Date.parse(nowIso)) invalidLifecycle();
      row.status = "expired";
      row.updated_at = nowIso;
      return { intent: cloneIntent(row), replayed: false };
    },
  };

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

  const paymentMethodStore: SquarePaymentMethodStore = {
    async persistPaymentMethod(input) {
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
      const intent = requireLiveIntent(normalized.intentId, nowIso);
      if (!intent.square_customer_id) invalidLifecycle();

      const existing = paymentMethods.find(
        (row) =>
          row.square_environment === intent.square_environment &&
          row.square_card_id === normalized.squareCardId,
      );
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

      const row: SquarePaymentMethodRow = {
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
      if (paymentMethods.some((candidate) => candidate.id === row.id)) conflict();
      paymentMethods.push(row);
      intent.square_card_id = row.square_card_id;
      intent.status = "card_ready";
      intent.updated_at = nowIso;
      return {
        intent: cloneIntent(intent),
        paymentMethod: clonePaymentMethod(row),
        replayed: false,
      };
    },

    async listPaymentMethods(userId, squareEnvironment) {
      assertNoSquareBillingTokenKeys({ userId, squareEnvironment });
      const normalizedUserId = requireUuid(userId);
      const environment = requireEnvironment(squareEnvironment);
      return paymentMethods
        .filter(
          (row) =>
            row.user_id === normalizedUserId &&
            row.square_environment === environment,
        )
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .map(clonePaymentMethod);
    },

    async disablePaymentMethod(input) {
      const value = requireRecord(input);
      const id = requireUuid(value.paymentMethodId);
      const row = paymentMethods.find((candidate) => candidate.id === id);
      if (!row) notFound();
      if (!row.enabled) return clonePaymentMethod(row);
      row.enabled = false;
      row.updated_at = currentIso(now);
      return clonePaymentMethod(row);
    },
  };

  const invoicePaymentStore: SquareInvoicePaymentStore = {
    async persistInvoice(input) {
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
      const trusted = subscriptions.find(
        (row) =>
          row.square_environment === normalized.squareEnvironment &&
          row.square_subscription_id === normalized.squareSubscriptionId,
      );
      if (!trusted) notFound();

      const existing = invoices.find(
        (row) =>
          row.square_environment === normalized.squareEnvironment &&
          row.square_invoice_id === normalized.squareInvoiceId,
      );
      if (existing) {
        if (
          existing.square_subscription_id !== normalized.squareSubscriptionId ||
          existing.user_id !== trusted.user_id ||
          existing.square_location_id !== trusted.square_location_id ||
          existing.plan_id !== trusted.plan_id ||
          existing.billing_cycle !== trusted.billing_cycle ||
          existing.square_plan_variation_id !==
            trusted.square_plan_variation_id
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
        const orderConflict = invoices.some(
          (row) =>
            row !== existing &&
            row.square_environment === normalized.squareEnvironment &&
            normalized.squareOrderId !== null &&
            row.square_order_id === normalized.squareOrderId,
        );
        if (orderConflict) conflict();
        existing.square_order_id = normalized.squareOrderId;
        existing.square_invoice_status = normalized.squareInvoiceStatus;
        existing.square_invoice_version = normalized.squareInvoiceVersion;
        existing.amount_usd = normalized.amountUsd;
        existing.currency = normalized.currency;
        existing.due_date = normalized.dueDate;
        existing.paid_at = normalized.paidAt;
        existing.updated_at = currentIso(now);
        return { invoice: cloneInvoice(existing), replayed: false };
      }

      if (
        normalized.squareOrderId !== null &&
        invoices.some(
          (row) =>
            row.square_environment === normalized.squareEnvironment &&
            row.square_order_id === normalized.squareOrderId,
        )
      ) {
        conflict();
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
      invoices.push(row);
      return { invoice: cloneInvoice(row), replayed: false };
    },

    async correlatePayment(input) {
      const value = requireRecord(input);
      const normalized = {
        providerPaymentId: requireNonblank(value.providerPaymentId),
        squareEnvironment: requireEnvironment(value.squareEnvironment),
        squareInvoiceId: requireNullableNonblank(value.squareInvoiceId),
        squareOrderId: requireNullableNonblank(value.squareOrderId),
        squareSubscriptionId: requireNullableNonblank(
          value.squareSubscriptionId,
        ),
      };
      if (
        normalized.squareInvoiceId === null &&
        normalized.squareOrderId === null &&
        normalized.squareSubscriptionId === null
      ) {
        invalidInput();
      }

      const invoiceById =
        normalized.squareInvoiceId === null
          ? null
          : invoices.find(
              (row) =>
                row.square_environment === normalized.squareEnvironment &&
                row.square_invoice_id === normalized.squareInvoiceId,
            ) ?? null;
      const invoiceByOrder =
        normalized.squareOrderId === null
          ? null
          : invoices.find(
              (row) =>
                row.square_environment === normalized.squareEnvironment &&
                row.square_order_id === normalized.squareOrderId,
            ) ?? null;
      if (
        invoiceById !== null &&
        invoiceByOrder !== null &&
        invoiceById !== invoiceByOrder
      ) {
        conflict();
      }
      if (
        (invoiceById !== null &&
          ((normalized.squareOrderId !== null &&
            invoiceById.square_order_id !== normalized.squareOrderId) ||
            (normalized.squareSubscriptionId !== null &&
              invoiceById.square_subscription_id !==
                normalized.squareSubscriptionId))) ||
        (invoiceByOrder !== null &&
          ((normalized.squareInvoiceId !== null &&
            invoiceByOrder.square_invoice_id !== normalized.squareInvoiceId) ||
            (normalized.squareSubscriptionId !== null &&
              invoiceByOrder.square_subscription_id !==
                normalized.squareSubscriptionId)))
      ) {
        conflict();
      }

      const candidates = invoices.filter((row) => {
        if (row.square_environment !== normalized.squareEnvironment) return false;
        if (
          normalized.squareInvoiceId !== null &&
          row.square_invoice_id !== normalized.squareInvoiceId
        ) {
          return false;
        }
        if (
          normalized.squareOrderId !== null &&
          row.square_order_id !== normalized.squareOrderId
        ) {
          return false;
        }
        if (
          normalized.squareSubscriptionId !== null &&
          row.square_subscription_id !== normalized.squareSubscriptionId
        ) {
          return false;
        }
        return true;
      });
      if (candidates.length > 1) conflict();
      const invoice = candidates[0] ?? null;
      const payment = payments.find(
        (row) => row.provider_payment_id === normalized.providerPaymentId,
      );
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
        billingCycle: invoice.billing_cycle,
        squareEnvironment: invoice.square_environment,
        squareLocationId: invoice.square_location_id,
        squareSubscriptionId: invoice.square_subscription_id,
        squareInvoiceId: invoice.square_invoice_id,
        squareOrderId: invoice.square_order_id,
      };
      const fields: Array<[string | null, string | null]> = [
        [payment.billing_cycle, expected.billingCycle],
        [payment.square_environment, expected.squareEnvironment],
        [payment.square_location_id, expected.squareLocationId],
        [payment.square_subscription_id, expected.squareSubscriptionId],
        [payment.square_invoice_id, expected.squareInvoiceId],
        [payment.square_order_id, expected.squareOrderId],
      ];
      if (fields.some(([current, next]) => current !== null && current !== next)) {
        conflict();
      }
      const replayed = fields.every(([current, next]) => current === next);
      payment.billing_cycle = expected.billingCycle;
      payment.square_environment = expected.squareEnvironment;
      payment.square_location_id = expected.squareLocationId;
      payment.square_subscription_id = expected.squareSubscriptionId;
      payment.square_invoice_id = expected.squareInvoiceId;
      payment.square_order_id = expected.squareOrderId;
      return {
        correlated: true,
        replayed,
        invoice: cloneInvoice(invoice),
        payment: clonePayment(payment),
      };
    },
  };

  const hostSubscriptionStore: SquareHostSubscriptionStore = {
    async getByUserId(userId) {
      assertNoSquareBillingTokenKeys(userId);
      const id = requireUuid(userId);
      const matches = subscriptions.filter((row) => row.user_id === id);
      if (matches.length > 1) conflict();
      const row = matches[0];
      if (!row) return null;
      return {
        user_id: row.user_id,
        square_environment: row.square_environment,
        square_location_id: row.square_location_id,
        square_customer_id: row.square_customer_id,
        square_subscription_id: row.square_subscription_id,
      };
    },
  };

  return {
    intents: intentStore,
    paymentMethods: paymentMethodStore,
    invoicePayments: invoicePaymentStore,
    hostSubscriptions: hostSubscriptionStore,
    snapshot() {
      return {
        paymentMethods: paymentMethods.map(clonePaymentMethod),
        intents: intents.map(cloneIntent),
        invoices: invoices.map(cloneInvoice),
        subscriptions: subscriptions.map(cloneSubscription),
        payments: payments.map(clonePayment),
      };
    },
  };
}