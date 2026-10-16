import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Stripe from "stripe";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  createStripeSandboxCorrelationStore,
  extractStripeSandboxCheckoutSession,
  extractStripeSandboxInvoice,
  stripeSandboxObjectId,
} = await import("./stripe-sandbox-correlation.ts");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function expandedSubscription(id: string): Stripe.Subscription {
  return { id, object: "subscription" } as Stripe.Subscription;
}

function invoiceWithSubscription(
  invoiceId: string,
  subscription: string | Stripe.Subscription | null,
  extra: Record<string, unknown> = {},
): Stripe.Invoice {
  const subscriptionDetails =
    subscription === null
      ? null
      : {
          metadata: null,
          subscription,
        };
  return {
    id: invoiceId,
    object: "invoice",
    customer: extra.customer ?? "cus_unrelated_sandbox",
    customer_email: extra.customer_email ?? "sandbox-unrelated@example.test",
    metadata: extra.metadata ?? { supabase_user_id: extra.userId ?? "not-a-local-checkout" },
    parent:
      subscription === null && extra.forceNullParent
        ? null
        : {
            quote_details: null,
            subscription_details: subscriptionDetails,
            type: subscription === null ? "quote_details" : "subscription_details",
          },
  } as Stripe.Invoice;
}

function checkoutSession(input: {
  id: string;
  clientReferenceId: string | null;
  subscription: string | Stripe.Subscription | null;
  customer?: string;
  customerEmail?: string;
  metadata?: Stripe.Metadata;
}): Stripe.Checkout.Session {
  return {
    id: input.id,
    object: "checkout.session",
    client_reference_id: input.clientReferenceId,
    subscription: input.subscription,
    customer: input.customer ?? "cus_unrelated_sandbox",
    customer_email: input.customerEmail ?? "sandbox-unrelated@example.test",
    metadata: input.metadata ?? { supabase_user_id: "not-a-local-checkout" },
  } as Stripe.Checkout.Session;
}

function runStripeSandboxCorrelationTests() {
  assert(stripeSandboxObjectId(" sub_string ") === "sub_string", "string ids trim");
  assert(stripeSandboxObjectId(null) === null, "null ids");
  assert(stripeSandboxObjectId({ id: "sub_expanded" }) === "sub_expanded", "expanded ids");
  assert(stripeSandboxObjectId({ id: "  " }) === null, "blank expanded ids");

  const stringInvoice = invoiceWithSubscription("in_sub_string", "sub_from_string");
  assert(
    extractStripeSandboxInvoice(stringInvoice).subscriptionId === "sub_from_string" &&
      extractStripeSandboxInvoice(stringInvoice).invoiceId === "in_sub_string",
    "invoice subscription string lives under parent.subscription_details",
  );
  assert(
    extractStripeSandboxInvoice(stringInvoice).subscriptionId !==
      (stringInvoice as { subscription?: unknown }).subscription,
    "invoice.subscription is not the correlation path",
  );

  const expandedInvoice = invoiceWithSubscription(
    "in_sub_object",
    expandedSubscription("sub_from_object"),
  );
  assert(
    extractStripeSandboxInvoice(expandedInvoice).subscriptionId === "sub_from_object",
    "expanded invoice.parent.subscription_details.subscription is accepted",
  );

  const orphanInvoice = invoiceWithSubscription("in_manual", null, { forceNullParent: true });
  assert(
    extractStripeSandboxInvoice(orphanInvoice).subscriptionId === null &&
      extractStripeSandboxInvoice(orphanInvoice).invoiceId === "in_manual",
    "an invoice without parent has no subscription reference",
  );

  const session = checkoutSession({
    id: "cs_test_extract",
    clientReferenceId: "11111111-1111-4111-8111-111111111111",
    subscription: expandedSubscription("sub_session_object"),
  });
  const extractedSession = extractStripeSandboxCheckoutSession(session);
  assert(
    extractedSession.sessionId === "cs_test_extract" &&
      extractedSession.clientReferenceId ===
        "11111111-1111-4111-8111-111111111111" &&
      extractedSession.subscriptionId === "sub_session_object",
    "checkout session ids come from id, client_reference_id, and subscription",
  );

  const store = createStripeSandboxCorrelationStore();
  const checkoutId = "22222222-2222-4222-8222-222222222222";
  const userId = "33333333-3333-4333-8333-333333333333";
  store.registerLocalCheckout({
    id: checkoutId,
    userId,
    stripeSessionId: null,
    stripeSubscriptionId: null,
  });

  const baitInvoice = invoiceWithSubscription("in_bait", "sub_unknown", {
    customer: "cus_same_user",
    customer_email: "host@example.test",
    userId,
  });
  const bait = store.ingest({
    eventId: "evt_bait",
    payloadSha256: sha256("bait"),
    type: "invoice.paid",
    invoice: baitInvoice,
  });
  assert(
    bait.status === "awaiting_correlation" &&
      bait.appliedInvoiceIds.length === 0 &&
      store.checkout(checkoutId)?.stripeSubscriptionId === null,
    "customer, email, and user metadata do not correlate invoice.paid",
  );

  const unrelated = store.ingest({
    eventId: "evt_manual",
    payloadSha256: sha256("manual"),
    type: "invoice.paid",
    invoice: orphanInvoice,
  });
  assert(
    unrelated.status === "unrelated" && unrelated.appliedInvoiceIds.length === 0,
    "an invoice without a subscription reference is unrelated",
  );

  const earlyInvoice = store.ingest({
    eventId: "evt_invoice_first",
    payloadSha256: sha256("invoice-first"),
    type: "invoice.paid",
    invoice: invoiceWithSubscription("in_order", "sub_order", { userId }),
  });
  assert(
    earlyInvoice.status === "awaiting_correlation" &&
      store.event("evt_invoice_first")?.status === "awaiting_correlation",
    "subscription invoice.paid waits when no local subscription link exists",
  );

  const completed = store.ingest({
    eventId: "evt_checkout_later",
    payloadSha256: sha256("checkout-later"),
    type: "checkout.session.completed",
    session: checkoutSession({
      id: "cs_test_order",
      clientReferenceId: checkoutId,
      subscription: "sub_order",
      customer: "cus_same_user",
      customerEmail: "host@example.test",
      metadata: { supabase_user_id: userId },
    }),
  });
  assert(
    completed.status === "applied" &&
      completed.checkoutId === checkoutId &&
      store.checkout(checkoutId)?.stripeSessionId === "cs_test_order" &&
      store.checkout(checkoutId)?.stripeSubscriptionId === "sub_order" &&
      store.event("evt_invoice_first")?.status === "applied" &&
      store.appliedInvoiceIds().length === 1 &&
      store.appliedInvoiceIds()[0] === "in_order",
    "checkout.session.completed against the local record reprocesses awaiting invoices",
  );

  const replay = store.ingest({
    eventId: "evt_invoice_first",
    payloadSha256: sha256("invoice-first"),
    type: "invoice.paid",
    invoice: invoiceWithSubscription("in_order", "sub_order"),
  });
  assert(
    replay.status === "replayed" &&
      store.event("evt_invoice_first")?.status === "applied" &&
      store.appliedInvoiceIds().length === 1,
    "the same event id and hash replay without a second application",
  );

  const hashConflict = store.ingest({
    eventId: "evt_invoice_first",
    payloadSha256: sha256("invoice-first-altered"),
    type: "invoice.paid",
    invoice: invoiceWithSubscription("in_order", "sub_order"),
  });
  assert(
    hashConflict.status === "conflict" &&
      store.event("evt_invoice_first")?.payloadSha256 === sha256("invoice-first") &&
      store.appliedInvoiceIds().length === 1,
    "the same event id with a different hash conflicts and keeps the original application",
  );

  const duplicateInvoice = store.ingest({
    eventId: "evt_invoice_duplicate",
    payloadSha256: sha256("invoice-duplicate"),
    type: "invoice.paid",
    invoice: invoiceWithSubscription("in_order", "sub_order"),
  });
  assert(
    duplicateInvoice.status === "duplicate_invoice" &&
      store.appliedInvoiceIds().length === 1 &&
      store.event("evt_invoice_duplicate")?.status === "duplicate_invoice",
    "a second event for the same invoice does not apply again",
  );

  const persistLater = createStripeSandboxCorrelationStore();
  const pendingInvoice = persistLater.ingest({
    eventId: "evt_before_persist",
    payloadSha256: sha256("before-persist"),
    type: "invoice.paid",
    invoice: invoiceWithSubscription(
      "in_before_persist",
      expandedSubscription("sub_before_persist"),
    ),
  });
  const pendingCheckout = persistLater.ingest({
    eventId: "evt_session_before_persist",
    payloadSha256: sha256("session-before-persist"),
    type: "checkout.session.completed",
    session: checkoutSession({
      id: "cs_test_before_persist",
      clientReferenceId: "44444444-4444-4444-8444-444444444444",
      subscription: expandedSubscription("sub_before_persist"),
    }),
  });
  assert(
    pendingInvoice.status === "awaiting_correlation" &&
      pendingCheckout.status === "awaiting_correlation" &&
      persistLater.appliedInvoiceIds().length === 0,
    "events that arrive before the local Checkout row stay awaiting_correlation",
  );
  persistLater.registerLocalCheckout({
    id: "44444444-4444-4444-8444-444444444444",
    userId: "55555555-5555-4555-8555-555555555555",
    stripeSessionId: null,
    stripeSubscriptionId: null,
  });
  assert(
    persistLater.event("evt_session_before_persist")?.status === "applied" &&
      persistLater.event("evt_before_persist")?.status === "applied" &&
      persistLater.appliedInvoiceIds().join(",") === "in_before_persist" &&
      persistLater.checkout("44444444-4444-4444-8444-444444444444")
        ?.stripeSubscriptionId === "sub_before_persist",
    "persisting the authenticated Checkout row reprocesses awaiting events, including expanded references",
  );

  const conflictStore = createStripeSandboxCorrelationStore();
  conflictStore.registerLocalCheckout({
    id: "aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1",
    userId: "bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1",
    stripeSessionId: "cs_test_a",
    stripeSubscriptionId: null,
  });
  conflictStore.registerLocalCheckout({
    id: "aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2",
    userId: "bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2",
    stripeSessionId: "cs_test_b",
    stripeSubscriptionId: "sub_b",
  });
  const conflict = conflictStore.ingest({
    eventId: "evt_conflict",
    payloadSha256: sha256("conflict"),
    type: "checkout.session.completed",
    session: checkoutSession({
      id: "cs_test_b",
      clientReferenceId: "aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1",
      subscription: "sub_b",
    }),
  });
  assert(
    conflict.status === "conflict" &&
      conflictStore.checkout("aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1")
        ?.stripeSubscriptionId === null &&
      conflictStore.checkout("aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2")
        ?.stripeSessionId === "cs_test_b" &&
      conflictStore.appliedInvoiceIds().length === 0,
    "identifiers that point at different local records conflict without applying",
  );

  const twoAwaitingSameInvoice = createStripeSandboxCorrelationStore();
  twoAwaitingSameInvoice.registerLocalCheckout({
    id: "66666666-6666-4666-8666-666666666666",
    userId: "77777777-7777-4777-8777-777777777777",
    stripeSessionId: null,
    stripeSubscriptionId: null,
  });
  twoAwaitingSameInvoice.ingest({
    eventId: "evt_same_invoice_a",
    payloadSha256: sha256("same-invoice-a"),
    type: "invoice.paid",
    invoice: invoiceWithSubscription("in_shared", "sub_shared"),
  });
  twoAwaitingSameInvoice.ingest({
    eventId: "evt_same_invoice_b",
    payloadSha256: sha256("same-invoice-b"),
    type: "invoice.paid",
    invoice: invoiceWithSubscription("in_shared", "sub_shared"),
  });
  twoAwaitingSameInvoice.ingest({
    eventId: "evt_link_shared",
    payloadSha256: sha256("link-shared"),
    type: "checkout.session.completed",
    session: checkoutSession({
      id: "cs_test_shared",
      clientReferenceId: "66666666-6666-4666-8666-666666666666",
      subscription: expandedSubscription("sub_shared"),
    }),
  });
  const statuses = [
    twoAwaitingSameInvoice.event("evt_same_invoice_a")?.status,
    twoAwaitingSameInvoice.event("evt_same_invoice_b")?.status,
  ].sort();
  assert(
    twoAwaitingSameInvoice.appliedInvoiceIds().join(",") === "in_shared" &&
      statuses.includes("applied") &&
      statuses.includes("duplicate_invoice"),
    "two awaiting events for one invoice yield a single logical application",
  );

  const source = readFileSync(
    join(process.cwd(), "src/lib/stripe-sandbox-correlation.ts"),
    "utf8",
  );
  assert(
    source.includes("parent") &&
      source.includes("subscription_details") &&
      source.includes("client_reference_id") &&
      !source.includes("process.env") &&
      !source.includes("console.") &&
      !source.includes("supabase") &&
      !source.includes("from \"square\"") &&
      !source.includes("from \"stripe\"") &&
      !source.includes("fetch("),
    "correlation stays a pure local matcher",
  );

  console.log("Stripe Sandbox correlation tests passed");
}

runStripeSandboxCorrelationTests();
