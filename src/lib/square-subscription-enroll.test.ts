import {
  createMemorySquareBillingStores,
  squareBillingValueHasForbiddenTokenKey,
  type CreateSquareSubscriptionIntentInput,
  type SquareBillingStores,
} from "./square-billing-stores";
import {
  buildSquareCreateCardRequest,
  buildSquareCreateSubscriptionRequest,
  enrollSquareSubscription,
  extractSafeSquareErrorDiagnostic,
  mapEnrollErrorToHttpStatus,
  resolveSquareCustomerEmail,
  SquareSubscriptionEnrollError,
  type EnrollSquareSubscriptionInput,
  type SquareEnrollClient,
  type SquareEnrollCreateCardRequest,
  type SquareEnrollCreateSubscriptionRequest,
} from "./square-subscription-enroll";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const BASE_MS = Date.parse("2026-09-10T12:00:00.000Z");

function createClock(startMs = BASE_MS) {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
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

type MockSquareState = {
  customersCreated: number;
  cardsCreated: number;
  subscriptionsCreated: number;
  lastCardRequest: SquareEnrollCreateCardRequest | null;
  lastSubscriptionRequest: SquareEnrollCreateSubscriptionRequest | null;
  customerByEmail: Map<string, string>;
  failCardOnce: boolean;
  failSubscriptionOnce: boolean;
  failSubscriptionPersistAfterCreate: boolean;
  failCustomerSearchOnce: boolean;
  failCustomerCreateOnce: boolean;
  customerSearchError: unknown;
  customerCreateError: unknown;
  lastCustomerSearchEmail: string | null;
  lastCustomerCreateEmail: string | null;
};

function createMockSquare(options?: {
  state?: Partial<MockSquareState>;
  subscriptionId?: string;
  subscriptionStatus?: string;
}): { client: SquareEnrollClient; state: MockSquareState } {
  const state: MockSquareState = {
    customersCreated: 0,
    cardsCreated: 0,
    subscriptionsCreated: 0,
    lastCardRequest: null,
    lastSubscriptionRequest: null,
    customerByEmail: new Map([["host@example.com", "CUSTOMER_EXISTING"]]),
    failCardOnce: false,
    failSubscriptionOnce: false,
    failSubscriptionPersistAfterCreate: false,
    failCustomerSearchOnce: false,
    failCustomerCreateOnce: false,
    customerSearchError: {
      statusCode: 401,
      errors: [
        {
          category: "AUTHENTICATION_ERROR",
          code: "UNAUTHORIZED",
          detail: "This request could not be authorized.",
        },
      ],
    },
    customerCreateError: {
      statusCode: 400,
      body: {
        errors: [
          {
            category: "INVALID_REQUEST_ERROR",
            code: "INVALID_EMAIL_ADDRESS",
            detail: "Invalid email address.",
            field: "email_address",
          },
        ],
      },
    },
    lastCustomerSearchEmail: null,
    lastCustomerCreateEmail: null,
    ...options?.state,
  };

  const client: SquareEnrollClient = {
    customers: {
      async search(input) {
        if (state.failCustomerSearchOnce) {
          state.failCustomerSearchOnce = false;
          throw state.customerSearchError;
        }
        const email = input.query.filter.emailAddress.exact;
        state.lastCustomerSearchEmail = email;
        const id = state.customerByEmail.get(email);
        return { customers: id ? [{ id }] : [] };
      },
      async create(input) {
        if (state.failCustomerCreateOnce) {
          state.failCustomerCreateOnce = false;
          throw state.customerCreateError;
        }
        state.customersCreated += 1;
        state.lastCustomerCreateEmail = input.emailAddress;
        const id = `CUSTOMER_NEW_${state.customersCreated}`;
        state.customerByEmail.set(input.emailAddress, id);
        return { customer: { id } };
      },
    },
    cards: {
      async create(input) {
        if (state.failCardOnce) {
          state.failCardOnce = false;
          throw new Error("square card boom");
        }
        state.cardsCreated += 1;
        state.lastCardRequest = input;
        return {
          card: {
            id: `CARD_${state.cardsCreated}`,
            cardBrand: "VISA",
            last4: "4242",
            expMonth: 12,
            expYear: 2030,
          },
        };
      },
    },
    subscriptions: {
      async create(input) {
        if (state.failSubscriptionOnce) {
          state.failSubscriptionOnce = false;
          throw new Error("square subscription boom");
        }
        state.subscriptionsCreated += 1;
        state.lastSubscriptionRequest = input;
        return {
          subscription: {
            id: options?.subscriptionId ?? "SUB_A",
            status: options?.subscriptionStatus ?? "ACTIVE",
            version: 1,
            startDate: "2026-09-10",
            chargedThroughDate: "2026-10-10",
            canceledDate: null,
          },
        };
      },
    },
  };

  return { client, state };
}

async function createPendingIntent(stores: SquareBillingStores) {
  const created = await stores.intents.createIntent(intentInput());
  return created.intent;
}

function baseEnrollInput(
  overrides: Partial<EnrollSquareSubscriptionInput> = {},
): EnrollSquareSubscriptionInput {
  return {
    intentId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    userId: USER_A,
    email: "host@example.com",
    sourceId: "cnon:test-source",
    ...overrides,
  };
}

export async function runSquareSubscriptionEnrollTests() {
  // request builders
  {
    const card = buildSquareCreateCardRequest({
      cardIdempotencyKey: "card-key",
      sourceId: "cnon:abc",
      customerId: "CUST_1",
      verificationToken: "verify-1",
      cardholderName: "Ada Lovelace",
      postalCode: "10003",
      referenceId: USER_A,
    });
    assert(card.idempotencyKey === "card-key", "card idempotency");
    assert(card.sourceId === "cnon:abc", "card source");
    assert(card.verificationToken === "verify-1", "card verify");
    assert(card.card.customerId === "CUST_1", "card customer");
    assert(card.card.cardholderName === "Ada Lovelace", "card name");
    assert(card.card.billingAddress?.postalCode === "10003", "card postal");
    assert(card.card.referenceId === USER_A, "card reference");

    const withoutOptional = buildSquareCreateCardRequest({
      cardIdempotencyKey: "card-key",
      sourceId: "cnon:abc",
      customerId: "CUST_1",
    });
    assert(
      !("verificationToken" in withoutOptional),
      "omit empty verificationToken",
    );

    const sub = buildSquareCreateSubscriptionRequest({
      subscriptionIdempotencyKey: "sub-key",
      locationId: "LOC_SANDBOX",
      customerId: "CUST_1",
      planVariationId: "PLAN_VAR_STARTER_MONTHLY",
      cardId: "CARD_1",
    });
    assert(sub.idempotencyKey === "sub-key", "sub idempotency");
    assert(sub.locationId === "LOC_SANDBOX", "sub location");
    assert(sub.customerId === "CUST_1", "sub customer");
    assert(sub.planVariationId === "PLAN_VAR_STARTER_MONTHLY", "sub variation");
    assert(sub.cardId === "CARD_1", "sub card");
    assert(!("startDate" in sub), "omit startDate");
    assert(!("phases" in sub), "omit phases");
    assert(!("billingCycle" in sub), "no billing cycle field");
  }

  // happy path: search existing customer → card → subscription
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource(),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare();

    const result = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id }),
      { stores, square: client, now: clock.now },
    );

    assert(result.ok === true, "enroll ok");
    if (!result.ok) throw new Error("unreachable");
    assert(result.subscriptionId === "SUB_A", "subscription id");
    assert(result.status === "completed", "completed status");
    assert(state.customersCreated === 0, "reused searched customer");
    assert(state.cardsCreated === 1, "created card once");
    assert(state.subscriptionsCreated === 1, "created subscription once");
    assert(
      state.lastCardRequest?.idempotencyKey === intent.card_idempotency_key,
      "card uses intent card key",
    );
    assert(
      state.lastSubscriptionRequest?.idempotencyKey ===
        intent.subscription_idempotency_key,
      "subscription uses intent subscription key",
    );
    assert(
      state.lastSubscriptionRequest?.planVariationId ===
        intent.square_plan_variation_id,
      "subscription uses intent variation only",
    );
    assert(
      state.lastSubscriptionRequest?.locationId === intent.square_location_id,
      "subscription uses intent location",
    );

    const stored = await stores.intents.getIntent(intent.id);
    assert(stored?.square_customer_id === "CUSTOMER_EXISTING", "recordCustomer");
    assert(stored?.square_card_id === "CARD_1", "persisted card id");
    assert(stored?.square_subscription_id === "SUB_A", "persisted sub id");
    assert(
      !squareBillingValueHasForbiddenTokenKey(stored),
      "intent has no token keys",
    );
  }

  // customer create path when search misses
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("bbbbbbbb-bbbb-4bbb-8bbb"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare({
      state: { customerByEmail: new Map() },
    });

    const result = await enrollSquareSubscription(
      baseEnrollInput({
        intentId: intent.id,
        email: "new-host@example.com",
      }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === true, "create customer enroll ok");
    assert(state.customersCreated === 1, "customer created");
    const stored = await stores.intents.getIntent(intent.id);
    assert(stored?.square_customer_id === "CUSTOMER_NEW_1", "new customer id");
  }

  // ownership rejection
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("cccccccc-cccc-4ccc-8ccc"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare();
    const result = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id, userId: USER_B }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === false && result.error === "forbidden", "ownership");
    assert(state.cardsCreated === 0, "no card on forbidden");
  }

  // expired intent
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("dddddddd-dddd-4ddd-8ddd"),
    });
    const intent = await createPendingIntent(stores);
    clock.advance(7 * 60 * 60 * 1000);
    const { client } = createMockSquare();
    const result = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === false && result.error === "expired", "expired intent");
  }

  // card-ready retry skips CreateCard and does not need sourceId
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("eeeeeeee-eeee-4eee-8eee"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare();

    state.failSubscriptionOnce = true;
    const first = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id }),
      { stores, square: client, now: clock.now },
    );
    assert(first.ok === false && first.error === "subscription_failed", "sub fail");
    assert(state.cardsCreated === 1, "card created before sub fail");

    const mid = await stores.intents.getIntent(intent.id);
    assert(mid?.status === "card_ready", "left card_ready");
    assert(mid?.square_card_id === "CARD_1", "card retained");

    const second = await enrollSquareSubscription(
      baseEnrollInput({
        intentId: intent.id,
        sourceId: null,
      }),
      { stores, square: client, now: clock.now },
    );
    assert(second.ok === true, "retry without token ok");
    assert(state.cardsCreated === 1, "skipped second CreateCard");
    assert(state.subscriptionsCreated === 1, "subscription created on retry");
    assert(
      state.lastSubscriptionRequest?.idempotencyKey ===
        intent.subscription_idempotency_key,
      "retry uses same subscription key",
    );
  }

  // subscription persist replay / full success retry
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("ffffffff-ffff-4fff-8fff"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare();

    const first = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id }),
      { stores, square: client, now: clock.now },
    );
    assert(first.ok === true && first.replayed === false, "first enroll");

    const second = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id, sourceId: null }),
      { stores, square: client, now: clock.now },
    );
    assert(second.ok === true && second.replayed === true, "success replay");
    assert(state.cardsCreated === 1, "no extra card on full replay");
    assert(
      state.subscriptionsCreated === 1,
      "no extra subscription call on completed short-circuit",
    );
  }

  // non-ACTIVE Square subscription: failIntent, no persist, no entitlement
  {
    for (const status of ["PENDING", "PAUSED", "CANCELED", "DEACTIVATED"] as const) {
      const clock = createClock();
      const stores = createMemorySquareBillingStores({
        now: clock.now,
        uuid: createUuidSource("eeeeeeee-eeee-4eee-8eee"),
      });
      const intent = await createPendingIntent(stores);
      const { client, state } = createMockSquare({ subscriptionStatus: status });
      let persistCalls = 0;
      const originalPersist = stores.intents.persistSubscription.bind(stores.intents);
      stores.intents.persistSubscription = async (input) => {
        persistCalls += 1;
        return originalPersist(input);
      };

      const result = await enrollSquareSubscription(
        baseEnrollInput({ intentId: intent.id }),
        { stores, square: client, now: clock.now },
      );
      assert(result.ok === false, `${status} enroll not ok`);
      if (result.ok) throw new Error("unreachable");
      assert(
        result.error === "square_subscription_not_enrollable",
        `${status} enroll error`,
      );
      assert(result.status === "failed", `${status} intent failed`);
      assert(persistCalls === 0, `${status} does not persist host correlation`);
      assert(state.subscriptionsCreated === 1, `${status} created Square sub once`);
      const stored = await stores.intents.getIntent(intent.id);
      assert(stored?.status === "failed", `${status} stored failed`);
      assert(
        stored?.last_error_code === "square_subscription_not_enrollable",
        `${status} last_error_code`,
      );
      assert(
        stored?.square_subscription_id === null,
        `${status} did not persist subscription id`,
      );
    }
  }

  // safe error mapping
  {
    assert(mapEnrollErrorToHttpStatus("unauthorized") === 401, "401");
    assert(mapEnrollErrorToHttpStatus("forbidden") === 403, "403");
    assert(mapEnrollErrorToHttpStatus("not_found") === 404, "404");
    assert(mapEnrollErrorToHttpStatus("conflict") === 409, "409");
    assert(mapEnrollErrorToHttpStatus("card_failed") === 502, "502 card");
    assert(mapEnrollErrorToHttpStatus("invalid_input") === 400, "400");
    assert(
      mapEnrollErrorToHttpStatus("square_subscription_not_enrollable") === 400,
      "400 not enrollable",
    );
  }

  // sourceId never stored on intent / payment method rows
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("99999999-9999-4999-8999"),
    });
    const intent = await createPendingIntent(stores);
    const { client } = createMockSquare();
    await enrollSquareSubscription(
      baseEnrollInput({
        intentId: intent.id,
        sourceId: "cnon:must-not-persist",
        verificationToken: "verify-must-not-persist",
      }),
      { stores, square: client, now: clock.now },
    );
    const stored = await stores.intents.getIntent(intent.id);
    const serialized = JSON.stringify(stored);
    assert(!serialized.includes("cnon:must-not-persist"), "no sourceId in intent");
    assert(!serialized.includes("verify-must-not-persist"), "no verify in intent");
    assert(
      !squareBillingValueHasForbiddenTokenKey(stored),
      "stored intent safe keys",
    );
    const methods = await stores.paymentMethods.listPaymentMethods(
      USER_A,
      "sandbox",
    );
    assert(methods.length === 1, "one payment method");
    assert(
      !JSON.stringify(methods[0]).includes("cnon:"),
      "payment method has no sourceId",
    );
  }

  // guest_addon remains Payment Link / quickPay; host Payment Link still present
  {
    const checkoutSource = readFileSync(
      join(process.cwd(), "src/lib/square-checkout.ts"),
      "utf8",
    );
    assert(
      checkoutSource.includes('kind === "guest_addon"'),
      "guest_addon branch present",
    );
    assert(
      checkoutSource.includes("createPaymentLink"),
      "Payment Link helper present",
    );
    assert(
      checkoutSource.includes("quickPay"),
      "quickPay still used for Payment Links",
    );
    assert(
      !checkoutSource.includes("enrollSquareSubscription"),
      "checkout not cut over to enroll yet",
    );
  }

  // missing application id config fails safely (web payments config helper)
  {
    const { resolveSquareWebPaymentsPublicConfig } = await import(
      "./square-web-payments-config"
    );
    const missing = resolveSquareWebPaymentsPublicConfig({
      SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_LOCATION_ID: "LOC_SANDBOX",
      SQUARE_APPLICATION_ID: "",
    });
    assert(missing.ok === false, "missing application id fails");
    if (missing.ok) throw new Error("unreachable");
    assert(missing.error === "missing_application_id", "missing app id code");
    assert(!("accessToken" in missing), "no access token field");

    const ok = resolveSquareWebPaymentsPublicConfig({
      SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_LOCATION_ID: "LOC_SANDBOX",
      SQUARE_APPLICATION_ID: "sq0idp-test",
    });
    assert(ok.ok === true, "config ok");
    if (!ok.ok) throw new Error("unreachable");
    assert(ok.applicationId === "sq0idp-test", "app id");
    assert(ok.locationId === "LOC_SANDBOX", "location");
    assert(ok.sandbox === true, "sandbox flag");
    assert(ok.environment === "sandbox", "environment");
    assert(!("accessToken" in ok), "no token on success");
  }

  // not found intent
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("88888888-8888-4888-8888"),
    });
    const { client } = createMockSquare();
    const result = await enrollSquareSubscription(
      baseEnrollInput({
        intentId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000099",
      }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === false && result.error === "not_found", "not found");
  }

  // customer path: search vs create distinguishable + safe diagnostics
  {
    const searchDiag = extractSafeSquareErrorDiagnostic({
      statusCode: 401,
      errors: [
        {
          category: "AUTHENTICATION_ERROR",
          code: "UNAUTHORIZED",
          detail: "This request could not be authorized. Bearer TOKEN_SECRET",
        },
      ],
      headers: { authorization: "Bearer TOKEN_SECRET" },
      body: { raw: "should-not-copy" },
    });
    assert(searchDiag.httpStatus === 401, "search http status");
    assert(searchDiag.category === "AUTHENTICATION_ERROR", "search category");
    assert(searchDiag.code === "UNAUTHORIZED", "search code");
    assert(
      Boolean(searchDiag.message?.includes("[redacted]")),
      "search message redacts bearer",
    );
    assert(
      !JSON.stringify(searchDiag).includes("TOKEN_SECRET"),
      "search diag has no secret",
    );
    assert(!("headers" in searchDiag), "search diag has no headers key");
    assert(!("body" in searchDiag), "search diag has no body key");

    const createDiag = extractSafeSquareErrorDiagnostic({
      statusCode: 400,
      body: {
        errors: [
          {
            category: "INVALID_REQUEST_ERROR",
            code: "INVALID_EMAIL_ADDRESS",
            detail: "Invalid email address.",
            field: "email_address",
          },
        ],
      },
    });
    assert(createDiag.httpStatus === 400, "create http status");
    assert(createDiag.category === "INVALID_REQUEST_ERROR", "create category");
    assert(createDiag.code === "INVALID_EMAIL_ADDRESS", "create code");
    assert(createDiag.field === "email_address", "create field");
    assert(
      createDiag.message === "Invalid email address.",
      "create safe message",
    );

    const clockSearch = createClock();
    const storesSearch = createMemorySquareBillingStores({
      now: clockSearch.now,
      uuid: createUuidSource("aaaaaaaa-aaaa-4aaa-8aaa"),
    });
    const intentSearch = await createPendingIntent(storesSearch);
    const { client: searchClient } = createMockSquare({
      state: { failCustomerSearchOnce: true },
    });
    const searchResult = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intentSearch.id }),
      { stores: storesSearch, square: searchClient, now: clockSearch.now },
    );
    assert(
      searchResult.ok === false && searchResult.error === "customer_failed",
      "search failure stays public customer_failed",
    );
    assert(
      mapEnrollErrorToHttpStatus("customer_failed") === 502,
      "public customer_failed still 502",
    );
    const afterSearch = await storesSearch.intents.getIntent(intentSearch.id);
    assert(!afterSearch?.square_customer_id, "search fail leaves no customer id");

    const clockCreate = createClock();
    const storesCreate = createMemorySquareBillingStores({
      now: clockCreate.now,
      uuid: createUuidSource("bbbbbbbb-bbbb-4bbb-8bbb"),
    });
    const intentCreate = await createPendingIntent(storesCreate);
    const { client: createClient, state: createState } = createMockSquare({
      state: {
        customerByEmail: new Map(),
        failCustomerCreateOnce: true,
      },
    });
    const createResult = await enrollSquareSubscription(
      baseEnrollInput({
        intentId: intentCreate.id,
        email: "new-host@example.com",
      }),
      { stores: storesCreate, square: createClient, now: clockCreate.now },
    );
    assert(
      createResult.ok === false && createResult.error === "customer_failed",
      "create failure stays public customer_failed",
    );
    assert(createState.customersCreated === 0, "failed create did not count success");
    const afterCreate = await storesCreate.intents.getIntent(intentCreate.id);
    assert(!afterCreate?.square_customer_id, "create fail leaves no customer id");

    const source = readFileSync(
      join(__dirname, "square-subscription-enroll.ts"),
      "utf8",
    );
    assert(
      source.includes('customerStage: "customer_search_failed"'),
      "search stage tagged",
    );
    assert(
      source.includes('customerStage: "customer_create_failed"'),
      "create stage tagged",
    );
    assert(
      source.includes("logSafeCustomerPathFailure"),
      "safe customer path logger present",
    );
    assert(
      source.includes("Never copies headers, tokens"),
      "extractor documents no header/token copy",
    );
    assert(
      source.includes("isEnrollableSquareSubscriptionStatus"),
      "enroll gates persist on enrollable Square status",
    );
    assert(
      source.includes("square_subscription_not_enrollable"),
      "enroll fails non-ACTIVE Square subscriptions with a safe code",
    );
    assert(
      !source.includes("b0e6c7d3-62fb-43a7-b12f-dee072d23b13"),
      "enroll does not persist the existing DEACTIVATED Square subscription",
    );
  }

  // customer email normalization (sandbox fixture → stable @example.com)
  {
    const mappedA = resolveSquareCustomerEmail({
      email: "mb6d-20260910-01@example.invalid",
      userId: USER_A,
      squareEnvironment: "sandbox",
    });
    const mappedARetry = resolveSquareCustomerEmail({
      email: "mb6d-20260910-01@example.invalid",
      userId: USER_A,
      squareEnvironment: "sandbox",
    });
    assert(
      mappedA === "zencierge-sandbox+111111111111@example.com",
      "sandbox fixture maps to stable example.com",
    );
    assert(mappedA === mappedARetry, "same user → same mapped email on retry");
    assert(!mappedA.includes("example.invalid"), "mapped email hides fixture host");

    const validSandbox = resolveSquareCustomerEmail({
      email: "host@example.com",
      userId: USER_A,
      squareEnvironment: "sandbox",
    });
    assert(validSandbox === "host@example.com", "sandbox valid email unchanged");

    const mappedB = resolveSquareCustomerEmail({
      email: "other@example.invalid",
      userId: USER_B,
      squareEnvironment: "sandbox",
    });
    assert(
      mappedB === "zencierge-sandbox+222222222222@example.com",
      "different user → different fragment",
    );
    assert(mappedA !== mappedB, "users do not share mapped emails");

    const prodValid = resolveSquareCustomerEmail({
      email: "host@example.com",
      userId: USER_A,
      squareEnvironment: "production",
    });
    assert(prodValid === "host@example.com", "production valid email unchanged");

    let prodInvalidThrown = false;
    try {
      resolveSquareCustomerEmail({
        email: "x@example.invalid",
        userId: USER_A,
        squareEnvironment: "production",
      });
    } catch (error) {
      prodInvalidThrown =
        error instanceof SquareSubscriptionEnrollError &&
        error.code === "invalid_input";
    }
    assert(prodInvalidThrown, "production invalid email fails closed");

    let prodMissingThrown = false;
    try {
      resolveSquareCustomerEmail({
        email: "",
        userId: USER_A,
        squareEnvironment: "production",
      });
    } catch (error) {
      prodMissingThrown =
        error instanceof SquareSubscriptionEnrollError &&
        error.code === "invalid_input";
    }
    assert(prodMissingThrown, "production missing email fails closed");

    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("cccccccc-cccc-4ccc-8ccc"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare({
      state: { customerByEmail: new Map() },
    });
    const result = await enrollSquareSubscription(
      baseEnrollInput({
        intentId: intent.id,
        email: "fixture@example.invalid",
      }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === true, "fixture sandbox email enrolls after mapping");
    assert(
      state.lastCustomerSearchEmail ===
        "zencierge-sandbox+111111111111@example.com",
      "search uses mapped email",
    );
    assert(
      state.lastCustomerCreateEmail ===
        "zencierge-sandbox+111111111111@example.com",
      "create uses same mapped email",
    );
    assert(
      state.lastCustomerSearchEmail === state.lastCustomerCreateEmail,
      "search and create share resolved email",
    );
    assert(
      !state.lastCustomerSearchEmail?.includes("example.invalid"),
      "Square never sees fixture host",
    );
  }

  console.log("square-subscription-enroll tests passed");
}

void runSquareSubscriptionEnrollTests();
