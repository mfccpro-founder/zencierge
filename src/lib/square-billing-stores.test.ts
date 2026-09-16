import {
  SquareBillingStoreError,
  assertNoSquareBillingTokenKeys,
  createMemorySquareBillingStores,
  isEnrollableSquareSubscriptionStatus,
  mapSquareSubscriptionStatusToHostStatus,
  serializeSquareBillingStoreError,
  squareBillingValueHasForbiddenTokenKey,
  type CreateSquareSubscriptionIntentInput,
  type SquareCorrelatablePaymentRow,
  type SquareHostSubscriptionPersistence,
  type SquareSubscriptionIntentRow,
} from "./square-billing-stores";
import { isPaidSubscriptionStatus } from "./zencierge-plans";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function assertRejects(
  run: () => Promise<unknown>,
  code: ConstructorParameters<typeof SquareBillingStoreError>[0],
  message: string,
) {
  try {
    await run();
    throw new Error(`${message}: expected rejection`);
  } catch (error) {
    if (!(error instanceof SquareBillingStoreError)) {
      throw new Error(`${message}: store error`);
    }
    assert(error.code === code, `${message}: code ${error.code}`);
  }
}

function assertThrows(
  run: () => unknown,
  code: ConstructorParameters<typeof SquareBillingStoreError>[0],
  message: string,
) {
  try {
    run();
    throw new Error(`${message}: expected throw`);
  } catch (error) {
    if (!(error instanceof SquareBillingStoreError)) {
      throw new Error(`${message}: store error`);
    }
    assert(error.code === code, `${message}: code ${error.code}`);
  }
}

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const PAYMENT_ID = "33333333-3333-4333-8333-333333333333";
const BASE_MS = Date.parse("2026-09-10T12:00:00.000Z");

function createClock(startMs = BASE_MS) {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
    iso() {
      return new Date(current).toISOString();
    },
  };
}

function createUuidSource(prefix = "aaaaaaaa-aaaa-4aaa-8aaa") {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}-${sequence.toString(16).padStart(12, "0")}`;
  };
}

function intentInput(
  overrides: Partial<CreateSquareSubscriptionIntentInput> = {},
): CreateSquareSubscriptionIntentInput {
  return {
    userId: USER_A,
    planId: "starter",
    billingCycle: "monthly",
    billingAmountUsd: 49,
    squareEnvironment: "sandbox",
    squareLocationId: "LOC_SANDBOX",
    squarePlanVariationId: "PLAN_VAR_STARTER_MONTHLY",
    complimentaryUntil: null,
    expiresAt: "2026-09-10T18:00:00.000Z",
    ...overrides,
  };
}

async function openCardReadyStore(options?: {
  clock?: ReturnType<typeof createClock>;
  uuid?: () => string;
}) {
  const clock = options?.clock ?? createClock();
  const stores = createMemorySquareBillingStores({
    now: clock.now,
    uuid: options?.uuid ?? createUuidSource(),
  });
  const created = await stores.intents.createIntent(intentInput());
  await stores.intents.recordCustomer({
    intentId: created.intent.id,
    squareCustomerId: "CUSTOMER_A",
  });
  const payment = await stores.paymentMethods.persistPaymentMethod({
    intentId: created.intent.id,
    squareCardId: "CARD_A",
    cardBrand: "VISA",
    last4: "4242",
    expMonth: 12,
    expYear: 2030,
    consentedAt: clock.iso(),
  });
  return { clock, stores, intentId: created.intent.id, payment };
}

async function openCompletedStore() {
  const setup = await openCardReadyStore();
  const persisted = await setup.stores.intents.persistSubscription({
    intentId: setup.intentId,
    squareSubscriptionId: "SUB_A",
    squareSubscriptionStatus: "ACTIVE",
    squareSubscriptionVersion: 1,
    startDate: "2026-09-10",
    chargedThroughDate: "2026-10-10",
    canceledDate: null,
  });
  return { ...setup, subscription: persisted.subscription };
}

export async function runSquareBillingStoresTests() {
  // 0. SQUARE STATUS -> LOCAL ENTITLEMENT
  {
    assert(isEnrollableSquareSubscriptionStatus("ACTIVE"), "ACTIVE is enrollable");
    assert(!isEnrollableSquareSubscriptionStatus("PENDING"), "PENDING not enrollable");
    assert(!isEnrollableSquareSubscriptionStatus("PAUSED"), "PAUSED not enrollable");
    assert(!isEnrollableSquareSubscriptionStatus("CANCELED"), "CANCELED not enrollable");
    assert(
      !isEnrollableSquareSubscriptionStatus("DEACTIVATED"),
      "DEACTIVATED not enrollable",
    );
    assert(mapSquareSubscriptionStatusToHostStatus("ACTIVE") === "active", "ACTIVE->active");
    assert(mapSquareSubscriptionStatusToHostStatus("PENDING") === "inactive", "PENDING->inactive");
    assert(mapSquareSubscriptionStatusToHostStatus("PAUSED") === "inactive", "PAUSED->inactive");
    assert(mapSquareSubscriptionStatusToHostStatus("DEACTIVATED") === "inactive", "DEACTIVATED->inactive");
    assert(mapSquareSubscriptionStatusToHostStatus("CANCELED") === "canceled", "CANCELED->canceled");
    assert(
      isPaidSubscriptionStatus("active") &&
        !isPaidSubscriptionStatus("inactive") &&
        !isPaidSubscriptionStatus("canceled"),
      "only local active grants entitlement",
    );
    assertThrows(
      () => mapSquareSubscriptionStatusToHostStatus("UNKNOWN"),
      "invalid_input",
      "unsupported Square status rejected",
    );
  }

  // 1. INTENT CREATION
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource(),
    });
    const created = await stores.intents.createIntent(intentInput());
    assert(created.replayed === false, "createIntent first write");
    assert(created.intent.status === "pending", "createIntent pending");
    assert(created.intent.user_id === USER_A, "createIntent user");
    assert(created.intent.plan_id === "starter", "createIntent plan");
    assert(created.intent.billing_cycle === "monthly", "createIntent cycle");
    assert(created.intent.billing_amount_usd === 49, "createIntent amount");
    assert(created.intent.square_environment === "sandbox", "createIntent env");
    assert(created.intent.square_customer_id === null, "createIntent no customer");
    assert(created.intent.square_card_id === null, "createIntent no card");
    assert(
      created.intent.square_subscription_id === null,
      "createIntent no subscription",
    );
    assert(
      created.intent.customer_idempotency_key.length > 0,
      "createIntent customer key",
    );
    assert(
      created.intent.card_idempotency_key.length > 0,
      "createIntent card key",
    );
    assert(
      created.intent.subscription_idempotency_key.length > 0,
      "createIntent subscription key",
    );

    const replay = await stores.intents.createIntent(intentInput());
    assert(replay.replayed === true, "exact createIntent replay");
    assert(replay.intent.id === created.intent.id, "replay same intent id");

    await assertRejects(
      () =>
        stores.intents.createIntent(
          intentInput({ billingAmountUsd: 99, planId: "pro" }),
        ),
      "conflict",
      "changed open-intent payload conflicts",
    );

    await assertRejects(
      () =>
        stores.intents.createIntent({
          ...intentInput(),
          sourceId: "tok_forbidden",
        } as CreateSquareSubscriptionIntentInput & { sourceId: string }),
      "invalid_input",
      "forbidden token-shaped createIntent key",
    );
  }

  // 2. CUSTOMER CORRELATION
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("bbbbbbbb-bbbb-4bbb-8bbb"),
    });
    const created = await stores.intents.createIntent(intentInput());
    const first = await stores.intents.recordCustomer({
      intentId: created.intent.id,
      squareCustomerId: "CUSTOMER_A",
    });
    assert(first.replayed === false, "recordCustomer first write");
    assert(first.intent.status === "customer_ready", "customer_ready status");
    assert(
      first.intent.square_customer_id === "CUSTOMER_A",
      "customer id attached",
    );

    const replay = await stores.intents.recordCustomer({
      intentId: created.intent.id,
      squareCustomerId: "CUSTOMER_A",
    });
    assert(replay.replayed === true, "recordCustomer exact replay");

    await assertRejects(
      () =>
        stores.intents.recordCustomer({
          intentId: created.intent.id,
          squareCustomerId: "CUSTOMER_B",
        }),
      "conflict",
      "conflicting customer id",
    );
  }

  // 3. PAYMENT METHOD
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("cccccccc-cccc-4ccc-8ccc"),
    });
    const created = await stores.intents.createIntent(intentInput());
    await stores.intents.recordCustomer({
      intentId: created.intent.id,
      squareCustomerId: "CUSTOMER_A",
    });
    const first = await stores.paymentMethods.persistPaymentMethod({
      intentId: created.intent.id,
      squareCardId: "CARD_A",
      cardBrand: "VISA",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      consentedAt: clock.iso(),
    });
    assert(first.replayed === false, "persistPaymentMethod first write");
    assert(first.intent.status === "card_ready", "intent advances to card_ready");
    assert(first.intent.square_card_id === "CARD_A", "intent card associated");
    assert(
      first.paymentMethod.square_customer_id === "CUSTOMER_A",
      "payment method customer",
    );
    assert(first.paymentMethod.enabled === true, "payment method enabled");

    const replay = await stores.paymentMethods.persistPaymentMethod({
      intentId: created.intent.id,
      squareCardId: "CARD_A",
      cardBrand: "VISA",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      consentedAt: clock.iso(),
    });
    assert(replay.replayed === true, "persistPaymentMethod exact replay");

    await assertRejects(
      () =>
        stores.paymentMethods.persistPaymentMethod({
          intentId: created.intent.id,
          squareCardId: "CARD_B",
          cardBrand: "VISA",
          last4: "4242",
          expMonth: 12,
          expYear: 2030,
          consentedAt: clock.iso(),
        }),
      "conflict",
      "conflicting payment method replay",
    );

    const listed = await stores.paymentMethods.listPaymentMethods(
      USER_A,
      "sandbox",
    );
    assert(listed.length === 1, "list returns one payment method");
    assert(listed[0]?.square_card_id === "CARD_A", "list returns expected card");

    const disabled = await stores.paymentMethods.disablePaymentMethod({
      paymentMethodId: first.paymentMethod.id,
    });
    assert(disabled.enabled === false, "disable marks method disabled");
    const disabledAgain = await stores.paymentMethods.disablePaymentMethod({
      paymentMethodId: first.paymentMethod.id,
    });
    assert(disabledAgain.enabled === false, "disable twice remains disabled");
    assert(
      disabledAgain.updated_at === disabled.updated_at,
      "second disable is idempotent on timestamp",
    );
  }

  // 4. SUBSCRIPTION PERSISTENCE
  {
    const { stores, intentId } = await openCardReadyStore({
      uuid: createUuidSource("dddddddd-dddd-4ddd-8ddd"),
    });
    const first = await stores.intents.persistSubscription({
      intentId,
      squareSubscriptionId: "SUB_A",
      squareSubscriptionStatus: "ACTIVE",
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: "2026-10-10",
      canceledDate: null,
    });
    assert(first.replayed === false, "persistSubscription first write");
    assert(first.intent.status === "completed", "persistSubscription completes");
    assert(
      first.intent.square_subscription_id === "SUB_A",
      "intent subscription id",
    );
    const expected: SquareHostSubscriptionPersistence = {
      user_id: USER_A,
      plan_id: "starter",
      billing_cycle: "monthly",
      billing_amount_usd: 49,
      square_environment: "sandbox",
      square_location_id: "LOC_SANDBOX",
      square_plan_variation_id: "PLAN_VAR_STARTER_MONTHLY",
      square_customer_id: "CUSTOMER_A",
      square_subscription_id: "SUB_A",
      square_subscription_status: "ACTIVE",
      square_subscription_version: 1,
      square_start_date: "2026-09-10",
      square_charged_through_date: "2026-10-10",
      square_canceled_date: null,
      complimentary_ends_at: null,
    };
    assert(
      JSON.stringify(first.subscription) === JSON.stringify(expected),
      "allowed host subscription correlation fields",
    );

    const replay = await stores.intents.persistSubscription({
      intentId,
      squareSubscriptionId: "SUB_A",
      squareSubscriptionStatus: "ACTIVE",
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: "2026-10-10",
      canceledDate: null,
    });
    assert(replay.replayed === true, "persistSubscription exact replay");

    await assertRejects(
      () =>
        stores.intents.persistSubscription({
          intentId,
          squareSubscriptionId: "SUB_A",
          squareSubscriptionStatus: "CANCELED",
          squareSubscriptionVersion: 1,
          startDate: "2026-09-10",
          chargedThroughDate: "2026-10-10",
          canceledDate: null,
        }),
      "conflict",
      "conflicting Square subscription data",
    );
    await assertRejects(
      () =>
        stores.intents.persistSubscription({
          intentId,
          squareSubscriptionId: "SUB_B",
          squareSubscriptionStatus: "ACTIVE",
          squareSubscriptionVersion: 1,
          startDate: "2026-09-10",
          chargedThroughDate: "2026-10-10",
          canceledDate: null,
        }),
      "invalid_lifecycle",
      "different subscription id after completed is rejected",
    );

    const pendingOnly = createMemorySquareBillingStores({
      now: createClock().now,
      uuid: createUuidSource("eeeeeeee-eeee-4eee-8eee"),
    });
    const pending = await pendingOnly.intents.createIntent(intentInput());
    await assertRejects(
      () =>
        pendingOnly.intents.persistSubscription({
          intentId: pending.intent.id,
          squareSubscriptionId: "SUB_X",
          squareSubscriptionStatus: "ACTIVE",
          squareSubscriptionVersion: 1,
          startDate: "2026-09-10",
          chargedThroughDate: null,
          canceledDate: null,
        }),
      "invalid_lifecycle",
      "required lifecycle fields enforced before persistSubscription",
    );
  }

  {
    const prefixes: Record<string, string> = {
      PENDING: "aa11aa11-aa11-4aa1-8aa1",
      PAUSED: "bb22bb22-bb22-4bb2-8bb2",
      DEACTIVATED: "cc33cc33-cc33-4cc3-8cc3",
      CANCELED: "dd44dd44-dd44-4dd4-8dd4",
    };
    for (const status of ["PENDING", "PAUSED", "DEACTIVATED", "CANCELED"] as const) {
      const { stores, intentId } = await openCardReadyStore({
        uuid: createUuidSource(prefixes[status]),
      });
      const result = await stores.intents.persistSubscription({
        intentId,
        squareSubscriptionId: `SUB_${status}`,
        squareSubscriptionStatus: status,
        squareSubscriptionVersion: 1,
        startDate: "2026-09-10",
        chargedThroughDate: null,
        canceledDate: status === "CANCELED" ? "2026-09-10" : null,
      });
      assert(result.replayed === false, `${status} persist writes`);
      assert(result.intent.status === "card_ready", `${status} does not complete intent`);
      assert(
        result.intent.square_subscription_id === null,
        `${status} does not attach subscription id`,
      );
      assert(
        result.subscription.square_subscription_status === status,
        `${status} keeps raw Square status`,
      );
      const local = mapSquareSubscriptionStatusToHostStatus(status);
      assert(
        (status === "CANCELED" ? local === "canceled" : local === "inactive") &&
          !isPaidSubscriptionStatus(local),
        `${status} maps without paid entitlement`,
      );
    }
    const { stores, intentId } = await openCardReadyStore({
      uuid: createUuidSource("cdcdcdcd-cdcd-4cdc-8cdc"),
    });
    await assertRejects(
      () =>
        stores.intents.persistSubscription({
          intentId,
          squareSubscriptionId: "SUB_UNKNOWN",
          squareSubscriptionStatus: "UNKNOWN",
          squareSubscriptionVersion: 1,
          startDate: "2026-09-10",
          chargedThroughDate: null,
          canceledDate: null,
        }),
      "invalid_input",
      "unsupported Square status is not persisted",
    );
  }

  // 5. INTENT TERMINAL STATES
  {
    const completed = await openCardReadyStore({
      uuid: createUuidSource("ffffffff-ffff-4fff-8fff"),
    });
    const ready = await completed.stores.intents.persistSubscription({
      intentId: completed.intentId,
      squareSubscriptionId: "SUB_COMPLETE",
      squareSubscriptionStatus: "ACTIVE",
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: null,
      canceledDate: null,
    });
    assert(ready.intent.status === "completed", "persist completes intent");
    const completeReplay = await completed.stores.intents.completeIntent({
      intentId: completed.intentId,
    });
    assert(completeReplay.replayed === true, "complete on completed is replay");

    const failSetup = await openCardReadyStore({
      uuid: createUuidSource("a1a1a1a1-a1a1-41a1-81a1"),
    });
    const failed = await failSetup.stores.intents.failIntent({
      intentId: failSetup.intentId,
      errorCode: "CARD_DECLINED",
    });
    assert(failed.replayed === false, "failIntent first write");
    assert(failed.intent.status === "failed", "failIntent status");
    assert(
      failed.intent.last_error_code === "CARD_DECLINED",
      "failIntent error code",
    );
    const failReplay = await failSetup.stores.intents.failIntent({
      intentId: failSetup.intentId,
      errorCode: "CARD_DECLINED",
    });
    assert(failReplay.replayed === true, "failIntent exact replay");
    await assertRejects(
      () =>
        failSetup.stores.intents.failIntent({
          intentId: failSetup.intentId,
          errorCode: "OTHER",
        }),
      "conflict",
      "failIntent conflicting error code",
    );
    await assertRejects(
      () =>
        failSetup.stores.intents.completeIntent({
          intentId: failSetup.intentId,
        }),
      "invalid_lifecycle",
      "complete after fail rejected",
    );

    const expireClock = createClock();
    const expireStores = createMemorySquareBillingStores({
      now: expireClock.now,
      uuid: createUuidSource("b2b2b2b2-b2b2-42b2-82b2"),
    });
    const expiring = await expireStores.intents.createIntent(
      intentInput({ expiresAt: "2026-09-10T12:00:01.000Z" }),
    );
    expireClock.advance(2_000);
    const expired = await expireStores.intents.expireIntent({
      intentId: expiring.intent.id,
    });
    assert(expired.replayed === false, "expireIntent first write");
    assert(expired.intent.status === "expired", "expireIntent status");
    const expireReplay = await expireStores.intents.expireIntent({
      intentId: expiring.intent.id,
    });
    assert(expireReplay.replayed === true, "expireIntent exact replay");

    const earlyClock = createClock();
    const earlyStores = createMemorySquareBillingStores({
      now: earlyClock.now,
      uuid: createUuidSource("c3c3c3c3-c3c3-43c3-83c3"),
    });
    const early = await earlyStores.intents.createIntent(intentInput());
    await assertRejects(
      () => earlyStores.intents.expireIntent({ intentId: early.intent.id }),
      "invalid_lifecycle",
      "expire before expires_at rejected",
    );
    await assertRejects(
      () => earlyStores.intents.completeIntent({ intentId: early.intent.id }),
      "invalid_lifecycle",
      "complete from pending rejected",
    );
  }

  // 6. INVOICE PERSISTENCE
  {
    const { stores } = await openCompletedStore();
    const first = await stores.invoicePayments.persistInvoice({
      squareEnvironment: "sandbox",
      squareInvoiceId: "INV_A",
      squareSubscriptionId: "SUB_A",
      squareOrderId: "ORDER_A",
      squareInvoiceStatus: "PAID",
      squareInvoiceVersion: 1,
      amountUsd: 49,
      currency: "USD",
      dueDate: "2026-09-10",
      paidAt: "2026-09-10T12:05:00.000Z",
    });
    assert(first.replayed === false, "persistInvoice first write");
    assert(first.invoice.square_invoice_id === "INV_A", "invoice id");
    assert(first.invoice.user_id === USER_A, "invoice user from subscription");
    assert(first.invoice.plan_id === "starter", "invoice plan from subscription");

    const replay = await stores.invoicePayments.persistInvoice({
      squareEnvironment: "sandbox",
      squareInvoiceId: "INV_A",
      squareSubscriptionId: "SUB_A",
      squareOrderId: "ORDER_A",
      squareInvoiceStatus: "PAID",
      squareInvoiceVersion: 1,
      amountUsd: 49,
      currency: "USD",
      dueDate: "2026-09-10",
      paidAt: "2026-09-10T12:05:00.000Z",
    });
    assert(replay.replayed === true, "persistInvoice exact replay");

    const newer = await stores.invoicePayments.persistInvoice({
      squareEnvironment: "sandbox",
      squareInvoiceId: "INV_A",
      squareSubscriptionId: "SUB_A",
      squareOrderId: "ORDER_A",
      squareInvoiceStatus: "CANCELED",
      squareInvoiceVersion: 2,
      amountUsd: 49,
      currency: "USD",
      dueDate: "2026-09-10",
      paidAt: null,
    });
    assert(newer.replayed === false, "newer invoice version updates");
    assert(
      newer.invoice.square_invoice_status === "CANCELED",
      "newer version status applied",
    );
    assert(newer.invoice.square_invoice_version === 2, "newer version stored");

    await assertRejects(
      () =>
        stores.invoicePayments.persistInvoice({
          squareEnvironment: "sandbox",
          squareInvoiceId: "INV_A",
          squareSubscriptionId: "SUB_A",
          squareOrderId: "ORDER_A",
          squareInvoiceStatus: "PAID",
          squareInvoiceVersion: 1,
          amountUsd: 49,
          currency: "USD",
          dueDate: "2026-09-10",
          paidAt: "2026-09-10T12:05:00.000Z",
        }),
      "conflict",
      "older invoice version does not overwrite",
    );

    await assertRejects(
      () =>
        stores.invoicePayments.persistInvoice({
          squareEnvironment: "sandbox",
          squareInvoiceId: "INV_A",
          squareSubscriptionId: "SUB_A",
          squareOrderId: "ORDER_B",
          squareInvoiceStatus: "CANCELED",
          squareInvoiceVersion: 2,
          amountUsd: 49,
          currency: "USD",
          dueDate: "2026-09-10",
          paidAt: null,
        }),
      "conflict",
      "same-version conflicting payload rejected",
    );
  }

  // 7. PAYMENT CORRELATION
  {
    const paymentSeed: SquareCorrelatablePaymentRow = {
      id: PAYMENT_ID,
      provider_payment_id: "PAY_A",
      billing_cycle: null,
      square_environment: null,
      square_location_id: null,
      square_subscription_id: null,
      square_invoice_id: null,
      square_order_id: null,
    };
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("d4d4d4d4-d4d4-44d4-84d4"),
      payments: [paymentSeed],
    });
    const created = await stores.intents.createIntent(intentInput());
    await stores.intents.recordCustomer({
      intentId: created.intent.id,
      squareCustomerId: "CUSTOMER_A",
    });
    await stores.paymentMethods.persistPaymentMethod({
      intentId: created.intent.id,
      squareCardId: "CARD_A",
      cardBrand: "VISA",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      consentedAt: clock.iso(),
    });
    await stores.intents.persistSubscription({
      intentId: created.intent.id,
      squareSubscriptionId: "SUB_A",
      squareSubscriptionStatus: "ACTIVE",
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: null,
      canceledDate: null,
    });
    await stores.invoicePayments.persistInvoice({
      squareEnvironment: "sandbox",
      squareInvoiceId: "INV_A",
      squareSubscriptionId: "SUB_A",
      squareOrderId: "ORDER_A",
      squareInvoiceStatus: "PAID",
      squareInvoiceVersion: 1,
      amountUsd: 49,
      currency: "USD",
      dueDate: "2026-09-10",
      paidAt: clock.iso(),
    });

    const first = await stores.invoicePayments.correlatePayment({
      providerPaymentId: "PAY_A",
      squareEnvironment: "sandbox",
      squareInvoiceId: "INV_A",
      squareOrderId: "ORDER_A",
      squareSubscriptionId: "SUB_A",
    });
    assert(first.correlated === true, "correlatePayment succeeds");
    assert(first.replayed === false, "correlatePayment first fill");
    if (!first.correlated) throw new Error("unreachable");
    assert(first.payment.billing_cycle === "monthly", "filled billing_cycle");
    assert(first.payment.square_environment === "sandbox", "filled environment");
    assert(first.payment.square_location_id === "LOC_SANDBOX", "filled location");
    assert(
      first.payment.square_subscription_id === "SUB_A",
      "filled subscription",
    );
    assert(first.payment.square_invoice_id === "INV_A", "filled invoice");
    assert(first.payment.square_order_id === "ORDER_A", "filled order");
    assert(first.invoice.square_invoice_id === "INV_A", "invoice linkage kept");

    const replay = await stores.invoicePayments.correlatePayment({
      providerPaymentId: "PAY_A",
      squareEnvironment: "sandbox",
      squareInvoiceId: "INV_A",
      squareOrderId: "ORDER_A",
      squareSubscriptionId: "SUB_A",
    });
    assert(replay.correlated === true && replay.replayed === true, "correlate replay");

    const conflictStores = createMemorySquareBillingStores({
      now: createClock().now,
      uuid: createUuidSource("e5e5e5e5-e5e5-45e5-85e5"),
      payments: [
        {
          ...paymentSeed,
          id: "44444444-4444-4444-8444-444444444444",
          provider_payment_id: "PAY_B",
          square_invoice_id: "INV_OTHER",
        },
      ],
      subscriptions: [
        {
          user_id: USER_A,
          plan_id: "starter",
          billing_cycle: "monthly",
          billing_amount_usd: 49,
          square_environment: "sandbox",
          square_location_id: "LOC_SANDBOX",
          square_plan_variation_id: "PLAN_VAR_STARTER_MONTHLY",
          square_customer_id: "CUSTOMER_A",
          square_subscription_id: "SUB_B",
          square_subscription_status: "ACTIVE",
          square_subscription_version: 1,
          square_start_date: "2026-09-10",
          square_charged_through_date: null,
          square_canceled_date: null,
          complimentary_ends_at: null,
        },
      ],
      invoices: [
        {
          square_environment: "sandbox",
          square_invoice_id: "INV_B",
          square_subscription_id: "SUB_B",
          square_order_id: "ORDER_B",
          square_location_id: "LOC_SANDBOX",
          user_id: USER_A,
          plan_id: "starter",
          billing_cycle: "monthly",
          square_plan_variation_id: "PLAN_VAR_STARTER_MONTHLY",
          square_invoice_status: "PAID",
          square_invoice_version: 1,
          amount_usd: 49,
          currency: "USD",
          due_date: "2026-09-10",
          paid_at: "2026-09-10T12:05:00.000Z",
          created_at: "2026-09-10T12:00:00.000Z",
          updated_at: "2026-09-10T12:00:00.000Z",
        },
      ],
    });
    await assertRejects(
      () =>
        conflictStores.invoicePayments.correlatePayment({
          providerPaymentId: "PAY_B",
          squareEnvironment: "sandbox",
          squareInvoiceId: "INV_B",
          squareOrderId: "ORDER_B",
          squareSubscriptionId: "SUB_B",
        }),
      "conflict",
      "conflicting already-populated Square fields rejected",
    );
  }

  // 8. VALIDATION / SAFETY
  {
    assert(
      squareBillingValueHasForbiddenTokenKey({ paymentToken: "x" }) === true,
      "detects paymentToken",
    );
    assert(
      squareBillingValueHasForbiddenTokenKey({ squareCardId: "CARD" }) === false,
      "allows squareCardId",
    );
    assertThrows(
      () => assertNoSquareBillingTokenKeys({ sourceId: "x" }),
      "invalid_input",
      "assertNoSquareBillingTokenKeys rejects sourceId",
    );

    const stores = createMemorySquareBillingStores({
      now: createClock().now,
      uuid: createUuidSource("f6f6f6f6-f6f6-46f6-86f6"),
    });
    await assertRejects(
      () => stores.intents.createIntent(intentInput({ planId: "enterprise" as never })),
      "invalid_input",
      "invalid plan rejected",
    );
    await assertRejects(
      () =>
        stores.intents.createIntent(
          intentInput({ billingCycle: "weekly" as never }),
        ),
      "invalid_input",
      "invalid billing cycle rejected",
    );
    await assertRejects(
      () =>
        stores.intents.createIntent(
          intentInput({ squareEnvironment: "staging" as never }),
        ),
      "invalid_input",
      "invalid environment rejected",
    );
    await assertRejects(
      () =>
        stores.intents.createIntent(intentInput({ billingAmountUsd: 49.001 })),
      "invalid_input",
      "money cent rounding rejected",
    );

    const completed = await openCompletedStore();
    await assertRejects(
      () =>
        completed.stores.invoicePayments.persistInvoice({
          squareEnvironment: "sandbox",
          squareInvoiceId: "INV_CUR",
          squareSubscriptionId: "SUB_A",
          squareOrderId: null,
          squareInvoiceStatus: "PAID",
          squareInvoiceVersion: 1,
          amountUsd: 49,
          currency: "USD-TOO-LONG-VALUE",
          dueDate: null,
          paidAt: null,
        }),
      "invalid_input",
      "currency length validation",
    );

    assertThrows(
      () =>
        createMemorySquareBillingStores({
          now: createClock().now,
          uuid: createUuidSource("a7a7a7a7-a7a7-47a7-87a7"),
          intents: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              user_id: USER_A,
              plan_id: "starter",
              billing_cycle: "monthly",
              billing_amount_usd: 49,
              status: "not_a_status" as SquareSubscriptionIntentRow["status"],
              square_environment: "sandbox",
              square_location_id: "LOC",
              square_plan_variation_id: "PLAN",
              square_customer_id: null,
              square_card_id: null,
              square_subscription_id: null,
              customer_idempotency_key: "key-customer",
              card_idempotency_key: "key-card",
              subscription_idempotency_key: "key-sub",
              complimentary_until: null,
              expires_at: "2026-09-10T18:00:00.000Z",
              last_error_code: null,
              created_at: "2026-09-10T12:00:00.000Z",
              updated_at: "2026-09-10T12:00:00.000Z",
            },
          ],
        }),
      "invalid_input",
      "invalid seeded status rejected",
    );
  }

  // 9. SNAPSHOT
  {
    const { stores, intentId } = await openCompletedStore();
    await stores.invoicePayments.persistInvoice({
      squareEnvironment: "sandbox",
      squareInvoiceId: "INV_SNAP",
      squareSubscriptionId: "SUB_A",
      squareOrderId: "ORDER_SNAP",
      squareInvoiceStatus: "PAID",
      squareInvoiceVersion: 1,
      amountUsd: 49,
      currency: "USD",
      dueDate: "2026-09-10",
      paidAt: "2026-09-10T12:05:00.000Z",
    });
    const snapshot = stores.snapshot();
    assert(snapshot.intents.length === 1, "snapshot intents");
    assert(snapshot.intents[0]?.id === intentId, "snapshot intent id");
    assert(snapshot.paymentMethods.length === 1, "snapshot payment methods");
    assert(snapshot.invoices.length === 1, "snapshot invoices");
    assert(snapshot.subscriptions.length === 1, "snapshot subscriptions");
    assert(snapshot.payments.length === 0, "snapshot payments empty by default");

    snapshot.intents[0]!.status = "failed";
    snapshot.paymentMethods[0]!.enabled = false;
    snapshot.invoices[0]!.square_invoice_status = "MUTATED";
    snapshot.subscriptions[0]!.square_subscription_id = "MUTATED";

    const again = stores.snapshot();
    assert(again.intents[0]?.status === "completed", "snapshot clone protects intent");
    assert(
      again.paymentMethods[0]?.enabled === true,
      "snapshot clone protects payment method",
    );
    assert(
      again.invoices[0]?.square_invoice_status === "PAID",
      "snapshot clone protects invoice",
    );
    assert(
      again.subscriptions[0]?.square_subscription_id === "SUB_A",
      "snapshot clone protects subscription",
    );
  }

  // 10. ERROR CONTRACT
  {
    const error = new SquareBillingStoreError("conflict");
    assert(error.code === "conflict", "error code");
    assert(
      error.message === "Square billing store conflict",
      "error message",
    );
    assert(
      JSON.stringify(error.toJSON()) ===
        JSON.stringify({
          name: "SquareBillingStoreError",
          code: "conflict",
          message: "Square billing store conflict",
        }),
      "error toJSON",
    );
    assert(
      JSON.stringify(serializeSquareBillingStoreError(error)) ===
        JSON.stringify(error.toJSON()),
      "serialize store error",
    );
    assert(
      JSON.stringify(serializeSquareBillingStoreError(new Error("boom"))) ===
        JSON.stringify({
          name: "SquareBillingStoreError",
          code: "unavailable",
          message: "Square billing store is unavailable",
        }),
      "non-store errors serialize safely",
    );
    assert(
      JSON.stringify(serializeSquareBillingStoreError("raw")) ===
        JSON.stringify({
          name: "SquareBillingStoreError",
          code: "unavailable",
          message: "Square billing store is unavailable",
        }),
      "non-error values serialize safely",
    );

    // keep USER_B referenced for future multi-user conflict seeds
    assert(USER_B.startsWith("2222"), "secondary user constant available");
  }

  console.log("square-billing-stores tests passed");
}

void runSquareBillingStoresTests();
