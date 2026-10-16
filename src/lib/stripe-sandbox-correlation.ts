/**
 * In-memory Stripe Sandbox correlation.
 * Matches webhook objects only to local Checkout records created for an
 * authenticated user. Does not grant access, write billing tables, or call
 * Stripe or Supabase.
 */

export const STRIPE_SANDBOX_CORRELATION_EVENT_TYPES = [
  "checkout.session.completed",
  "invoice.paid",
] as const;

export type StripeSandboxCorrelationEventType =
  (typeof STRIPE_SANDBOX_CORRELATION_EVENT_TYPES)[number];

export type StripeSandboxCorrelationStatus =
  | "applied"
  | "awaiting_correlation"
  | "unrelated"
  | "replayed"
  | "conflict"
  | "duplicate_invoice";

export type StripeSandboxCheckoutSessionExtract = {
  sessionId: string | null;
  clientReferenceId: string | null;
  subscriptionId: string | null;
};

export type StripeSandboxInvoiceExtract = {
  invoiceId: string | null;
  subscriptionId: string | null;
};

export type StripeSandboxLocalCheckoutRecord = {
  id: string;
  userId: string;
  stripeSessionId: string | null;
  stripeSubscriptionId: string | null;
};

export type StripeSandboxCorrelatedEvent = {
  eventId: string;
  payloadSha256: string;
  type: StripeSandboxCorrelationEventType;
  status: Exclude<StripeSandboxCorrelationStatus, "replayed">;
  invoiceId: string | null;
  checkoutId: string | null;
  subscriptionId: string | null;
  sessionId: string | null;
  clientReferenceId: string | null;
};

export type StripeSandboxCorrelationResult = {
  status: StripeSandboxCorrelationStatus;
  eventId: string;
  checkoutId: string | null;
  invoiceId: string | null;
  appliedInvoiceIds: readonly string[];
};

export type StripeSandboxCorrelationEventInput = {
  eventId: string;
  payloadSha256: string;
  type: StripeSandboxCorrelationEventType;
  invoice?: unknown;
  session?: unknown;
};

export type StripeSandboxCorrelationStore = {
  registerLocalCheckout(record: StripeSandboxLocalCheckoutRecord): StripeSandboxCorrelationResult;
  ingest(input: StripeSandboxCorrelationEventInput): StripeSandboxCorrelationResult;
  event(eventId: string): StripeSandboxCorrelatedEvent | null;
  checkout(id: string): StripeSandboxLocalCheckoutRecord | null;
  appliedInvoiceIds(): readonly string[];
};

type MutableCheckout = {
  id: string;
  userId: string;
  stripeSessionId: string | null;
  stripeSubscriptionId: string | null;
};

function nonemptyId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Stripe object ids appear as a string or an expanded `{ id }` object.
 */
export function stripeSandboxObjectId(value: unknown): string | null {
  const direct = nonemptyId(value);
  if (direct) return direct;
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;
  return nonemptyId((value as { id?: unknown }).id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractStripeSandboxCheckoutSession(
  session: unknown,
): StripeSandboxCheckoutSessionExtract {
  if (!isRecord(session)) {
    return { sessionId: null, clientReferenceId: null, subscriptionId: null };
  }
  return {
    sessionId: stripeSandboxObjectId(session.id),
    clientReferenceId: nonemptyId(session.client_reference_id),
    subscriptionId: stripeSandboxObjectId(session.subscription),
  };
}

export function extractStripeSandboxInvoice(
  invoice: unknown,
): StripeSandboxInvoiceExtract {
  if (!isRecord(invoice)) {
    return { invoiceId: null, subscriptionId: null };
  }
  const parent = isRecord(invoice.parent) ? invoice.parent : null;
  const details = parent && isRecord(parent.subscription_details)
    ? parent.subscription_details
    : null;
  return {
    invoiceId: stripeSandboxObjectId(invoice.id),
    subscriptionId: details ? stripeSandboxObjectId(details.subscription) : null,
  };
}

function cloneCheckout(row: MutableCheckout): StripeSandboxLocalCheckoutRecord {
  return {
    id: row.id,
    userId: row.userId,
    stripeSessionId: row.stripeSessionId,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
}

function snapshotResult(
  status: StripeSandboxCorrelationStatus,
  eventId: string,
  event: StripeSandboxCorrelatedEvent | null,
  appliedInvoiceIds: readonly string[],
): StripeSandboxCorrelationResult {
  return {
    status,
    eventId,
    checkoutId: event?.checkoutId ?? null,
    invoiceId: event?.invoiceId ?? null,
    appliedInvoiceIds,
  };
}

export function createStripeSandboxCorrelationStore(): StripeSandboxCorrelationStore {
  const checkouts = new Map<string, MutableCheckout>();
  const events = new Map<string, StripeSandboxCorrelatedEvent>();
  const invoiceOwner = new Map<string, string>();
  const awaiting = new Set<string>();
  let reprocessing = false;

  function appliedInvoiceIds(): string[] {
    return [...invoiceOwner.keys()];
  }

  function result(
    status: StripeSandboxCorrelationStatus,
    eventId: string,
    event: StripeSandboxCorrelatedEvent | null = events.get(eventId) ?? null,
  ): StripeSandboxCorrelationResult {
    return snapshotResult(status, eventId, event, appliedInvoiceIds());
  }

  function checkoutById(id: string | null): MutableCheckout | null {
    if (!id) return null;
    return checkouts.get(id) ?? null;
  }

  function checkoutBySessionId(sessionId: string | null): MutableCheckout | null {
    if (!sessionId) return null;
    for (const row of checkouts.values()) {
      if (row.stripeSessionId === sessionId) return row;
    }
    return null;
  }

  function checkoutsBySubscriptionId(subscriptionId: string | null): MutableCheckout[] {
    if (!subscriptionId) return [];
    const matches: MutableCheckout[] = [];
    for (const row of checkouts.values()) {
      if (row.stripeSubscriptionId === subscriptionId) matches.push(row);
    }
    return matches;
  }

  function uniqueCheckout(
    candidates: Array<MutableCheckout | null>,
  ): MutableCheckout | "none" | "conflict" {
    const found = new Map<string, MutableCheckout>();
    for (const row of candidates) {
      if (!row) continue;
      found.set(row.id, row);
    }
    if (found.size === 0) return "none";
    if (found.size > 1) return "conflict";
    return [...found.values()][0]!;
  }

  function markEvent(
    event: StripeSandboxCorrelatedEvent,
    status: StripeSandboxCorrelatedEvent["status"],
    checkoutId: string | null = event.checkoutId,
  ) {
    event.status = status;
    event.checkoutId = checkoutId;
    if (status === "awaiting_correlation") awaiting.add(event.eventId);
    else awaiting.delete(event.eventId);
  }

  function applyInvoice(
    event: StripeSandboxCorrelatedEvent,
    checkout: MutableCheckout,
  ): StripeSandboxCorrelationStatus {
    const invoiceId = event.invoiceId;
    if (!invoiceId) {
      markEvent(event, "unrelated", null);
      return "unrelated";
    }
    const existing = invoiceOwner.get(invoiceId);
    if (existing && existing !== event.eventId) {
      markEvent(event, "duplicate_invoice", checkout.id);
      return "duplicate_invoice";
    }
    invoiceOwner.set(invoiceId, event.eventId);
    markEvent(event, "applied", checkout.id);
    return "applied";
  }

  function attachCheckoutIdentifiers(
    checkout: MutableCheckout,
    sessionId: string | null,
    subscriptionId: string | null,
  ): boolean {
    if (
      sessionId &&
      checkout.stripeSessionId &&
      checkout.stripeSessionId !== sessionId
    ) {
      return false;
    }
    if (
      subscriptionId &&
      checkout.stripeSubscriptionId &&
      checkout.stripeSubscriptionId !== subscriptionId
    ) {
      return false;
    }
    if (sessionId) checkout.stripeSessionId = sessionId;
    if (subscriptionId) checkout.stripeSubscriptionId = subscriptionId;
    return true;
  }

  function correlateInvoice(event: StripeSandboxCorrelatedEvent): StripeSandboxCorrelationStatus {
    if (!event.subscriptionId) {
      markEvent(event, "unrelated", null);
      return "unrelated";
    }
    const matches = checkoutsBySubscriptionId(event.subscriptionId);
    if (matches.length > 1) {
      markEvent(event, "conflict", null);
      return "conflict";
    }
    if (matches.length === 0) {
      markEvent(event, "awaiting_correlation", null);
      return "awaiting_correlation";
    }
    return applyInvoice(event, matches[0]!);
  }

  function correlateCheckoutSession(
    event: StripeSandboxCorrelatedEvent,
  ): StripeSandboxCorrelationStatus {
    const byReference = checkoutById(event.clientReferenceId);
    const bySession = checkoutBySessionId(event.sessionId);
    const bySubscription = checkoutsBySubscriptionId(event.subscriptionId);
    if (bySubscription.length > 1) {
      markEvent(event, "conflict", null);
      return "conflict";
    }
    const resolved = uniqueCheckout([
      byReference,
      bySession,
      bySubscription[0] ?? null,
    ]);
    if (resolved === "conflict") {
      markEvent(event, "conflict", null);
      return "conflict";
    }
    if (resolved === "none") {
      markEvent(event, "awaiting_correlation", null);
      return "awaiting_correlation";
    }
    if (!attachCheckoutIdentifiers(resolved, event.sessionId, event.subscriptionId)) {
      markEvent(event, "conflict", null);
      return "conflict";
    }
    markEvent(event, "applied", resolved.id);
    reprocessAwaiting();
    return "applied";
  }

  function reprocessAwaiting() {
    if (reprocessing) return;
    reprocessing = true;
    try {
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const eventId of [...awaiting]) {
          const event = events.get(eventId);
          if (!event || event.status !== "awaiting_correlation") continue;
          const before = event.status;
          if (event.type === "invoice.paid") correlateInvoice(event);
          else correlateCheckoutSession(event);
          if (event.status !== before) progressed = true;
        }
      }
    } finally {
      reprocessing = false;
    }
  }

  return {
    registerLocalCheckout(record) {
      const id = nonemptyId(record.id);
      const userId = nonemptyId(record.userId);
      if (!id || !userId) {
        return {
          status: "conflict",
          eventId: "",
          checkoutId: null,
          invoiceId: null,
          appliedInvoiceIds: appliedInvoiceIds(),
        };
      }
      const existing = checkouts.get(id);
      const next: MutableCheckout = {
        id,
        userId,
        stripeSessionId: nonemptyId(record.stripeSessionId),
        stripeSubscriptionId: nonemptyId(record.stripeSubscriptionId),
      };
      if (existing) {
        if (existing.userId !== next.userId) {
          return {
            status: "conflict",
            eventId: "",
            checkoutId: existing.id,
            invoiceId: null,
            appliedInvoiceIds: appliedInvoiceIds(),
          };
        }
        if (!attachCheckoutIdentifiers(existing, next.stripeSessionId, next.stripeSubscriptionId)) {
          return {
            status: "conflict",
            eventId: "",
            checkoutId: existing.id,
            invoiceId: null,
            appliedInvoiceIds: appliedInvoiceIds(),
          };
        }
      } else {
        checkouts.set(id, next);
      }
      reprocessAwaiting();
      const checkout = checkouts.get(id)!;
      return {
        status: "applied",
        eventId: "",
        checkoutId: checkout.id,
        invoiceId: null,
        appliedInvoiceIds: appliedInvoiceIds(),
      };
    },

    ingest(input) {
      const eventId = nonemptyId(input.eventId);
      const payloadSha256 = nonemptyId(input.payloadSha256);
      if (!eventId || !payloadSha256) {
        return {
          status: "conflict",
          eventId: eventId ?? "",
          checkoutId: null,
          invoiceId: null,
          appliedInvoiceIds: appliedInvoiceIds(),
        };
      }

      const existing = events.get(eventId);
      if (existing) {
        if (existing.payloadSha256 === payloadSha256) {
          return result("replayed", eventId, existing);
        }
        return result("conflict", eventId, existing);
      }

      const invoice = extractStripeSandboxInvoice(input.invoice);
      const session = extractStripeSandboxCheckoutSession(input.session);
      const event: StripeSandboxCorrelatedEvent = {
        eventId,
        payloadSha256,
        type: input.type,
        status: "awaiting_correlation",
        invoiceId: input.type === "invoice.paid" ? invoice.invoiceId : null,
        checkoutId: null,
        subscriptionId:
          input.type === "invoice.paid" ? invoice.subscriptionId : session.subscriptionId,
        sessionId: input.type === "checkout.session.completed" ? session.sessionId : null,
        clientReferenceId:
          input.type === "checkout.session.completed" ? session.clientReferenceId : null,
      };
      events.set(eventId, event);

      if (input.type === "invoice.paid") {
        const status = correlateInvoice(event);
        return result(status, eventId, event);
      }

      const status = correlateCheckoutSession(event);
      return result(status, eventId, event);
    },

    event(eventId) {
      const row = events.get(eventId);
      return row ? { ...row } : null;
    },

    checkout(id) {
      const row = checkouts.get(id);
      return row ? cloneCheckout(row) : null;
    },

    appliedInvoiceIds,
  };
}
