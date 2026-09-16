import {
  SquareBillingStoreError,
  assertNoSquareBillingTokenKeys,
  isEnrollableSquareSubscriptionStatus,
  type SquareBillingStores,
  type SquareSubscriptionIntentRow,
  type SquareSubscriptionIntentStatus,
} from "@/lib/square-billing-stores";

/** Server-only enrollment orchestration. */
if (typeof window !== "undefined") {
  throw new Error("square-subscription-enroll is server-only");
}

const TERMINAL_INTENT_STATUSES = new Set<SquareSubscriptionIntentStatus>([
  "failed",
  "expired",
]);

export type SquareSubscriptionEnrollErrorCode =
  | "unauthorized"
  | "not_found"
  | "forbidden"
  | "expired"
  | "invalid_lifecycle"
  | "invalid_input"
  | "conflict"
  | "customer_failed"
  | "card_failed"
  | "subscription_failed"
  | "persist_failed"
  | "square_subscription_not_enrollable"
  | "unavailable";

/** Internal customer-path stage — never returned as the public API error code. */
export type SquareCustomerPathFailureStage =
  | "customer_search_failed"
  | "customer_create_failed";

export type SafeSquareErrorDiagnostic = {
  httpStatus: number | null;
  category: string | null;
  code: string | null;
  message: string | null;
  field: string | null;
};

const SENSITIVE_DIAGNOSTIC_TEXT =
  /\b(?:cnon:[A-Za-z0-9_-]+|tok_[A-Za-z0-9_-]+|sq0[a-z]{2,}-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+|sb_secret_[A-Za-z0-9_-]+|\d{12,19})\b/gi;

function sanitizeSafeDiagnosticText(
  value: unknown,
  maxLen = 160,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(SENSITIVE_DIAGNOSTIC_TEXT, "[redacted]")
    .slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

function asFiniteStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

/**
 * Extract allowlisted Square error fields only. Never copies headers, tokens,
 * or raw response bodies.
 */
export function extractSafeSquareErrorDiagnostic(
  error: unknown,
): SafeSquareErrorDiagnostic {
  const empty: SafeSquareErrorDiagnostic = {
    httpStatus: null,
    category: null,
    code: null,
    message: null,
    field: null,
  };
  if (!error || typeof error !== "object") return empty;

  const record = error as Record<string, unknown>;
  const httpStatus =
    asFiniteStatus(record.statusCode) ??
    asFiniteStatus(record.status) ??
    null;

  const body =
    record.body && typeof record.body === "object"
      ? (record.body as Record<string, unknown>)
      : null;
  const errorList = Array.isArray(record.errors)
    ? record.errors
    : Array.isArray(body?.errors)
      ? body.errors
      : [];

  const first =
    errorList.find((entry) => entry && typeof entry === "object") ?? null;
  const firstRecord = first as Record<string, unknown> | null;

  return {
    httpStatus,
    category: sanitizeSafeDiagnosticText(firstRecord?.category, 64),
    code: sanitizeSafeDiagnosticText(firstRecord?.code, 64),
    message: sanitizeSafeDiagnosticText(
      firstRecord?.detail ?? firstRecord?.message ?? record.message,
      160,
    ),
    field: sanitizeSafeDiagnosticText(firstRecord?.field, 64),
  };
}

export function logSafeCustomerPathFailure(
  stage: SquareCustomerPathFailureStage,
  diagnostic: SafeSquareErrorDiagnostic,
): void {
  // Dev/server only — never includes tokens, bodies, or headers.
  console.info(
    JSON.stringify({
      scope: "b4c_customer_path",
      stage,
      httpStatus: diagnostic.httpStatus,
      category: diagnostic.category,
      code: diagnostic.code,
      message: diagnostic.message,
      field: diagnostic.field,
    }),
  );
}

export class SquareSubscriptionEnrollError extends Error {
  readonly code: SquareSubscriptionEnrollErrorCode;
  readonly customerStage: SquareCustomerPathFailureStage | null;
  readonly safeDiagnostic: SafeSquareErrorDiagnostic | null;

  constructor(
    code: SquareSubscriptionEnrollErrorCode,
    message?: string,
    options?: {
      customerStage?: SquareCustomerPathFailureStage;
      safeDiagnostic?: SafeSquareErrorDiagnostic;
    },
  ) {
    super(message ?? code);
    this.name = "SquareSubscriptionEnrollError";
    this.code = code;
    this.customerStage = options?.customerStage ?? null;
    this.safeDiagnostic = options?.safeDiagnostic ?? null;
  }
}

export type SquareEnrollCreateCardRequest = {
  idempotencyKey: string;
  sourceId: string;
  verificationToken?: string;
  card: {
    customerId: string;
    cardholderName?: string;
    billingAddress?: {
      postalCode: string;
      country?: string;
    };
    referenceId?: string;
  };
};

export type SquareEnrollCreateSubscriptionRequest = {
  idempotencyKey: string;
  locationId: string;
  customerId: string;
  planVariationId: string;
  cardId: string;
};

export type SquareEnrollCardResult = {
  id: string;
  cardBrand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

export type SquareEnrollSubscriptionResult = {
  id: string;
  status: string;
  version: number | null;
  startDate: string | null;
  chargedThroughDate: string | null;
  canceledDate: string | null;
};

export type SquareEnrollClient = {
  customers: {
    search: (input: {
      query: { filter: { emailAddress: { exact: string } } };
    }) => Promise<{ customers?: Array<{ id?: string | null }> | null }>;
    create: (input: {
      idempotencyKey: string;
      emailAddress: string;
      givenName?: string;
      referenceId?: string;
    }) => Promise<{ customer?: { id?: string | null } | null }>;
  };
  cards: {
    create: (
      input: SquareEnrollCreateCardRequest,
    ) => Promise<{ card?: Partial<SquareEnrollCardResult> & { id?: string } }>;
  };
  subscriptions: {
    create: (
      input: SquareEnrollCreateSubscriptionRequest,
    ) => Promise<{
      subscription?: {
        id?: string | null;
        status?: string | null;
        version?: number | bigint | null;
        startDate?: string | null;
        chargedThroughDate?: string | null;
        canceledDate?: string | null;
      } | null;
    }>;
  };
};

export type EnrollSquareSubscriptionInput = {
  intentId: string;
  userId: string;
  email: string;
  /** Required unless intent is already card_ready / has square_card_id. */
  sourceId?: string | null;
  verificationToken?: string | null;
  cardholderName?: string | null;
  postalCode?: string | null;
};

export type EnrollSquareSubscriptionDependencies = {
  stores: SquareBillingStores;
  square: SquareEnrollClient;
  now?: () => Date;
};

export type EnrollSquareSubscriptionSuccess = {
  ok: true;
  intentId: string;
  subscriptionId: string;
  status: SquareSubscriptionIntentStatus;
  replayed: boolean;
};

export type EnrollSquareSubscriptionFailure = {
  ok: false;
  intentId: string | null;
  status: SquareSubscriptionIntentStatus | null;
  error: SquareSubscriptionEnrollErrorCode;
};

export type EnrollSquareSubscriptionResult =
  | EnrollSquareSubscriptionSuccess
  | EnrollSquareSubscriptionFailure;

function nonblank(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableNumber(
  value: number | bigint | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asNullableCalendarDate(value: string | null | undefined): string | null {
  const trimmed = nonblank(value);
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function buildSquareCreateCardRequest(input: {
  cardIdempotencyKey: string;
  sourceId: string;
  customerId: string;
  verificationToken?: string | null;
  cardholderName?: string | null;
  postalCode?: string | null;
  referenceId?: string | null;
}): SquareEnrollCreateCardRequest {
  const sourceId = nonblank(input.sourceId);
  const customerId = nonblank(input.customerId);
  const idempotencyKey = nonblank(input.cardIdempotencyKey);
  if (!sourceId || !customerId || !idempotencyKey) {
    throw new SquareSubscriptionEnrollError("invalid_input");
  }

  const request: SquareEnrollCreateCardRequest = {
    idempotencyKey,
    sourceId,
    card: {
      customerId,
    },
  };

  const verificationToken = nonblank(input.verificationToken);
  if (verificationToken) {
    request.verificationToken = verificationToken;
  }

  const cardholderName = nonblank(input.cardholderName);
  if (cardholderName) {
    request.card.cardholderName = cardholderName;
  }

  const postalCode = nonblank(input.postalCode);
  if (postalCode) {
    request.card.billingAddress = {
      postalCode,
      country: "US",
    };
  }

  const referenceId = nonblank(input.referenceId);
  if (referenceId) {
    request.card.referenceId = referenceId;
  }

  return request;
}

export function buildSquareCreateSubscriptionRequest(input: {
  subscriptionIdempotencyKey: string;
  locationId: string;
  customerId: string;
  planVariationId: string;
  cardId: string;
}): SquareEnrollCreateSubscriptionRequest {
  const idempotencyKey = nonblank(input.subscriptionIdempotencyKey);
  const locationId = nonblank(input.locationId);
  const customerId = nonblank(input.customerId);
  const planVariationId = nonblank(input.planVariationId);
  const cardId = nonblank(input.cardId);
  if (
    !idempotencyKey ||
    !locationId ||
    !customerId ||
    !planVariationId ||
    !cardId
  ) {
    throw new SquareSubscriptionEnrollError("invalid_input");
  }

  return {
    idempotencyKey,
    locationId,
    customerId,
    planVariationId,
    cardId,
  };
}

function mapStoreError(
  error: unknown,
): SquareSubscriptionEnrollErrorCode {
  if (error instanceof SquareBillingStoreError) {
    if (error.code === "not_found") return "not_found";
    if (error.code === "expired") return "expired";
    if (error.code === "conflict") return "conflict";
    if (error.code === "invalid_lifecycle") return "invalid_lifecycle";
    if (error.code === "invalid_input") return "invalid_input";
    return "unavailable";
  }
  if (error instanceof SquareSubscriptionEnrollError) {
    return error.code;
  }
  return "unavailable";
}

function failure(
  code: SquareSubscriptionEnrollErrorCode,
  intent: SquareSubscriptionIntentRow | null,
): EnrollSquareSubscriptionFailure {
  return {
    ok: false,
    intentId: intent?.id ?? null,
    status: intent?.status ?? null,
    error: code,
  };
}

const FIXTURE_INVALID_EMAIL_SUFFIXES = [".invalid"] as const;

function emailHost(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

function emailLocalPart(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(0, at).trim().toLowerCase();
}

/** True when the address is syntactically usable by Square (not a reserved invalid host). */
export function isSquareAcceptableEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@")) return false;
  const local = emailLocalPart(trimmed);
  const host = emailHost(trimmed);
  if (!local || !host) return false;
  if (local.includes(" ") || host.includes(" ")) return false;
  if (!host.includes(".")) return false;
  if (FIXTURE_INVALID_EMAIL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return false;
  }
  return true;
}

export function isSandboxFixtureInvalidEmail(email: string): boolean {
  const host = emailHost(email.trim().toLowerCase());
  return FIXTURE_INVALID_EMAIL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function stableSandboxUserFragment(userId: string): string {
  return userId.replace(/-/g, "").toLowerCase().slice(0, 12);
}

/**
 * Resolve the email address sent to Square Customers APIs.
 * Production: real auth email only; fail closed if missing/invalid.
 * Sandbox: map reserved fixture hosts (*.invalid) to a stable @example.com address.
 */
export function resolveSquareCustomerEmail(input: {
  email: string | null | undefined;
  userId: string;
  squareEnvironment: "sandbox" | "production";
}): string {
  const userId = nonblank(input.userId);
  if (!userId) {
    throw new SquareSubscriptionEnrollError("invalid_input");
  }

  const raw = nonblank(input.email)?.toLowerCase() ?? null;

  if (input.squareEnvironment === "production") {
    if (!raw || !isSquareAcceptableEmail(raw)) {
      throw new SquareSubscriptionEnrollError("invalid_input");
    }
    return raw;
  }

  // sandbox
  if (raw && isSquareAcceptableEmail(raw)) {
    return raw;
  }
  if (raw && isSandboxFixtureInvalidEmail(raw)) {
    return `zencierge-sandbox+${stableSandboxUserFragment(userId)}@example.com`;
  }

  throw new SquareSubscriptionEnrollError("invalid_input");
}

async function ensureSquareCustomerId(input: {
  intent: SquareSubscriptionIntentRow;
  email: string;
  userId: string;
  square: SquareEnrollClient;
}): Promise<string> {
  const existing = nonblank(input.intent.square_customer_id);
  if (existing) return existing;

  const email = resolveSquareCustomerEmail({
    email: input.email,
    userId: input.userId,
    squareEnvironment: input.intent.square_environment,
  });

  let searchResult: { customers?: Array<{ id?: string | null }> | null };
  try {
    searchResult = await input.square.customers.search({
      query: {
        filter: {
          emailAddress: { exact: email },
        },
      },
    });
  } catch (error) {
    if (error instanceof SquareSubscriptionEnrollError) throw error;
    const diagnostic = extractSafeSquareErrorDiagnostic(error);
    logSafeCustomerPathFailure("customer_search_failed", diagnostic);
    throw new SquareSubscriptionEnrollError("customer_failed", undefined, {
      customerStage: "customer_search_failed",
      safeDiagnostic: diagnostic,
    });
  }

  const found = nonblank(searchResult.customers?.[0]?.id ?? null);
  if (found) return found;

  try {
    const created = await input.square.customers.create({
      idempotencyKey: input.intent.customer_idempotency_key,
      emailAddress: email,
      referenceId: input.intent.user_id,
    });
    const createdId = nonblank(created.customer?.id ?? null);
    if (!createdId) {
      const diagnostic: SafeSquareErrorDiagnostic = {
        httpStatus: null,
        category: null,
        code: "MISSING_CUSTOMER_ID",
        message: "customers.create returned no customer id",
        field: null,
      };
      logSafeCustomerPathFailure("customer_create_failed", diagnostic);
      throw new SquareSubscriptionEnrollError("customer_failed", undefined, {
        customerStage: "customer_create_failed",
        safeDiagnostic: diagnostic,
      });
    }
    return createdId;
  } catch (error) {
    if (error instanceof SquareSubscriptionEnrollError) throw error;
    const diagnostic = extractSafeSquareErrorDiagnostic(error);
    logSafeCustomerPathFailure("customer_create_failed", diagnostic);
    throw new SquareSubscriptionEnrollError("customer_failed", undefined, {
      customerStage: "customer_create_failed",
      safeDiagnostic: diagnostic,
    });
  }
}

async function ensureSquareCard(input: {
  intent: SquareSubscriptionIntentRow;
  customerId: string;
  sourceId: string | null;
  verificationToken: string | null;
  cardholderName: string | null;
  postalCode: string | null;
  square: SquareEnrollClient;
  stores: SquareBillingStores;
  nowIso: string;
}): Promise<{ cardId: string; intent: SquareSubscriptionIntentRow }> {
  const existingCardId = nonblank(input.intent.square_card_id);
  if (
    existingCardId &&
    (input.intent.status === "card_ready" ||
      input.intent.status === "subscription_ready" ||
      input.intent.status === "completed")
  ) {
    return { cardId: existingCardId, intent: input.intent };
  }

  if (!input.sourceId) {
    throw new SquareSubscriptionEnrollError("invalid_input");
  }

  let createdCard: SquareEnrollCardResult;
  try {
    const request = buildSquareCreateCardRequest({
      cardIdempotencyKey: input.intent.card_idempotency_key,
      sourceId: input.sourceId,
      customerId: input.customerId,
      verificationToken: input.verificationToken,
      cardholderName: input.cardholderName,
      postalCode: input.postalCode,
      referenceId: input.intent.user_id,
    });
    const response = await input.square.cards.create(request);
    const cardId = nonblank(response.card?.id ?? null);
    if (!cardId) {
      throw new SquareSubscriptionEnrollError("card_failed");
    }
    createdCard = {
      id: cardId,
      cardBrand: nonblank(response.card?.cardBrand ?? null),
      last4: nonblank(response.card?.last4 ?? null),
      expMonth: asNullableNumber(response.card?.expMonth),
      expYear: asNullableNumber(response.card?.expYear),
    };
  } catch (error) {
    if (error instanceof SquareSubscriptionEnrollError) throw error;
    throw new SquareSubscriptionEnrollError("card_failed");
  }

  const persistInput = {
    intentId: input.intent.id,
    squareCardId: createdCard.id,
    cardBrand: createdCard.cardBrand,
    last4: createdCard.last4,
    expMonth: createdCard.expMonth,
    expYear: createdCard.expYear,
    consentedAt: input.nowIso,
  };
  assertNoSquareBillingTokenKeys(persistInput);

  try {
    const persisted = await input.stores.paymentMethods.persistPaymentMethod(
      persistInput,
    );
    return {
      cardId: persisted.paymentMethod.square_card_id,
      intent: persisted.intent,
    };
  } catch (error) {
    throw new SquareSubscriptionEnrollError(mapStoreError(error));
  }
}

async function createAndPersistSubscription(input: {
  intent: SquareSubscriptionIntentRow;
  customerId: string;
  cardId: string;
  square: SquareEnrollClient;
  stores: SquareBillingStores;
}): Promise<EnrollSquareSubscriptionSuccess> {
  let subscription: SquareEnrollSubscriptionResult;
  try {
    const request = buildSquareCreateSubscriptionRequest({
      subscriptionIdempotencyKey: input.intent.subscription_idempotency_key,
      locationId: input.intent.square_location_id,
      customerId: input.customerId,
      planVariationId: input.intent.square_plan_variation_id,
      cardId: input.cardId,
    });
    const response = await input.square.subscriptions.create(request);
    const subscriptionId = nonblank(response.subscription?.id ?? null);
    const status = nonblank(response.subscription?.status ?? null);
    if (!subscriptionId || !status) {
      throw new SquareSubscriptionEnrollError("subscription_failed");
    }
    subscription = {
      id: subscriptionId,
      status,
      version: asNullableNumber(response.subscription?.version),
      startDate: asNullableCalendarDate(response.subscription?.startDate),
      chargedThroughDate: asNullableCalendarDate(
        response.subscription?.chargedThroughDate,
      ),
      canceledDate: asNullableCalendarDate(
        response.subscription?.canceledDate ?? null,
      ),
    };
  } catch (error) {
    if (error instanceof SquareSubscriptionEnrollError) throw error;
    throw new SquareSubscriptionEnrollError("subscription_failed");
  }

  if (!isEnrollableSquareSubscriptionStatus(subscription.status)) {
    try {
      await input.stores.intents.failIntent({
        intentId: input.intent.id,
        errorCode: "square_subscription_not_enrollable",
      });
    } catch {
      /* enroll still fails closed */
    }
    throw new SquareSubscriptionEnrollError("square_subscription_not_enrollable");
  }

  const persistInput = {
    intentId: input.intent.id,
    squareSubscriptionId: subscription.id,
    squareSubscriptionStatus: subscription.status,
    squareSubscriptionVersion: subscription.version,
    startDate: subscription.startDate,
    chargedThroughDate: subscription.chargedThroughDate,
    canceledDate: subscription.canceledDate,
  };
  assertNoSquareBillingTokenKeys(persistInput);

  let persistedIntent: SquareSubscriptionIntentRow;
  let replayed = false;
  try {
    const persisted = await input.stores.intents.persistSubscription(persistInput);
    persistedIntent = persisted.intent;
    replayed = persisted.replayed;
  } catch (error) {
    throw new SquareSubscriptionEnrollError(
      mapStoreError(error) === "unavailable" ? "persist_failed" : mapStoreError(error),
    );
  }

  if (persistedIntent.status === "subscription_ready") {
    try {
      const completed = await input.stores.intents.completeIntent({
        intentId: persistedIntent.id,
      });
      persistedIntent = completed.intent;
      replayed = replayed || completed.replayed;
    } catch (error) {
      throw new SquareSubscriptionEnrollError(
        mapStoreError(error) === "unavailable"
          ? "persist_failed"
          : mapStoreError(error),
      );
    }
  } else if (persistedIntent.status === "completed") {
    // Memory/Supabase persistSubscription may complete in one step.
    // completeIntent is best-effort replay and must not flip first-write replayed.
    try {
      await input.stores.intents.completeIntent({
        intentId: persistedIntent.id,
      });
    } catch {
      /* already completed */
    }
  }

  const subscriptionId = nonblank(persistedIntent.square_subscription_id);
  if (!subscriptionId) {
    throw new SquareSubscriptionEnrollError("persist_failed");
  }

  return {
    ok: true,
    intentId: persistedIntent.id,
    subscriptionId,
    status: persistedIntent.status,
    replayed,
  };
}

/**
 * Production-correct host subscription enrollment.
 * Never persists sourceId/nonce/token. Trusts intent-stored catalog fields only.
 */
export async function enrollSquareSubscription(
  input: EnrollSquareSubscriptionInput,
  dependencies: EnrollSquareSubscriptionDependencies,
): Promise<EnrollSquareSubscriptionResult> {
  const intentId = nonblank(input.intentId);
  const userId = nonblank(input.userId);
  if (!intentId || !userId) {
    return failure("unauthorized", null);
  }

  // Sensitive payment fields stay in locals — never merged into store payloads.
  const sourceId = nonblank(input.sourceId);
  const verificationToken = nonblank(input.verificationToken);
  const cardholderName = nonblank(input.cardholderName);
  const postalCode = nonblank(input.postalCode);
  const email = nonblank(input.email);

  let intent: SquareSubscriptionIntentRow | null = null;
  try {
    intent = await dependencies.stores.intents.getIntent(intentId);
  } catch (error) {
    return failure(mapStoreError(error), null);
  }

  if (!intent) {
    return failure("not_found", null);
  }

  if (intent.user_id !== userId) {
    return failure("forbidden", intent);
  }

  if (TERMINAL_INTENT_STATUSES.has(intent.status)) {
    return failure(
      intent.status === "expired" ? "expired" : "invalid_lifecycle",
      intent,
    );
  }

  const now = dependencies.now?.() ?? new Date();
  if (Date.parse(intent.expires_at) <= now.getTime()) {
    return failure("expired", intent);
  }

  if (
    intent.status === "completed" &&
    nonblank(intent.square_subscription_id)
  ) {
    return {
      ok: true,
      intentId: intent.id,
      subscriptionId: intent.square_subscription_id!,
      status: intent.status,
      replayed: true,
    };
  }

  try {
    const customerId = await ensureSquareCustomerId({
      intent,
      email: email ?? "",
      userId,
      square: dependencies.square,
    });

    if (!nonblank(intent.square_customer_id)) {
      const recorded = await dependencies.stores.intents.recordCustomer({
        intentId: intent.id,
        squareCustomerId: customerId,
      });
      intent = recorded.intent;
    } else if (intent.square_customer_id !== customerId) {
      return failure("conflict", intent);
    }

    const nowIso = now.toISOString();
    const card = await ensureSquareCard({
      intent,
      customerId,
      sourceId,
      verificationToken,
      cardholderName,
      postalCode,
      square: dependencies.square,
      stores: dependencies.stores,
      nowIso,
    });
    intent = card.intent;

    return await createAndPersistSubscription({
      intent,
      customerId,
      cardId: card.cardId,
      square: dependencies.square,
      stores: dependencies.stores,
    });
  } catch (error) {
    const code = mapStoreError(error);
    if (intent) {
      try {
        const latest = await dependencies.stores.intents.getIntent(intent.id);
        if (latest) intent = latest;
      } catch {
        /* keep last known intent */
      }
    }
    return failure(code, intent);
  }
}

export function mapEnrollErrorToHttpStatus(
  code: SquareSubscriptionEnrollErrorCode,
): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "expired":
    case "invalid_lifecycle":
    case "invalid_input":
    case "square_subscription_not_enrollable":
      return 400;
    case "conflict":
      return 409;
    case "customer_failed":
    case "card_failed":
    case "subscription_failed":
    case "persist_failed":
    case "unavailable":
    default:
      return 502;
  }
}
