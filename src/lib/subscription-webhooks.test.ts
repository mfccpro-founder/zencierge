import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  validateSubscriptionWebhookPayment,
  type SubscriptionWebhookInput,
} from "./subscription-webhooks";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function payment(
  partial: Partial<SubscriptionWebhookInput> = {},
): SubscriptionWebhookInput {
  return {
    type: "payment.succeeded",
    paymentId: "payment-1",
    amountUsd: 99,
    ...partial,
  };
}

function runSubscriptionWebhookTests() {
  const succeeded = validateSubscriptionWebhookPayment(payment());
  assert(succeeded?.ok === true, "valid succeeded payment is accepted");
  if (succeeded?.ok) {
    assert(succeeded.paymentId === "payment-1", "stable payment id is retained");
    assert(succeeded.amountUsd === 99, "exact payment amount is retained");
  }

  const failed = validateSubscriptionWebhookPayment(
    payment({
      type: "payment.failed",
      paymentId: " failed-payment ",
      amountUsd: 49.25,
    }),
  );
  assert(failed?.ok === true, "valid failed payment is accepted");
  if (failed?.ok) {
    assert(failed.paymentId === "failed-payment", "payment id is trimmed");
    assert(failed.amountUsd === 49.25, "positive decimal amount is retained exactly");
  }

  for (const paymentId of [undefined, null, "", "   "]) {
    const result = validateSubscriptionWebhookPayment(payment({ paymentId }));
    assert(result?.ok === false, `${String(paymentId)} payment id is rejected`);
  }

  for (const amountUsd of [
    undefined,
    null,
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    const result = validateSubscriptionWebhookPayment(payment({ amountUsd }));
    assert(result?.ok === false, `${String(amountUsd)} payment amount is rejected`);
  }

  const canceled = validateSubscriptionWebhookPayment({
    type: "subscription.canceled",
    paymentId: null,
    amountUsd: null,
  });
  assert(canceled === null, "subscription cancellation preserves existing non-payment behavior");

  const root = process.cwd();
  const source = readFileSync(join(root, "src/lib/subscription-webhooks.ts"), "utf8");
  const validationAt = source.indexOf(
    "const validatedPayment = validateSubscriptionWebhookPayment",
  );
  const adminClientAt = source.indexOf("const admin = createSupabaseAdminClient()");
  const userLookupAt = source.indexOf("const userId = await resolveUserId");
  const paymentUpsertAt = source.indexOf('admin.from("subscription_payments").upsert');
  const chargeSideEffectAt = source.indexOf("recordSquareCharge({");
  const funnelSideEffectAt = source.indexOf("recordFunnelEvent({");
  const subscriptionUpsertAt = source.indexOf('admin.from("host_subscriptions").upsert');

  assert(validationAt >= 0, "shared payment validation is invoked");
  assert(validationAt < adminClientAt, "payment validation runs before admin client creation");
  assert(validationAt < userLookupAt, "payment validation runs before auth/admin lookup");
  assert(validationAt < paymentUpsertAt, "payment validation runs before payment upsert");
  assert(validationAt < chargeSideEffectAt, "payment validation runs before charge side effect");
  assert(validationAt < funnelSideEffectAt, "payment validation runs before funnel side effect");
  assert(validationAt < subscriptionUpsertAt, "payment validation runs before subscription upsert");

  assert(
    !source.includes("`${input.type}-${at}`"),
    "payment id is never synthesized from event type and time",
  );
  assert(
    !source.includes("amountUsd || monthlyUsd"),
    "payment amount never falls back to catalog pricing",
  );
  assert(
    source.includes("amount_usd: validatedPayment.amountUsd"),
    "exact validated payment amount is persisted",
  );
  assert(
    source.includes("provider_payment_id: validatedPayment.paymentId"),
    "trimmed validated payment id is persisted",
  );
  assert(
    source.includes('onConflict: "provider_payment_id"'),
    "existing provider payment id conflict protection remains",
  );
  assert(
    !source.includes('from "square"') && !source.includes("createSquareClient"),
    "core integrity block adds no Square SDK calls",
  );

  const migrationsDir = join(root, "supabase/migrations");
  const migrationNames = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
  assert(
    !migrationNames.some((name) => /subscription_webhook_integrity|billing_microblock_5/i.test(name)),
    "Microblock 5 creates no migration",
  );

  console.log("subscription webhook payment integrity tests passed");
}

runSubscriptionWebhookTests();