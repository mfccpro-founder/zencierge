import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      !context.parentURL?.includes("/node_modules/") &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { resolveStripeSandboxAccess } = await import("./stripe-sandbox-access.ts");
const { ZENCIERGE_PLANS } = await import("./zencierge-plans.ts");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const now = new Date("2026-10-13T20:00:00.000Z");
const userId = "5d070dd6-ed82-4036-b38c-37d3b8a1df0c";
const checkoutId = "90982e91-2796-4183-8d97-17041931928d";
const subscriptionId = "sub_test_correlated";
const invoiceId = "in_test_paid";
const priceId = "price_test_starter_monthly";
const annualPriceId = "price_test_starter_annual";

function fixture(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const snapshot = {
    checkouts: [{
      id: checkoutId,
      user_id: userId,
      plan_id: "starter",
      billing_cycle: "monthly",
      expected_price_id: priceId,
      stripe_subscription_id: subscriptionId,
      status: "correlated",
      updated_at: now.toISOString(),
    }],
    invoices: [{
      invoice_id: invoiceId,
      checkout_session_id: checkoutId,
      stripe_subscription_id: subscriptionId,
      webhook_event_id: "evt_test_paid",
    }],
    events: [{
      event_id: "evt_test_paid",
      event_type: "invoice.paid",
      status: "applied",
      checkout_session_id: checkoutId,
      invoice_id: invoiceId,
      stripe_subscription_id: subscriptionId,
    }],
  };
  const store = { async load() { calls.push("local"); return snapshot; } };
  const stripe = {
    subscriptions: { async retrieve() {
      calls.push("subscription");
      return {
        id: subscriptionId,
        livemode: false,
        status: "active",
        items: { data: [{
          current_period_start: Math.floor(Date.parse("2026-10-13T19:45:13.000Z") / 1000),
          current_period_end: Math.floor(Date.parse("2026-11-13T19:45:13.000Z") / 1000),
          price: { id: priceId, livemode: false, recurring: { interval: "month", interval_count: 1 } },
        }] },
      };
    } },
    invoices: { async retrieve() {
      calls.push("invoice");
      return {
        id: invoiceId,
        livemode: false,
        status: "paid",
        currency: "usd",
        amount_paid: 4900,
        status_transitions: { paid_at: Math.floor(Date.parse("2026-10-13T19:45:14.000Z") / 1000) },
        lines: { data: [{
          amount: 4900,
          currency: "usd",
          period: {
            start: Math.floor(Date.parse("2026-10-13T19:45:13.000Z") / 1000),
            end: Math.floor(Date.parse("2026-11-13T19:45:13.000Z") / 1000),
          },
          pricing: { price_details: { price: priceId } },
        }] },
        parent: { subscription_details: { subscription: subscriptionId } },
      };
    } },
  };
  return {
    calls,
    snapshot,
    store,
    stripe,
    input: {
      nodeEnv: "development",
      enabled: "true",
      authenticated: true,
      userId,
      squareSubscriptionId: null,
      now,
      store,
      stripe,
      ...overrides,
    },
  };
}

function annualFixture() {
  const value = fixture({ now: new Date("2024-06-15T12:00:00.000Z") });
  value.snapshot.checkouts[0]!.billing_cycle = "annual";
  value.snapshot.checkouts[0]!.expected_price_id = annualPriceId;
  const periodStart = Math.floor(Date.parse("2024-02-29T08:30:00.000Z") / 1000);
  const periodEnd = Math.floor(Date.parse("2025-02-28T08:30:00.000Z") / 1000);
  value.stripe.subscriptions.retrieve = async () => ({
    id: subscriptionId,
    livemode: false,
    status: "active",
    items: { data: [{
      current_period_start: periodStart,
      current_period_end: periodEnd,
      price: {
        id: annualPriceId,
        livemode: false,
        recurring: { interval: "year", interval_count: 1 },
      },
    }] },
  });
  value.stripe.invoices.retrieve = async () => ({
    id: invoiceId,
    livemode: false,
    status: "paid",
    currency: "usd",
    amount_paid: 49000,
    status_transitions: { paid_at: Math.floor(Date.parse("2024-02-29T08:31:00.000Z") / 1000) },
    lines: { data: [{
      amount: 49000,
      currency: "usd",
      period: { start: periodStart, end: periodEnd },
      pricing: { price_details: { price: annualPriceId } },
    }] },
    parent: { subscription_details: { subscription: subscriptionId } },
  });
  return { ...value, periodStart, periodEnd };
}

async function run() {
  const disabled = fixture({ enabled: undefined });
  const disabledResult = await resolveStripeSandboxAccess(disabled.input as never);
  assert(!disabledResult.granted && disabledResult.reason === "disabled" && disabled.calls.length === 0, "sandbox access is off by default without remote reads");

  const valid = fixture();
  const validResult = await resolveStripeSandboxAccess(valid.input as never);
  assert(validResult.granted && validResult.planId === "starter", "correlated paid current subscription grants sandbox access");
  assert(valid.calls.join(",") === "local,subscription,invoice", "local correlation is checked before Stripe");
  assert(ZENCIERGE_PLANS[validResult.planId].maxProperties === 1, "sandbox access reuses the catalog Starter limit");

  const otherUser = fixture();
  otherUser.snapshot.checkouts[0]!.user_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherResult = await resolveStripeSandboxAccess(otherUser.input as never);
  assert(!otherResult.granted && !otherUser.calls.includes("subscription"), "another user's checkout is rejected before Stripe");

  const unpaid = fixture();
  unpaid.snapshot.events[0]!.status = "awaiting_correlation";
  const unpaidResult = await resolveStripeSandboxAccess(unpaid.input as never);
  assert(!unpaidResult.granted && !unpaid.calls.includes("invoice"), "unapplied payment does not grant access");

  const unconfirmed = fixture();
  unconfirmed.stripe.invoices.retrieve = async () => ({
    id: invoiceId,
    livemode: false,
    status: "open",
    currency: "usd",
    amount_paid: 0,
    status_transitions: { paid_at: 0 },
    lines: { data: [{
      amount: 4900,
      currency: "usd",
      period: {
        start: Math.floor(Date.parse("2026-10-13T19:45:13.000Z") / 1000),
        end: Math.floor(Date.parse("2026-11-13T19:45:13.000Z") / 1000),
      },
      pricing: { price_details: { price: priceId } },
    }] },
    parent: { subscription_details: { subscription: subscriptionId } },
  });
  const unconfirmedResult = await resolveStripeSandboxAccess(unconfirmed.input as never);
  assert(!unconfirmedResult.granted, "a locally applied event cannot override an unpaid Stripe invoice");

  const expired = fixture({ now: new Date("2026-12-01T00:00:00.000Z") });
  const expiredResult = await resolveStripeSandboxAccess(expired.input as never);
  assert(!expiredResult.granted, "an expired Stripe billing period does not grant access");

  const annual = annualFixture();
  const annualResult = await resolveStripeSandboxAccess(annual.input as never);
  assert(
    annualResult.granted &&
      annualResult.billingCycle === "annual" &&
      annualResult.currentPeriodEnd === "2025-02-28T08:30:00.000Z",
    "a current leap-day calendar-year subscription and matching paid invoice grant annual access",
  );

  const monthlyPrice = annualFixture();
  monthlyPrice.stripe.subscriptions.retrieve = async () => ({
    id: subscriptionId,
    livemode: false,
    status: "active",
    items: { data: [{
      current_period_start: monthlyPrice.periodStart,
      current_period_end: monthlyPrice.periodEnd,
      price: {
        id: annualPriceId,
        livemode: false,
        recurring: { interval: "month", interval_count: 1 },
      },
    }] },
  });
  const monthlyPriceResult = await resolveStripeSandboxAccess(monthlyPrice.input as never);
  assert(!monthlyPriceResult.granted, "an annual checkout rejects a monthly recurring price");

  const wrongInvoice = annualFixture();
  const validAnnualInvoice = wrongInvoice.stripe.invoices.retrieve;
  wrongInvoice.stripe.invoices.retrieve = async () => ({
    ...await validAnnualInvoice(),
    amount_paid: 4900,
  });
  const wrongInvoiceResult = await resolveStripeSandboxAccess(wrongInvoice.input as never);
  assert(!wrongInvoiceResult.granted, "an annual checkout rejects an invoice with the wrong amount");

  const incompatiblePeriods = annualFixture();
  const compatibleInvoice = incompatiblePeriods.stripe.invoices.retrieve;
  incompatiblePeriods.stripe.invoices.retrieve = async () => {
    const invoice = await compatibleInvoice();
    return {
      ...invoice,
      lines: { data: [{
        ...invoice.lines.data[0],
        period: {
          start: incompatiblePeriods.periodStart,
          end: Math.floor(Date.parse("2025-03-01T08:30:00.000Z") / 1000),
        },
      }] },
    };
  };
  const incompatiblePeriodsResult = await resolveStripeSandboxAccess(
    incompatiblePeriods.input as never,
  );
  assert(
    !incompatiblePeriodsResult.granted,
    "an annual invoice whose calendar period differs from the subscription is rejected",
  );

  const square = fixture({ squareSubscriptionId: "sqsub_existing_host" });
  const squareResult = await resolveStripeSandboxAccess(square.input as never);
  assert(!squareResult.granted && squareResult.reason === "square-host-protected" && square.calls.length === 0, "Stripe sandbox never overrides a Square host");

  const accessSource = readFileSync(join(process.cwd(), "src/lib/stripe-sandbox-access.ts"), "utf8");
  assert(!accessSource.includes('from("host_subscriptions")') && !accessSource.includes('from("subscription_payments")'), "sandbox verifier never reads or writes production billing tables");
  assert(!accessSource.includes("metadata") && !accessSource.includes("email"), "sandbox access does not trust metadata or email");

  console.log("Stripe Sandbox access gating tests passed");
}

await run();
