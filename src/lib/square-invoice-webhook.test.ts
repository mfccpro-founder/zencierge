import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractInvoicePaymentRequestMoney,
  parseSquareInvoiceWebhook,
  type SquareInvoiceWebhookPersistableFields,
} from "./square-invoice-webhook";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv:0-TEST_INVOICE",
    order_id: "ORDER_A",
    subscription_id: "SUB_A",
    location_id: "LOC_A",
    status: "UNPAID",
    version: 1,
    created_at: "2026-09-14T12:00:00Z",
    updated_at: "2026-09-14T12:01:00Z",
    primary_recipient: {
      customer_id: "CUST_A",
      email_address: "host@example.com",
    },
    payment_requests: [
      {
        request_type: "BALANCE",
        due_date: "2026-09-30",
        computed_amount_money: { amount: 4900, currency: "USD" },
        total_completed_amount_money: { amount: 0, currency: "USD" },
      },
    ],
    ...overrides,
  };
}

function envelope(input: {
  type: string;
  invoice?: Record<string, unknown>;
  eventId?: string;
  extras?: Record<string, unknown>;
  omitDataObject?: boolean;
}) {
  return {
    merchant_id: "MERCHANT_A",
    location_id: "LOC_EVENT",
    type: input.type,
    event_id: input.eventId ?? "evt_invoice_1",
    created_at: "2026-09-14T12:02:00Z",
    data: input.omitDataObject
      ? { type: "invoice", id: "inv:0-TEST_INVOICE" }
      : {
          type: "invoice",
          id: "inv:0-TEST_INVOICE",
          object: {
            invoice: input.invoice ?? baseInvoice(),
          },
        },
    ...input.extras,
  };
}

function expectPersistable(
  result: ReturnType<typeof parseSquareInvoiceWebhook>,
): SquareInvoiceWebhookPersistableFields {
  assert(result.status === "persistable", "expected persistable");
  if (result.status !== "persistable") {
    throw new Error("expected persistable");
  }
  return result.fields;
}

function expectSkipped(
  result: ReturnType<typeof parseSquareInvoiceWebhook>,
  reason: string,
) {
  assert(result.status === "skipped", `expected skipped (${reason})`);
  if (result.status !== "skipped") {
    throw new Error("expected skipped");
  }
  assert(result.reason === reason, `skip reason ${reason}`);
  return result;
}

async function run() {
  // 1. invoice.created snake_case
  {
    const result = parseSquareInvoiceWebhook(
      JSON.stringify(envelope({ type: "invoice.created" })),
    );
    const fields = expectPersistable(result);
    assert(fields.eventType === "invoice.created", "created type");
    assert(fields.squareInvoiceId === "inv:0-TEST_INVOICE", "invoice id");
    assert(fields.squareSubscriptionId === "SUB_A", "subscription id");
    assert(fields.squareOrderId === "ORDER_A", "order id");
    assert(fields.amountUsd === 49, "amount usd");
    assert(fields.currency === "USD", "currency");
    assert(fields.dueDate === "2026-09-30", "due date");
    assert(fields.paidAt === null, "created unpaid → no paidAt");
  }

  // 2. invoice.updated camelCase
  {
    const invoice = {
      id: "inv:0-CAMEL",
      orderId: "ORDER_CAMEL",
      subscriptionId: "SUB_CAMEL",
      locationId: "LOC_CAMEL",
      status: "UNPAID",
      version: 2,
      createdAt: "2026-09-14T13:00:00Z",
      updatedAt: "2026-09-14T13:05:00Z",
      primaryRecipient: { customerId: "CUST_CAMEL" },
      paymentRequests: [
        {
          requestType: "BALANCE",
          dueDate: "2026-10-01",
          computedAmountMoney: { amount: 9900, currency: "USD" },
        },
      ],
    };
    const result = parseSquareInvoiceWebhook({
      eventId: "evt_camel",
      type: "invoice.updated",
      createdAt: "2026-09-14T13:06:00Z",
      locationId: "LOC_EVENT_CAMEL",
      data: { type: "invoice", object: { invoice } },
    });
    const fields = expectPersistable(result);
    assert(fields.eventType === "invoice.updated", "updated type");
    assert(fields.eventId === "evt_camel", "event id camel");
    assert(fields.squareInvoiceId === "inv:0-CAMEL", "camel invoice");
    assert(fields.squareSubscriptionId === "SUB_CAMEL", "camel subscription");
    assert(fields.squareOrderId === "ORDER_CAMEL", "camel order");
    assert(fields.squareCustomerId === "CUST_CAMEL", "camel customer");
    assert(fields.squareLocationId === "LOC_CAMEL", "invoice location preferred");
    assert(fields.squareInvoiceVersion === 2, "camel version");
    assert(fields.amountUsd === 99, "camel amount");
    assert(fields.dueDate === "2026-10-01", "camel due");
  }

  // 3. invoice.published
  {
    const result = parseSquareInvoiceWebhook(
      envelope({
        type: "invoice.published",
        invoice: baseInvoice({ status: "UNPAID", version: 1 }),
      }),
    );
    const fields = expectPersistable(result);
    assert(fields.eventType === "invoice.published", "published type");
    assert(fields.squareInvoiceStatus === "UNPAID", "published status");
    assert(fields.paidAt === null, "published not paidAt");
  }

  // 4. invoice.payment_made
  {
    const result = parseSquareInvoiceWebhook(
      envelope({
        type: "invoice.payment_made",
        invoice: baseInvoice({
          status: "PAID",
          updated_at: "2026-09-14T15:00:00Z",
          payment_requests: [
            {
              due_date: "2026-09-30",
              computed_amount_money: { amount: 4900, currency: "USD" },
              total_completed_amount_money: { amount: 4900, currency: "USD" },
            },
          ],
        }),
      }),
    );
    const fields = expectPersistable(result);
    assert(fields.eventType === "invoice.payment_made", "payment_made type");
    assert(fields.squareInvoiceStatus === "PAID", "paid status");
    assert(fields.paidAt === "2026-09-14T15:00:00Z", "paidAt from updated_at");
  }

  // 5. missing invoice.id
  {
    const result = parseSquareInvoiceWebhook({
      type: "invoice.created",
      event_id: "evt_no_id",
      data: {
        type: "invoice",
        object: {
          invoice: {
            ...baseInvoice(),
            id: undefined,
          },
        },
      },
    });
    // Also clear data.id so neither path yields an id.
    const resultNoDataId = parseSquareInvoiceWebhook({
      type: "invoice.created",
      event_id: "evt_no_id",
      data: {
        type: "invoice",
        object: {
          invoice: baseInvoice({ id: "   " }),
        },
      },
    });
    assert(
      resultNoDataId.status === "skipped" &&
        resultNoDataId.reason === "missing_invoice_id",
      "blank invoice id skipped",
    );
    // When invoice.id is absent but data.id exists, data.id is acceptable.
    if (result.status === "persistable") {
      assert(
        result.fields.squareInvoiceId === "inv:0-TEST_INVOICE",
        "data.id fallback allowed when present",
      );
    } else {
      assert(result.reason === "missing_invoice_id", "or skip when no ids");
    }
  }

  // 6. missing subscription_id
  {
    const { subscription_id: _drop, ...rest } = baseInvoice();
    void _drop;
    const result = parseSquareInvoiceWebhook(
      envelope({
        type: "invoice.updated",
        invoice: rest,
      }),
    );
    const skipped = expectSkipped(result, "missing_subscription_id");
    assert(skipped.eventType === "invoice.updated", "event type retained on skip");
  }

  // 7. order_id parsing
  {
    const fields = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.created",
          invoice: baseInvoice({ order_id: "ORDER_SNAKE", orderId: "IGNORE" }),
        }),
      ),
    );
    assert(fields.squareOrderId === "ORDER_SNAKE", "snake order preferred first");
    const camel = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.created",
          invoice: baseInvoice({
            order_id: undefined,
            orderId: "ORDER_ONLY_CAMEL",
          }),
        }),
      ),
    );
    assert(camel.squareOrderId === "ORDER_ONLY_CAMEL", "camel order fallback");
  }

  // 8. location/customer parsing
  {
    const fields = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.created",
          invoice: baseInvoice({
            location_id: undefined,
            primary_recipient: { customer_id: "CUST_LOC" },
          }),
        }),
      ),
    );
    assert(fields.squareLocationId === "LOC_EVENT", "event location fallback");
    assert(fields.squareCustomerId === "CUST_LOC", "customer id");
  }

  // 9. version/status parsing
  {
    const fields = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.updated",
          invoice: baseInvoice({ status: "CANCELED", version: "3" }),
        }),
      ),
    );
    assert(fields.squareInvoiceStatus === "CANCELED", "status");
    assert(fields.squareInvoiceVersion === 3, "string version parsed");
  }

  // 10. amount/currency extraction helper
  {
    const money = extractInvoicePaymentRequestMoney(
      baseInvoice({
        payment_requests: [
          {
            computed_amount_money: { amount: 1250, currency: "USD" },
            due_date: "2026-11-01",
          },
        ],
      }),
    );
    assert(money.amountUsd === 12.5, "helper amount");
    assert(money.currency === "USD", "helper currency");
    assert(money.dueDate === "2026-11-01", "helper due");
  }

  // 11. multiple payment_requests ambiguity
  {
    const fields = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.created",
          invoice: baseInvoice({
            payment_requests: [
              {
                computed_amount_money: { amount: 4900, currency: "USD" },
                due_date: "2026-09-30",
              },
              {
                computed_amount_money: { amount: 1000, currency: "USD" },
                due_date: "2026-10-15",
              },
            ],
          }),
        }),
      ),
    );
    assert(fields.amountUsd === null, "ambiguous amount null");
    assert(fields.currency === null, "ambiguous currency null");
    assert(fields.dueDate === "2026-09-30", "due date still available");

    const same = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.created",
          invoice: baseInvoice({
            payment_requests: [
              { computed_amount_money: { amount: 4900, currency: "USD" } },
              { computed_amount_money: { amount: 4900, currency: "USD" } },
            ],
          }),
        }),
      ),
    );
    assert(same.amountUsd === 49, "identical multi-request amount ok");
  }

  // 12. dueDate extraction — covered above; explicit null when absent
  {
    const fields = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.created",
          invoice: baseInvoice({
            payment_requests: [
              { computed_amount_money: { amount: 100, currency: "USD" } },
            ],
          }),
        }),
      ),
    );
    assert(fields.dueDate === null, "no due date → null");
  }

  // 13. paidAt safe inference
  {
    const unpaidMade = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.payment_made",
          invoice: baseInvoice({ status: "UNPAID" }),
        }),
      ),
    );
    assert(unpaidMade.paidAt === null, "payment_made + UNPAID → no paidAt");

    const paidUpdated = expectPersistable(
      parseSquareInvoiceWebhook(
        envelope({
          type: "invoice.updated",
          invoice: baseInvoice({
            status: "PAID",
            updated_at: "2026-09-14T16:00:00Z",
          }),
        }),
      ),
    );
    assert(
      paidUpdated.paidAt === null,
      "PAID on updated alone does not invent paidAt",
    );
  }

  // 14. unsupported event type
  {
    const result = parseSquareInvoiceWebhook(
      envelope({ type: "payment.updated" }),
    );
    assert(
      result.status === "skipped" && result.reason === "unsupported_event_type",
      "unsupported type",
    );
  }

  // 15. malformed payload fails safely
  {
    expectSkipped(parseSquareInvoiceWebhook("{not-json"), "malformed_payload");
    expectSkipped(parseSquareInvoiceWebhook(null), "malformed_payload");
    assert(
      parseSquareInvoiceWebhook(envelope({ type: "invoice.created", omitDataObject: true }))
        .status === "skipped",
      "missing invoice object",
    );
  }

  // 16. no secret/token leakage in module or parser outputs
  {
    const source = readFileSync(
      join(process.cwd(), "src/lib/square-invoice-webhook.ts"),
      "utf8",
    );
    assert(!/access_token|secret|password|api_key/i.test(source), "no secrets in source");
    const fields = expectPersistable(
      parseSquareInvoiceWebhook(envelope({ type: "invoice.created" })),
    );
    const serialized = JSON.stringify(fields);
    assert(
      !/access_token|secret|password|Bearer /i.test(serialized),
      "no secrets in output",
    );
    assert(
      !/\bpersistInvoice\b/.test(source) &&
        !/\bcorrelatePayment\b/.test(source) &&
        !/from\(["']supabase/.test(source) &&
        !/\bfetch\s*\(/.test(source),
      "parser stays free of persist/network",
    );
  }

  // missing invoice object reason
  {
    const result = parseSquareInvoiceWebhook({
      type: "invoice.created",
      event_id: "evt_x",
      data: { type: "invoice", object: {} },
    });
    assert(
      result.status === "skipped" && result.reason === "missing_invoice",
      "missing invoice object",
    );
  }

  console.log("square-invoice-webhook tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
