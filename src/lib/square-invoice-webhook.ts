/**
 * Pure Square invoice webhook parser (7D2-D3).
 * No DB writes, no Square/Supabase network, no invoice persist or payment correlation.
 */

export const SQUARE_INVOICE_WEBHOOK_EVENT_TYPES = [
  "invoice.created",
  "invoice.updated",
  "invoice.published",
  "invoice.payment_made",
] as const;

export type SquareInvoiceWebhookEventType =
  (typeof SQUARE_INVOICE_WEBHOOK_EVENT_TYPES)[number];

export type SquareInvoiceWebhookParseSkipReason =
  | "unsupported_event_type"
  | "malformed_payload"
  | "missing_invoice"
  | "missing_invoice_id"
  | "missing_subscription_id";

/**
 * Fields extracted from an invoice webhook when both invoice id and
 * subscription id are present (minimum for a later persistable invoice DTO).
 * Does not include billing_cycle / plan variation / period bounds.
 */
export type SquareInvoiceWebhookPersistableFields = {
  eventId: string | null;
  eventType: SquareInvoiceWebhookEventType;
  squareInvoiceId: string;
  squareOrderId: string | null;
  squareSubscriptionId: string;
  squareCustomerId: string | null;
  squareLocationId: string | null;
  squareInvoiceVersion: number | null;
  squareInvoiceStatus: string | null;
  amountUsd: number | null;
  currency: string | null;
  dueDate: string | null;
  paidAt: string | null;
  occurredAt: string | null;
};

export type SquareInvoiceWebhookParseResult =
  | {
      status: "persistable";
      fields: SquareInvoiceWebhookPersistableFields;
    }
  | {
      status: "skipped";
      reason: SquareInvoiceWebhookParseSkipReason;
      eventId: string | null;
      eventType: string | null;
    };

const SUPPORTED = new Set<string>(SQUARE_INVOICE_WEBHOOK_EVENT_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function firstString(
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const found = stringValue(record[key]);
    if (found) return found;
  }
  return null;
}

function versionValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function centsToUsd(value: unknown): number | null {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount / 100;
}

function moneyFromRequest(
  request: Record<string, unknown>,
): { amountUsd: number; currency: string } | null {
  const computed =
    (isRecord(request.computed_amount_money)
      ? request.computed_amount_money
      : null) ??
    (isRecord(request.computedAmountMoney)
      ? request.computedAmountMoney
      : null);

  if (!computed) return null;
  const amountUsd = centsToUsd(computed.amount);
  const currency = stringValue(computed.currency);
  if (amountUsd === null || !currency) return null;
  return { amountUsd, currency };
}

/**
 * Extract amount/currency from payment_requests.
 * - 0 usable requests → nulls
 * - 1 usable → that amount
 * - multiple usable with identical amount+currency → that amount
 * - multiple usable with differing amounts → nulls (ambiguous; no guess)
 */
export function extractInvoicePaymentRequestMoney(invoice: Record<string, unknown>): {
  amountUsd: number | null;
  currency: string | null;
  dueDate: string | null;
} {
  const raw =
    invoice.payment_requests ?? invoice.paymentRequests ?? null;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { amountUsd: null, currency: null, dueDate: null };
  }

  const parsed: Array<{
    amountUsd: number;
    currency: string;
    dueDate: string | null;
  }> = [];

  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const money = moneyFromRequest(entry);
    if (!money) continue;
    parsed.push({
      ...money,
      dueDate:
        firstString(entry, "due_date", "dueDate") ?? null,
    });
  }

  if (parsed.length === 0) {
    return { amountUsd: null, currency: null, dueDate: null };
  }

  const dueDate =
    parsed.map((row) => row.dueDate).find((value) => value !== null) ?? null;

  if (parsed.length === 1) {
    return {
      amountUsd: parsed[0]!.amountUsd,
      currency: parsed[0]!.currency,
      dueDate: parsed[0]!.dueDate ?? dueDate,
    };
  }

  const first = parsed[0]!;
  const allSame = parsed.every(
    (row) =>
      row.amountUsd === first.amountUsd && row.currency === first.currency,
  );
  if (!allSame) {
    return { amountUsd: null, currency: null, dueDate };
  }

  return {
    amountUsd: first.amountUsd,
    currency: first.currency,
    dueDate,
  };
}

function resolvePaidAt(input: {
  eventType: SquareInvoiceWebhookEventType;
  status: string | null;
  invoiceUpdatedAt: string | null;
  occurredAt: string | null;
}): string | null {
  const status = input.status?.trim().toUpperCase() ?? "";
  // Only invoice.payment_made + PAID is treated as a defensible paid timestamp.
  if (input.eventType !== "invoice.payment_made") return null;
  if (status !== "PAID") return null;
  return input.invoiceUpdatedAt ?? input.occurredAt;
}

function locateInvoiceObject(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const data = isRecord(payload.data) ? payload.data : null;
  const object = data && isRecord(data.object) ? data.object : null;
  if (object && isRecord(object.invoice)) return object.invoice;
  // Some payloads nest invoice directly under data.object
  if (object && stringValue(object.id) && stringValue(object.status)) {
    return object;
  }
  return null;
}

function skipped(
  reason: SquareInvoiceWebhookParseSkipReason,
  eventId: string | null,
  eventType: string | null,
): SquareInvoiceWebhookParseResult {
  return { status: "skipped", reason, eventId, eventType };
}

/**
 * Parse a Square invoice webhook JSON string or already-decoded object.
 * Never throws for malformed input — returns skipped.
 */
export function parseSquareInvoiceWebhook(
  raw: unknown,
): SquareInvoiceWebhookParseResult {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return skipped("malformed_payload", null, null);
    }
  }

  if (!isRecord(payload)) {
    return skipped("malformed_payload", null, null);
  }

  const eventId =
    firstString(payload, "event_id", "eventId") ?? null;
  const eventTypeRaw =
    firstString(payload, "type")?.toLowerCase() ?? null;

  if (!eventTypeRaw || !SUPPORTED.has(eventTypeRaw)) {
    return skipped("unsupported_event_type", eventId, eventTypeRaw);
  }

  const eventType = eventTypeRaw as SquareInvoiceWebhookEventType;
  const invoice = locateInvoiceObject(payload);
  if (!invoice) {
    return skipped("missing_invoice", eventId, eventType);
  }

  const squareInvoiceId =
    firstString(invoice, "id") ??
    firstString(isRecord(payload.data) ? payload.data : null, "id");
  if (!squareInvoiceId) {
    return skipped("missing_invoice_id", eventId, eventType);
  }

  const squareSubscriptionId = firstString(
    invoice,
    "subscription_id",
    "subscriptionId",
  );
  if (!squareSubscriptionId) {
    return skipped("missing_subscription_id", eventId, eventType);
  }

  const recipient = isRecord(invoice.primary_recipient)
    ? invoice.primary_recipient
    : isRecord(invoice.primaryRecipient)
      ? invoice.primaryRecipient
      : null;

  const squareLocationId =
    firstString(invoice, "location_id", "locationId") ??
    firstString(payload, "location_id", "locationId");

  const squareInvoiceStatus = firstString(invoice, "status");
  const occurredAt =
    firstString(payload, "created_at", "createdAt") ??
    firstString(invoice, "created_at", "createdAt");
  const invoiceUpdatedAt = firstString(invoice, "updated_at", "updatedAt");
  const money = extractInvoicePaymentRequestMoney(invoice);

  const fields: SquareInvoiceWebhookPersistableFields = {
    eventId,
    eventType,
    squareInvoiceId,
    squareOrderId: firstString(invoice, "order_id", "orderId"),
    squareSubscriptionId,
    squareCustomerId: firstString(recipient, "customer_id", "customerId"),
    squareLocationId,
    squareInvoiceVersion: versionValue(
      invoice.version ?? invoice.invoice_version ?? invoice.invoiceVersion,
    ),
    squareInvoiceStatus,
    amountUsd: money.amountUsd,
    currency: money.currency,
    dueDate: money.dueDate,
    paidAt: resolvePaidAt({
      eventType,
      status: squareInvoiceStatus,
      invoiceUpdatedAt,
      occurredAt,
    }),
    occurredAt,
  };

  return { status: "persistable", fields };
}

/** True when parse result has both ids required for a later subscription-invoice DTO. */
export function isPersistableSquareInvoiceWebhook(
  result: SquareInvoiceWebhookParseResult,
): result is Extract<SquareInvoiceWebhookParseResult, { status: "persistable" }> {
  return result.status === "persistable";
}
