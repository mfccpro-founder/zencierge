import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  enrichSubscriptionPaymentSquareCorrelation,
  type SquarePaymentEnrichmentAdminClient,
  type SquarePaymentEnrichmentInput,
} from "./square-payment-enrichment";
import {
  classifySquarePaymentStatus,
  handleSquareWebhook,
  parseSquarePaymentCorrelationIds,
  type SquareWebhookConfig,
} from "./square-webhook";
import type { ProviderSubscriptionWebhookInput } from "./subscription-webhooks";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const CONFIG = {
  ready: true,
  signatureKey: "test-signature-key",
  notificationUrl: "https://example.com/api/webhooks/square",
} satisfies SquareWebhookConfig;

function paymentBody(
  status: string,
  extras: Record<string, unknown> = {},
  eventId: unknown = "square-event-1",
) {
  return JSON.stringify({
    event_id: eventId,
    type: "payment.updated",
    data: {
      object: {
        payment: {
          id: "square-payment-1",
          status,
          amount_money: { amount: 9900, currency: "USD" },
          buyer_email_address: "host@example.com",
          customer_id: "square-customer-1",
          created_at: "2026-09-07T12:00:00.000Z",
          ...extras,
        },
      },
    },
  });
}

type PaymentRow = {
  provider_payment_id: string;
  square_order_id: string | null;
  square_location_id: string | null;
  square_environment: string | null;
  square_invoice_id: string | null;
  square_subscription_id: string | null;
  billing_cycle: string | null;
};

function createFakeAdmin(options: {
  rows?: PaymentRow[];
  selectError?: boolean;
  updateError?: boolean;
  onUpdate?: (patch: Record<string, string>, providerPaymentId: string) => void;
}): SquarePaymentEnrichmentAdminClient {
  const rows = options.rows ?? [];
  return {
    from(table: string) {
      assert(table === "subscription_payments", "only subscription_payments");
      return {
        select(columns: string) {
          assert(
            columns.includes("square_order_id"),
            "select includes correlation columns",
          );
          return {
            eq(column: string, value: string) {
              assert(column === "provider_payment_id", "select by payment id");
              return {
                async maybeSingle() {
                  if (options.selectError) {
                    return {
                      data: null,
                      error: { message: "select failed; secret=abc" },
                    };
                  }
                  const row =
                    rows.find((entry) => entry.provider_payment_id === value) ??
                    null;
                  return {
                    data: row ? { ...row } : null,
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(values: Record<string, string>) {
          return {
            async eq(column: string, value: string) {
              assert(column === "provider_payment_id", "update by payment id");
              if (options.updateError) {
                return { error: { message: "update failed; token=xyz" } };
              }
              const row = rows.find(
                (entry) => entry.provider_payment_id === value,
              );
              if (row) {
                Object.assign(row, values);
              }
              options.onUpdate?.(values, value);
              return { error: null };
            },
          };
        },
      };
    },
  };
}

async function runSquarePaymentEnrichmentTests() {
  // --- parser: snake_case / camelCase / absent ---
  {
    const snake = parseSquarePaymentCorrelationIds({
      order_id: " ORD_SNAKE ",
      location_id: " LOC_SNAKE ",
    });
    assert(snake.squareOrderId === "ORD_SNAKE", "snake_case order_id parsed");
    assert(
      snake.squareLocationId === "LOC_SNAKE",
      "snake_case location_id parsed",
    );

    const camel = parseSquarePaymentCorrelationIds({
      orderId: "ORD_CAMEL",
      locationId: "LOC_CAMEL",
    });
    assert(camel.squareOrderId === "ORD_CAMEL", "camelCase orderId parsed");
    assert(
      camel.squareLocationId === "LOC_CAMEL",
      "camelCase locationId parsed",
    );

    const absent = parseSquarePaymentCorrelationIds({
      id: "pay-1",
      customer_id: "cust-1",
    });
    assert(absent.squareOrderId === null, "absent order id remains null");
    assert(absent.squareLocationId === null, "absent location id remains null");

    const blank = parseSquarePaymentCorrelationIds({
      order_id: "   ",
      locationId: "",
    });
    assert(blank.squareOrderId === null, "blank order id remains null");
    assert(blank.squareLocationId === null, "blank location id remains null");
  }

  // --- classification unchanged ---
  assert(
    classifySquarePaymentStatus("COMPLETED") === "succeeded",
    "COMPLETED still succeeds",
  );
  assert(
    classifySquarePaymentStatus("FAILED") === "failed",
    "FAILED still fails",
  );
  assert(
    classifySquarePaymentStatus("PENDING") === "ignored",
    "PENDING still ignored",
  );

  // --- webhook still applies succeeded/failed; enrichment after apply ---
  {
    const applied: ProviderSubscriptionWebhookInput[] = [];
    const enrichments: SquarePaymentEnrichmentInput[] = [];
    let applyOrder = 0;
    let enrichOrder = 0;
    const result = await handleSquareWebhook({
      rawBody: paymentBody("COMPLETED", {
        order_id: "ORD_1",
        location_id: "LOC_1",
      }),
      signatureHeader: "valid",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async (event) => {
        applyOrder = 1;
        applied.push(event);
      },
      enrichPaymentCorrelation: async (input) => {
        assert(applyOrder === 1, "enrichment runs after applyEvent");
        enrichOrder = 2;
        enrichments.push(input);
      },
    });
    assert(result.status === 200, "successful payment flow still works");
    assert(applied.length === 1, "succeeded event applied once");
    assert(
      applied[0]?.type === "payment.succeeded",
      "existing webhook classification unchanged (succeeded)",
    );
    assert(
      applied[0]?.paymentId === "square-payment-1",
      "payment id still applied",
    );
    assert(
      applied[0]?.squareCustomerId === "square-customer-1",
      "customer id still applied",
    );
    assert(enrichOrder === 2, "enrichment invoked");
    assert(enrichments.length === 1, "enrichment once");
    assert(
      enrichments[0]?.providerPaymentId === "square-payment-1",
      "enrichment keyed by provider payment id",
    );
    assert(enrichments[0]?.squareOrderId === "ORD_1", "order id forwarded");
    assert(
      enrichments[0]?.squareLocationId === "LOC_1",
      "location id forwarded",
    );
  }

  {
    const applied: ProviderSubscriptionWebhookInput[] = [];
    const enrichments: SquarePaymentEnrichmentInput[] = [];
    const result = await handleSquareWebhook({
      rawBody: paymentBody("FAILED", {
        orderId: "ORD_FAIL",
        locationId: "LOC_FAIL",
      }),
      signatureHeader: "valid",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async (event) => {
        applied.push(event);
      },
      enrichPaymentCorrelation: async (input) => {
        enrichments.push(input);
      },
    });
    assert(result.status === 200, "failed payment flow still works");
    assert(
      applied[0]?.type === "payment.failed",
      "existing webhook classification unchanged (failed)",
    );
    assert(enrichments[0]?.squareOrderId === "ORD_FAIL", "camelCase order forwarded");
    assert(
      enrichments[0]?.squareLocationId === "LOC_FAIL",
      "camelCase location forwarded",
    );
  }

  // enrichment throw must not change webhook response
  {
    const result = await handleSquareWebhook({
      rawBody: paymentBody("COMPLETED", { order_id: "ORD_X" }),
      signatureHeader: "valid",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async () => ({ processed: true, replayed: false }),
      enrichPaymentCorrelation: async () => {
        throw new Error("enrich boom; secret=should-not-leak");
      },
    });
    assert(result.status === 200, "enrichment throw is fail-soft");
    assert(result.body.received === true, "webhook still received");
    assert(
      !JSON.stringify(result.body).includes("secret"),
      "no secrets in webhook body",
    );
    assert(
      !JSON.stringify(result.body).includes("enrich boom"),
      "no raw enrichment errors exposed",
    );
  }

  // applyEvent failure skips enrichment and keeps 503
  {
    let enrichCalls = 0;
    const result = await handleSquareWebhook({
      rawBody: paymentBody("COMPLETED", { order_id: "ORD_X" }),
      signatureHeader: "valid",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async () => {
        throw new Error("apply failed");
      },
      enrichPaymentCorrelation: async () => {
        enrichCalls += 1;
      },
    });
    assert(result.status === 503, "apply failure still 503");
    assert(enrichCalls === 0, "enrichment skipped when apply fails");
  }

  // --- enrichment fills null correlation fields ---
  {
    const row: PaymentRow = {
      provider_payment_id: "PAY_1",
      square_order_id: null,
      square_location_id: null,
      square_environment: null,
      square_invoice_id: null,
      square_subscription_id: null,
      billing_cycle: null,
    };
    const capture: { patch: Record<string, string> | null } = { patch: null };
    const result = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_1",
        squareOrderId: "ORD_NEW",
        squareLocationId: "LOC_NEW",
      },
      {
        createAdmin: () =>
          createFakeAdmin({
            rows: [row],
            onUpdate: (values) => {
              capture.patch = values;
            },
          }),
        resolveEnvironmentName: () => "sandbox",
      },
    );
    assert(result.status === "updated", "null correlation fields filled");
    if (!capture.patch) throw new Error("update patch not captured");
    assert(
      capture.patch.square_order_id === "ORD_NEW" &&
        capture.patch.square_location_id === "LOC_NEW" &&
        capture.patch.square_environment === "sandbox",
      "order/location/environment written",
    );
    assert(
      !("square_invoice_id" in capture.patch) &&
        !("square_subscription_id" in capture.patch) &&
        !("billing_cycle" in capture.patch),
      "no invoice/subscription/billing-cycle fields synthesized",
    );
    assert(row.square_invoice_id === null, "invoice id remains null");
    assert(row.square_subscription_id === null, "subscription id remains null");
    assert(row.billing_cycle === null, "billing cycle remains null");
  }

  // --- conflicting existing correlation fields are not overwritten ---
  {
    const row: PaymentRow = {
      provider_payment_id: "PAY_2",
      square_order_id: "ORD_EXISTING",
      square_location_id: "LOC_EXISTING",
      square_environment: "production",
      square_invoice_id: "INV_KEEP",
      square_subscription_id: "SUB_KEEP",
      billing_cycle: "monthly",
    };
    let updateCalled = false;
    const result = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_2",
        squareOrderId: "ORD_OTHER",
        squareLocationId: "LOC_OTHER",
      },
      {
        createAdmin: () =>
          createFakeAdmin({
            rows: [row],
            onUpdate: () => {
              updateCalled = true;
            },
          }),
        resolveEnvironmentName: () => "sandbox",
      },
    );
    assert(result.status === "skipped", "nothing to fill when all set");
    assert(
      result.status === "skipped" && result.reason === "nothing_to_fill",
      "skip reason nothing_to_fill",
    );
    assert(!updateCalled, "conflicting fields are not overwritten");
    assert(row.square_order_id === "ORD_EXISTING", "order preserved");
    assert(row.square_location_id === "LOC_EXISTING", "location preserved");
    assert(row.square_environment === "production", "environment preserved");
    assert(row.square_invoice_id === "INV_KEEP", "invoice untouched");
    assert(row.square_subscription_id === "SUB_KEEP", "subscription untouched");
    assert(row.billing_cycle === "monthly", "billing cycle untouched");
  }

  // partial fill: only null columns
  {
    const row: PaymentRow = {
      provider_payment_id: "PAY_3",
      square_order_id: "ORD_KEEP",
      square_location_id: null,
      square_environment: null,
      square_invoice_id: null,
      square_subscription_id: null,
      billing_cycle: null,
    };
    const capture: { patch: Record<string, string> | null } = { patch: null };
    const result = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_3",
        squareOrderId: "ORD_IGNORED",
        squareLocationId: "LOC_NEW",
      },
      {
        createAdmin: () =>
          createFakeAdmin({
            rows: [row],
            onUpdate: (values) => {
              capture.patch = values;
            },
          }),
        resolveEnvironmentName: () => "sandbox",
      },
    );
    assert(result.status === "updated", "partial null fill updates");
    if (!capture.patch) throw new Error("partial update patch not captured");
    assert(
      !("square_order_id" in capture.patch) &&
        capture.patch.square_location_id === "LOC_NEW" &&
        capture.patch.square_environment === "sandbox",
      "only null location/environment filled",
    );
    assert(row.square_order_id === "ORD_KEEP", "existing order not overwritten");
  }

  // missing payment row is fail-soft
  {
    const result = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_MISSING",
        squareOrderId: "ORD_1",
        squareLocationId: "LOC_1",
      },
      {
        createAdmin: () => createFakeAdmin({ rows: [] }),
        resolveEnvironmentName: () => "sandbox",
      },
    );
    assert(
      result.status === "skipped" && result.reason === "payment_not_found",
      "missing payment row is fail-soft",
    );
  }

  // DB enrichment error is fail-soft
  {
    const selectFail = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_1",
        squareOrderId: "ORD_1",
        squareLocationId: "LOC_1",
      },
      {
        createAdmin: () => createFakeAdmin({ selectError: true }),
        resolveEnvironmentName: () => "sandbox",
      },
    );
    assert(
      selectFail.status === "failed_soft" &&
        selectFail.reason === "select_error",
      "select error is fail-soft",
    );

    const updateFail = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_1",
        squareOrderId: "ORD_1",
        squareLocationId: "LOC_1",
      },
      {
        createAdmin: () =>
          createFakeAdmin({
            rows: [
              {
                provider_payment_id: "PAY_1",
                square_order_id: null,
                square_location_id: null,
                square_environment: null,
                square_invoice_id: null,
                square_subscription_id: null,
                billing_cycle: null,
              },
            ],
            updateError: true,
          }),
        resolveEnvironmentName: () => "sandbox",
      },
    );
    assert(
      updateFail.status === "failed_soft" &&
        updateFail.reason === "update_error",
      "update error is fail-soft",
    );
  }

  // environment resolution failure is fail-soft
  {
    let adminCalls = 0;
    const result = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_1",
        squareOrderId: "ORD_1",
        squareLocationId: "LOC_1",
      },
      {
        createAdmin: () => {
          adminCalls += 1;
          return createFakeAdmin({ rows: [] });
        },
        resolveEnvironmentName: () => null,
      },
    );
    assert(
      result.status === "skipped" && result.reason === "missing_environment",
      "environment resolution failure is fail-soft",
    );
    assert(adminCalls === 0, "admin not contacted when env missing");
  }

  // missing ids still allow environment-only fill; no synthesis
  {
    const row: PaymentRow = {
      provider_payment_id: "PAY_4",
      square_order_id: null,
      square_location_id: null,
      square_environment: null,
      square_invoice_id: null,
      square_subscription_id: null,
      billing_cycle: null,
    };
    const capture: { patch: Record<string, string> | null } = { patch: null };
    const result = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_4",
        squareOrderId: null,
        squareLocationId: null,
      },
      {
        createAdmin: () =>
          createFakeAdmin({
            rows: [row],
            onUpdate: (values) => {
              capture.patch = values;
            },
          }),
        resolveEnvironmentName: () => "production",
      },
    );
    assert(result.status === "updated", "environment-only enrichment allowed");
    if (!capture.patch) throw new Error("environment-only patch not captured");
    assert(
      Object.keys(capture.patch).length === 1 &&
        capture.patch.square_environment === "production",
      "only environment written when order/location absent",
    );
  }

  // unexpected throw inside enrich is fail-soft
  {
    const result = await enrichSubscriptionPaymentSquareCorrelation(
      {
        providerPaymentId: "PAY_1",
        squareOrderId: "ORD_1",
        squareLocationId: "LOC_1",
      },
      {
        createAdmin: () => {
          throw new Error("admin boom; password=secret");
        },
        resolveEnvironmentName: () => "sandbox",
      },
    );
    assert(
      result.status === "failed_soft" && result.reason === "unexpected",
      "unexpected enrichment error is fail-soft",
    );
    assert(
      !JSON.stringify(result).includes("password") &&
        !JSON.stringify(result).includes("secret"),
      "no secrets in enrichment result",
    );
  }

  // route wires enrichment; enrichment module does not call Square APIs
  {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/webhooks/square/route.ts"),
      "utf8",
    );
    const enrichment = readFileSync(
      join(process.cwd(), "src/lib/square-payment-enrichment.ts"),
      "utf8",
    );
    const webhook = readFileSync(
      join(process.cwd(), "src/lib/square-webhook.ts"),
      "utf8",
    );
    assert(
      route.includes("enrichSubscriptionPaymentSquareCorrelation"),
      "route wires fail-soft enrichment",
    );
    assert(
      !enrichment.includes("correlatePayment") &&
        !webhook.includes("correlatePayment"),
      "no correlatePayment",
    );
    assert(
      !enrichment.includes("persistInvoice") &&
        !webhook.includes("persistInvoice"),
      "no persistInvoice",
    );
    assert(
      !enrichment.includes("createSquareClient") &&
        !enrichment.includes("SquareClient"),
      "no Square API client in enrichment",
    );
    assert(
      !enrichment.includes("fetch(") && !enrichment.includes("https://"),
      "no network in enrichment module",
    );
  }

  console.log("square payment enrichment (D2-PREP) tests passed");
}

runSquarePaymentEnrichmentTests().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "square payment enrichment tests failed",
  );
  process.exitCode = 1;
});
