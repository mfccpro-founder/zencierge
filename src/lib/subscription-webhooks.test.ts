import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  applyProviderSubscriptionWebhook,
  applySubscriptionWebhook,
  subscriptionWebhookFingerprint,
  validateSubscriptionWebhookPayment,
  type ProviderSubscriptionWebhookAtomicArgs,
  type ProviderSubscriptionWebhookDependencies,
  type ProviderSubscriptionWebhookFingerprintInput,
  type ProviderSubscriptionWebhookInput,
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

const USER_ID = "334119a5-44b0-4567-8184-c2c6ff83a49e";
const OTHER_USER_ID = "a72b4d0c-3c19-430b-9aeb-24d480bbde15";
const NOW = new Date("2026-09-08T12:00:00.000Z");

function providerPayment(
  partial: Partial<ProviderSubscriptionWebhookInput> = {},
): ProviderSubscriptionWebhookInput {
  return {
    provider: "square",
    eventId: " square-event-1 ",
    type: "payment.succeeded",
    userId: USER_ID,
    email: " Host@Example.com ",
    planId: "pro",
    amountUsd: 99,
    paymentId: " payment-1 ",
    squareCustomerId: " customer-1 ",
    squareSubscriptionId: " subscription-1 ",
    occurredAt: "2026-09-08T11:00:00-01:00",
    ...partial,
  };
}

function atomicResult(input: {
  processed: boolean;
  replayed: boolean;
  userId?: string | null;
  planId?: "starter" | "pro" | "portfolio" | "agency";
  status?: "active" | "past_due" | "canceled";
}) {
  const resolvedUserId =
    input.userId === undefined ? USER_ID : input.userId;
  return [
    {
      processed: input.processed,
      replayed: input.replayed,
      skipped_subscription: resolvedUserId === null,
      resolved_user_id: resolvedUserId,
      resolved_plan_id: input.planId ?? "pro",
      subscription_status: input.status ?? "active",
    },
  ];
}

function testDependencies(input?: {
  results?: unknown[];
  rpcError?: Error;
  resolvedUserId?: string | null;
  now?: Date;
  plan?: {
    planId: "starter" | "pro" | "portfolio" | "agency";
    monthlyUsd: number;
  };
}) {
  const rpcArgs: ProviderSubscriptionWebhookAtomicArgs[] = [];
  const charges: unknown[] = [];
  const funnels: unknown[] = [];
  let storeCreations = 0;
  let userLookups = 0;
  let rpcCalls = 0;
  let planResolutions = 0;
  let nowCalls = 0;

  const results = [
    ...(input?.results ?? [
      atomicResult({ processed: true, replayed: false }),
    ]),
  ];

  const dependencies: ProviderSubscriptionWebhookDependencies = {
    createStore() {
      storeCreations += 1;
      return {
        async resolveUserId() {
          userLookups += 1;
          return input?.resolvedUserId === undefined
            ? USER_ID
            : input.resolvedUserId;
        },
        async processAtomic(args) {
          rpcCalls += 1;
          rpcArgs.push(args);
          if (input?.rpcError) throw input.rpcError;
          return results.shift();
        },
      };
    },
    resolvePlan() {
      planResolutions += 1;
      return input?.plan ?? {
        planId: "pro",
        monthlyUsd: 99,
      };
    },
    now() {
      nowCalls += 1;
      return new Date(input?.now ?? NOW);
    },
    recordCharge: (charge) => {
      charges.push(charge);
    },
    recordFunnel: (event) => {
      funnels.push(event);
    },
  };

  return {
    dependencies,
    rpcArgs,
    charges,
    funnels,
    counts: () => ({
      storeCreations,
      userLookups,
      rpcCalls,
      planResolutions,
      nowCalls,
    }),
  };
}

async function runSubscriptionWebhookTests() {
  const root = process.cwd();
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

  const fingerprintInput: ProviderSubscriptionWebhookFingerprintInput = {
    provider: "square",
    eventId: "square-event-1",
    type: "payment.succeeded",
    userId: USER_ID,
    email: "host@example.com",
    planId: "pro",
    amountUsd: 99,
    paymentId: "payment-1",
    squareCustomerId: "customer-1",
    squareSubscriptionId: "subscription-1",
    occurredAt: "2026-09-08T12:00:00.000Z",
  };
  const fingerprint = subscriptionWebhookFingerprint(fingerprintInput);
  assert(
    /^[0-9a-f]{64}$/.test(fingerprint),
    "fingerprint is lowercase SHA-256",
  );
  assert(
    fingerprint ===
      subscriptionWebhookFingerprint({ ...fingerprintInput }),
    "fingerprint is deterministic",
  );
  assert(
    subscriptionWebhookFingerprint({
      ...fingerprintInput,
      amountUsd: 49,
    }) !== fingerprint,
    "provider amount changes fingerprint",
  );
  assert(
    subscriptionWebhookFingerprint({
      ...fingerprintInput,
      occurredAt: "2026-09-08T12:00:01.000Z",
    }) !== fingerprint,
    "provider timestamp changes fingerprint",
  );

  const first = testDependencies();
  const firstResult = await applyProviderSubscriptionWebhook(
    providerPayment(),
    first.dependencies,
  );
  assert(
    firstResult.processed && !firstResult.replayed,
    "first provider delivery owns processing",
  );
  assert(
    first.counts().storeCreations === 1 &&
      first.counts().userLookups === 1 &&
      first.counts().rpcCalls === 1,
    "first provider delivery performs one lookup and RPC call",
  );
  assert(
    first.charges.length === 1 && first.funnels.length === 1,
    "successful first payment executes applicable side effects once",
  );

  const firstArgs = first.rpcArgs[0];
  assert(firstArgs?.p_provider === "square", "RPC receives provider");
  assert(
    firstArgs?.p_event_id === "square-event-1",
    "RPC receives trimmed event ID",
  );
  assert(
    firstArgs?.p_event_type === "payment.succeeded",
    "RPC receives normalized event type",
  );
  assert(
    firstArgs?.p_user_id === USER_ID,
    "RPC receives resolved user ID",
  );
  assert(
    firstArgs?.p_email === "host@example.com",
    "RPC receives normalized email",
  );
  assert(
    firstArgs?.p_plan_id === "pro" &&
      firstArgs.p_monthly_usd === 99,
    "RPC receives resolved catalog plan and monthly price",
  );
  assert(
    firstArgs?.p_amount_usd === 99 &&
      firstArgs.p_payment_id === "payment-1",
    "RPC receives exact amount and trimmed payment ID",
  );
  assert(
    firstArgs?.p_square_customer_id === "customer-1" &&
      firstArgs.p_square_subscription_id === "subscription-1",
    "RPC receives normalized Square identifiers",
  );
  assert(
    firstArgs?.p_occurred_at === "2026-09-08T12:00:00.000Z",
    "RPC receives normalized provider timestamp",
  );
  assert(
    firstArgs?.p_current_period_end === null,
    "RPC receives null period end for database fallback",
  );

  const replay = testDependencies({
    results: [atomicResult({ processed: false, replayed: true })],
  });
  const replayResult = await applyProviderSubscriptionWebhook(
    providerPayment(),
    replay.dependencies,
  );
  assert(
    !replayResult.processed && replayResult.replayed,
    "sequential replay is a successful no-op",
  );
  assert(
    replay.charges.length === 0 && replay.funnels.length === 0,
    "sequential replay executes no side effects",
  );

  let concurrentRpcCalls = 0;
  const concurrentCharges: unknown[] = [];
  const concurrentFunnels: unknown[] = [];
  const concurrentDependencies:
    ProviderSubscriptionWebhookDependencies = {
    createStore: () => ({
      resolveUserId: async () => USER_ID,
      processAtomic: async () => {
        const callNumber = ++concurrentRpcCalls;
        await Promise.resolve();
        return atomicResult({
          processed: callNumber === 1,
          replayed: callNumber !== 1,
        });
      },
    }),
    resolvePlan: () => ({ planId: "pro", monthlyUsd: 99 }),
    now: () => new Date(NOW),
    recordCharge: (charge) => concurrentCharges.push(charge),
    recordFunnel: (event) => concurrentFunnels.push(event),
  };
  const concurrentResults = await Promise.all([
    applyProviderSubscriptionWebhook(
      providerPayment(),
      concurrentDependencies,
    ),
    applyProviderSubscriptionWebhook(
      providerPayment(),
      concurrentDependencies,
    ),
  ]);
  assert(
    concurrentResults.filter((result) => result.processed).length === 1,
    "concurrent duplicate has one processed owner",
  );
  assert(
    concurrentResults.filter((result) => result.replayed).length === 1,
    "concurrent duplicate has one replay",
  );
  assert(
    concurrentCharges.length === 1,
    "concurrent duplicate executes one charge side effect",
  );
  assert(
    concurrentFunnels.length === 1,
    "concurrent duplicate executes one funnel side effect",
  );

  const failedRpc = testDependencies({
    rpcError: new Error("private database error"),
  });
  let rpcRejected = false;
  try {
    await applyProviderSubscriptionWebhook(
      providerPayment(),
      failedRpc.dependencies,
    );
  } catch {
    rpcRejected = true;
  }
  assert(rpcRejected, "RPC error rejects provider processing");
  assert(
    failedRpc.charges.length === 0 && failedRpc.funnels.length === 0,
    "RPC error executes no side effects",
  );

  const malformed = testDependencies({
    results: [[{
      processed: true,
      replayed: true,
      skipped_subscription: false,
      resolved_user_id: USER_ID,
      resolved_plan_id: "pro",
      subscription_status: "active",
    }]],
  });
  let malformedRejected = false;
  try {
    await applyProviderSubscriptionWebhook(
      providerPayment(),
      malformed.dependencies,
    );
  } catch {
    malformedRejected = true;
  }
  assert(malformedRejected, "impossible RPC result is rejected");
  assert(
    malformed.charges.length === 0 && malformed.funnels.length === 0,
    "malformed RPC result executes no side effects",
  );

  for (const invalidIdentity of [
    { provider: "unknown", eventId: "event-1" },
    { provider: "square", eventId: "" },
    { provider: "square", eventId: "   " },
    { provider: "square", eventId: null },
  ]) {
    const invalid = testDependencies();
    let invalidRejected = false;
    try {
      await applyProviderSubscriptionWebhook(
        {
          ...providerPayment(),
          ...invalidIdentity,
        } as unknown as ProviderSubscriptionWebhookInput,
        invalid.dependencies,
      );
    } catch {
      invalidRejected = true;
    }
    assert(invalidRejected, "invalid provider identity is rejected");
    assert(
      invalid.counts().storeCreations === 0 &&
        invalid.counts().userLookups === 0 &&
        invalid.counts().rpcCalls === 0 &&
        invalid.counts().planResolutions === 0 &&
        invalid.counts().nowCalls === 0,
      "invalid provider identity fails before all provider work",
    );
  }

  const invalidPayment = testDependencies();
  let invalidPaymentRejected = false;
  try {
    await applyProviderSubscriptionWebhook(
      providerPayment({ amountUsd: 0 }),
      invalidPayment.dependencies,
    );
  } catch {
    invalidPaymentRejected = true;
  }
  assert(invalidPaymentRejected, "invalid provider payment rejected");
  assert(
    invalidPayment.counts().storeCreations === 0 &&
      invalidPayment.counts().userLookups === 0 &&
      invalidPayment.counts().rpcCalls === 0 &&
      invalidPayment.counts().planResolutions === 0 &&
      invalidPayment.counts().nowCalls === 0,
    "payment validation remains before all provider work",
  );

  const noUser = testDependencies({
    resolvedUserId: null,
    results: [
      atomicResult({
        processed: true,
        replayed: false,
        userId: null,
      }),
    ],
  });
  const noUserResult = await applyProviderSubscriptionWebhook(
    providerPayment(),
    noUser.dependencies,
  );
  assert(
    noUser.rpcArgs[0]?.p_user_id === null,
    "RPC receives explicit null resolved user",
  );
  assert(
    noUserResult.processed &&
      noUserResult.skippedSubscription &&
      noUserResult.userId === null,
    "processed no-user event reports skipped subscription",
  );
  assert(
    noUser.charges.length === 1 && noUser.funnels.length === 1,
    "no-user payment retains existing applicable side effects",
  );

  const inconsistentNoUser = testDependencies({
    resolvedUserId: null,
    results: [[{
      processed: true,
      replayed: false,
      skipped_subscription: false,
      resolved_user_id: null,
      resolved_plan_id: "pro",
      subscription_status: "active",
    }]],
  });
  let inconsistentNoUserRejected = false;
  try {
    await applyProviderSubscriptionWebhook(
      providerPayment(),
      inconsistentNoUser.dependencies,
    );
  } catch {
    inconsistentNoUserRejected = true;
  }
  assert(
    inconsistentNoUserRejected,
    "inconsistent no-user RPC result is rejected",
  );
  assert(
    inconsistentNoUser.charges.length === 0 &&
      inconsistentNoUser.funnels.length === 0,
    "inconsistent no-user result executes no side effects",
  );

  const canceledProvider = testDependencies({
    results: [
      atomicResult({
        processed: true,
        replayed: false,
        status: "canceled",
      }),
    ],
  });
  const canceledProviderResult =
    await applyProviderSubscriptionWebhook(
      {
        provider: "generic_subscription",
        eventId: "cancel-event-1",
        type: "subscription.canceled",
        userId: USER_ID,
        planId: "pro",
        paymentId: null,
        amountUsd: null,
      },
      canceledProvider.dependencies,
    );
  assert(
    canceledProviderResult.processed &&
      canceledProviderResult.status === "canceled",
    "provider cancellation remains supported",
  );
  assert(
    canceledProvider.rpcArgs[0]?.p_payment_id === null &&
      canceledProvider.rpcArgs[0]?.p_amount_usd === null,
    "provider cancellation requires no payment values",
  );
  assert(
    canceledProvider.charges.length === 0 &&
      canceledProvider.funnels.length === 0,
    "cancellation executes no payment side effects",
  );

  const missingTimestampOne = testDependencies({
    now: new Date("2026-09-08T12:00:00.000Z"),
  });
  await applyProviderSubscriptionWebhook(
    providerPayment({ occurredAt: null }),
    missingTimestampOne.dependencies,
  );
  const missingTimestampTwo = testDependencies({
    now: new Date("2030-01-01T00:00:00.000Z"),
  });
  await applyProviderSubscriptionWebhook(
    providerPayment({ occurredAt: "not-a-date" }),
    missingTimestampTwo.dependencies,
  );
  assert(
    missingTimestampOne.rpcArgs[0]?.p_payload_sha256 ===
      missingTimestampTwo.rpcArgs[0]?.p_payload_sha256,
    "processing wall-clock does not alter fingerprint",
  );
  assert(
    missingTimestampOne.rpcArgs[0]?.p_occurred_at === null &&
      missingTimestampTwo.rpcArgs[0]?.p_occurred_at === null &&
      missingTimestampOne.rpcArgs[0]?.p_current_period_end === null &&
      missingTimestampTwo.rpcArgs[0]?.p_current_period_end === null,
    "missing timestamps use database null fallbacks",
  );

  const firstResolution = testDependencies({
    resolvedUserId: null,
    results: [
      atomicResult({
        processed: true,
        replayed: false,
        userId: null,
      }),
    ],
  });
  await applyProviderSubscriptionWebhook(
    providerPayment({ userId: null }),
    firstResolution.dependencies,
  );
  const laterResolution = testDependencies({
    resolvedUserId: OTHER_USER_ID,
    results: [
      atomicResult({
        processed: true,
        replayed: false,
        userId: OTHER_USER_ID,
      }),
    ],
  });
  await applyProviderSubscriptionWebhook(
    providerPayment({ userId: null }),
    laterResolution.dependencies,
  );
  assert(
    firstResolution.rpcArgs[0]?.p_payload_sha256 ===
      laterResolution.rpcArgs[0]?.p_payload_sha256,
    "resolved user changes do not alter fingerprint",
  );
  assert(
    firstResolution.rpcArgs[0]?.p_user_id === null &&
      laterResolution.rpcArgs[0]?.p_user_id === OTHER_USER_ID,
    "RPC still receives current resolved user separately",
  );

  const catalogOne = testDependencies({
    plan: { planId: "pro", monthlyUsd: 99 },
  });
  await applyProviderSubscriptionWebhook(
    providerPayment(),
    catalogOne.dependencies,
  );
  const catalogTwo = testDependencies({
    plan: { planId: "pro", monthlyUsd: 109 },
  });
  await applyProviderSubscriptionWebhook(
    providerPayment(),
    catalogTwo.dependencies,
  );
  assert(
    catalogOne.rpcArgs[0]?.p_payload_sha256 ===
      catalogTwo.rpcArgs[0]?.p_payload_sha256,
    "catalog price changes do not alter fingerprint",
  );
  assert(
    catalogOne.rpcArgs[0]?.p_monthly_usd === 99 &&
      catalogTwo.rpcArgs[0]?.p_monthly_usd === 109,
    "RPC receives current catalog price separately",
  );

  let incompleteEnvelopeRejected = false;
  try {
    await applySubscriptionWebhook({
      ...payment(),
      provider: "square",
    } as ProviderSubscriptionWebhookInput);
  } catch {
    incompleteEnvelopeRejected = true;
  }
  assert(
    incompleteEnvelopeRejected,
    "incomplete provider envelope never uses legacy path",
  );

  const legacyCheckout = readFileSync(
    join(root, "src/app/api/checkout/complete/route.ts"),
    "utf8",
  );
  const squareCheckout = readFileSync(
    join(
      root,
      "src/app/api/payments/square/checkout/complete/route.ts",
    ),
    "utf8",
  );
  for (const checkout of [legacyCheckout, squareCheckout]) {
    assert(
      checkout.includes("applySubscriptionWebhook") &&
        !checkout.includes("eventId") &&
        !checkout.includes("process_subscription_webhook_atomic"),
      "checkout remains outside provider replay RPC",
    );
  }
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
  const providerStart = source.indexOf(
    "export async function applyProviderSubscriptionWebhook",
  );
  const providerEnd = source.indexOf(
    "function resolveProviderWebhookPlan",
  );
  const providerSource = source.slice(providerStart, providerEnd);
  assert(
    providerSource.includes("store.processAtomic(rpcArgs)"),
    "provider path uses the atomic store",
  );
  assert(
    !providerSource.includes('from("subscription_payments")') &&
      !providerSource.includes('from("host_subscriptions")') &&
      !providerSource.includes(".upsert("),
    "provider path performs no direct durable writes",
  );
  assert(
    source.includes('"process_subscription_webhook_atomic"'),
    "provider store calls the replay RPC",
  );
  const providerValidationAt = providerSource.indexOf(
    'throw new Error("Invalid provider webhook event")',
  );
  const paymentValidationAt = providerSource.indexOf(
    "validateSubscriptionWebhookPayment(input)",
  );
  const providerStoreAt = providerSource.indexOf(
    "const store = dependencies.createStore()",
  );
  const fingerprintAt = providerSource.indexOf(
    "subscriptionWebhookFingerprint({",
  );
  const rpcAt = providerSource.indexOf(
    "const rawResult = await store.processAtomic",
  );
  const sideEffectAt = providerSource.indexOf(
    "dependencies.recordCharge",
  );
  assert(
    providerValidationAt >= 0 &&
      providerValidationAt < providerStoreAt &&
      paymentValidationAt >= 0 &&
      paymentValidationAt < providerStoreAt &&
      providerStoreAt < fingerprintAt &&
      fingerprintAt < rpcAt &&
      rpcAt < sideEffectAt,
    "validation, lookup, fingerprint, RPC, and side effects stay ordered",
  );
  const fingerprintStart = source.indexOf(
    "export function subscriptionWebhookFingerprint",
  );
  const fingerprintEnd = source.indexOf(
    "function isRecord",
    fingerprintStart,
  );
  const fingerprintSource = source.slice(
    fingerprintStart,
    fingerprintEnd,
  );
  assert(
    !fingerprintSource.includes("monthlyUsd") &&
      !fingerprintSource.includes("resolvedUserId") &&
      !fingerprintSource.includes("currentPeriodEnd") &&
      !fingerprintSource.includes("dependencies.now"),
    "fingerprint excludes mutable and processing-time values",
  );

  const migrationsDir = join(root, "supabase/migrations");
  const migrationNames = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
  assert(
    !migrationNames.some((name) => /subscription_webhook_integrity|billing_microblock_5/i.test(name)),
    "Microblock 5 creates no migration",
  );

  console.log(
    "subscription webhook payment integrity and replay integration tests passed",
  );
}

runSubscriptionWebhookTests().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "subscription webhook tests failed",
  );
  process.exitCode = 1;
});