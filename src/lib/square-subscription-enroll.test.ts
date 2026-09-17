import {
  createMemorySquareBillingStores,
  squareBillingValueHasForbiddenTokenKey,
  type CreateSquareSubscriptionIntentInput,
  type SquareBillingStores,
  type SquareHostSubscriptionPersistence,
} from "./square-billing-stores";
import {
  buildSquareCreateCardRequest,
  buildSquareCreateSubscriptionRequest,
  enrollSquareSubscription,
  existingHostCorrelationConflictsWithIntent,
  existingSquareSubscriptionBlocksNewEnrollment,
  extractSafeSquareErrorDiagnostic,
  isOwnedReusableSquareCustomer,
  isSquareAcceptableEmail,
  mapEnrollErrorToHttpStatus,
  resolveSquareCustomerEmail,
  resolveSquareCustomerIdentity,
  resolveSquareCustomerName,
  SquareSubscriptionEnrollError,
  type EnrollSquareSubscriptionInput,
  type SquareEnrollClient,
  type SquareEnrollCreateCardRequest,
  type SquareEnrollCreateSubscriptionRequest,
  type SquareEnrollCustomerProfile,
} from "./square-subscription-enroll";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const HOST_EMAIL = "ada@zencierge.io";
const HOST_METADATA = {
  first_name: "Ada",
  last_name: "Lovelace",
} as const;
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
  subscriptionsRetrieved: number;
  lastCardRequest: SquareEnrollCreateCardRequest | null;
  lastSubscriptionRequest: SquareEnrollCreateSubscriptionRequest | null;
  lastRetrieveIds: string[];
  customerByEmail: Map<string, string>;
  customerProfiles: Map<string, SquareEnrollCustomerProfile>;
  subscriptionById: Map<
    string,
    {
      id: string;
      status: string;
      customerId: string | null;
      locationId: string | null;
    }
  >;
  failCardOnce: boolean;
  failSubscriptionOnce: boolean;
  failSubscriptionPersistAfterCreate: boolean;
  failCustomerSearchOnce: boolean;
  failCustomerCreateOnce: boolean;
  failCustomerRetrieveOnce: boolean;
  failSubscriptionGetOnce: boolean;
  customerSearchError: unknown;
  customerCreateError: unknown;
  customerRetrieveError: unknown;
  lastCustomerSearchEmail: string | null;
  lastCustomerCreateEmail: string | null;
  lastCustomerCreate: {
    emailAddress: string;
    givenName: string;
    familyName?: string;
    referenceId: string;
    idempotencyKey: string;
  } | null;
  lastCustomerRetrieveIds: string[];
};

function createMockSquare(options?: {
  state?: Partial<MockSquareState>;
  subscriptionId?: string;
  subscriptionStatus?: string;
}): { client: SquareEnrollClient; state: MockSquareState } {
  const defaultExisting: SquareEnrollCustomerProfile = {
    id: "CUSTOMER_EXISTING",
    emailAddress: HOST_EMAIL,
    givenName: "Ada",
    familyName: "Lovelace",
    referenceId: USER_A,
  };
  const state: MockSquareState = {
    customersCreated: 0,
    cardsCreated: 0,
    subscriptionsCreated: 0,
    subscriptionsRetrieved: 0,
    lastCardRequest: null,
    lastSubscriptionRequest: null,
    lastRetrieveIds: [],
    customerByEmail: new Map([[HOST_EMAIL, "CUSTOMER_EXISTING"]]),
    customerProfiles: new Map([["CUSTOMER_EXISTING", defaultExisting]]),
    subscriptionById: new Map(),
    failCardOnce: false,
    failSubscriptionOnce: false,
    failSubscriptionPersistAfterCreate: false,
    failCustomerSearchOnce: false,
    failCustomerCreateOnce: false,
    failCustomerRetrieveOnce: false,
    failSubscriptionGetOnce: false,
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
    customerRetrieveError: {
      statusCode: 404,
      errors: [
        {
          category: "INVALID_REQUEST_ERROR",
          code: "NOT_FOUND",
          detail: "Customer not found.",
        },
      ],
    },
    lastCustomerSearchEmail: null,
    lastCustomerCreateEmail: null,
    lastCustomerCreate: null,
    lastCustomerRetrieveIds: [],
    ...options?.state,
  };

  if (options?.state?.customerProfiles) {
    if (!options.state.customerByEmail) {
      state.customerByEmail = new Map();
      for (const profile of state.customerProfiles.values()) {
        const email = profile.emailAddress?.trim().toLowerCase();
        const id = profile.id?.trim();
        if (email && id) state.customerByEmail.set(email, id);
      }
    }
  } else {
    state.customerProfiles = new Map();
    for (const [email, id] of state.customerByEmail) {
      state.customerProfiles.set(id, {
        id,
        emailAddress: email,
        givenName: "Ada",
        familyName: "Lovelace",
        companyName: null,
        referenceId: USER_A,
      });
    }
  }

  const client: SquareEnrollClient = {
    customers: {
      async search(input) {
        if (state.failCustomerSearchOnce) {
          state.failCustomerSearchOnce = false;
          throw state.customerSearchError;
        }
        const email = input.query.filter.emailAddress.exact;
        state.lastCustomerSearchEmail = email;
        const matches: Array<{ id: string }> = [];
        for (const profile of state.customerProfiles.values()) {
          const profileEmail = profile.emailAddress?.trim().toLowerCase() ?? "";
          const id = profile.id?.trim() ?? "";
          if (id && profileEmail === email.toLowerCase()) {
            matches.push({ id });
          }
        }
        const legacyId = state.customerByEmail.get(email);
        if (legacyId && !matches.some((match) => match.id === legacyId)) {
          matches.push({ id: legacyId });
        }
        return { customers: matches };
      },
      async retrieve(input) {
        state.lastCustomerRetrieveIds.push(input.customerId);
        if (state.failCustomerRetrieveOnce) {
          state.failCustomerRetrieveOnce = false;
          throw state.customerRetrieveError;
        }
        const profile = state.customerProfiles.get(input.customerId);
        return { customer: profile ?? null };
      },
      async create(input) {
        if (state.failCustomerCreateOnce) {
          state.failCustomerCreateOnce = false;
          throw state.customerCreateError;
        }
        state.customersCreated += 1;
        state.lastCustomerCreateEmail = input.emailAddress;
        state.lastCustomerCreate = {
          emailAddress: input.emailAddress,
          givenName: input.givenName,
          ...(input.familyName ? { familyName: input.familyName } : {}),
          referenceId: input.referenceId,
          idempotencyKey: input.idempotencyKey,
        };
        const id = `CUSTOMER_NEW_${state.customersCreated}`;
        state.customerByEmail.set(input.emailAddress, id);
        state.customerProfiles.set(id, {
          id,
          emailAddress: input.emailAddress,
          givenName: input.givenName,
          familyName: input.familyName ?? null,
          referenceId: input.referenceId,
        });
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
      async get(input) {
        state.subscriptionsRetrieved += 1;
        state.lastRetrieveIds.push(input.subscriptionId);
        if (state.failSubscriptionGetOnce) {
          state.failSubscriptionGetOnce = false;
          throw new Error("square subscription get boom");
        }
        const found = state.subscriptionById.get(input.subscriptionId);
        return { subscription: found ?? null };
      },
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
    email: HOST_EMAIL,
    userMetadata: { ...HOST_METADATA },
    sourceId: "cnon:test-source",
    ...overrides,
  };
}

function existingHost(
  overrides: Partial<SquareHostSubscriptionPersistence> = {},
): SquareHostSubscriptionPersistence {
  return {
    user_id: USER_A,
    plan_id: "portfolio",
    billing_cycle: "monthly",
    billing_amount_usd: 149,
    square_environment: "sandbox",
    square_location_id: "LOC_SANDBOX",
    square_plan_variation_id: "PLAN_VAR_PORTFOLIO_MONTHLY",
    square_customer_id: "CUSTOMER_EXISTING",
    square_subscription_id: "SUB_EXISTING",
    square_subscription_status: "ACTIVE",
    square_subscription_version: 1,
    square_start_date: "2026-09-10",
    square_charged_through_date: "2026-10-10",
    square_canceled_date: null,
    complimentary_ends_at: null,
    ...overrides,
  };
}

function trackStoreWrites(stores: SquareBillingStores) {
  let writes = 0;
  function wrap<T extends object, K extends keyof T>(target: T, key: K) {
    const original = (target[key] as (...args: never[]) => Promise<unknown>).bind(
      target,
    );
    (target[key] as unknown) = async (...args: never[]) => {
      writes += 1;
      return original(...args);
    };
  }
  wrap(stores.intents, "recordCustomer");
  wrap(stores.intents, "persistSubscription");
  wrap(stores.intents, "completeIntent");
  wrap(stores.intents, "failIntent");
  wrap(stores.paymentMethods, "persistPaymentMethod");
  return () => writes;
}

function squareSub(
  status: string,
  overrides: { customerId?: string | null; locationId?: string | null } = {},
) {
  return {
    id: "SUB_EXISTING",
    status,
    customerId: overrides.customerId === undefined ? "CUSTOMER_EXISTING" : overrides.customerId,
    locationId: overrides.locationId === undefined ? "LOC_SANDBOX" : overrides.locationId,
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
    assert(state.subscriptionsRetrieved === 0, "no existing-sub GET on first enroll");
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
        email: "new-host@zencierge.io",
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
    const routeSource = readFileSync(
      join(process.cwd(), "src/app/api/payments/square/subscribe/route.ts"),
      "utf8",
    );
    assert(
      routeSource.includes("mapEnrollErrorToHttpStatus(result.error)"),
      "subscribe route maps enroll errors including conflict",
    );
    assert(
      routeSource.includes("subscriptions.get(") &&
        routeSource.includes("status: mapEnrollErrorToHttpStatus(result.error)"),
      "subscribe route exposes GET and HTTP mapping",
    );
  }

  // fail-closed single-active Square subscription guard
  {
    assert(
      existingSquareSubscriptionBlocksNewEnrollment("ACTIVE") &&
        existingSquareSubscriptionBlocksNewEnrollment("PENDING") &&
        existingSquareSubscriptionBlocksNewEnrollment("PAUSED") &&
        existingSquareSubscriptionBlocksNewEnrollment("UNKNOWN"),
      "blocking statuses fail closed",
    );
    assert(
      !existingSquareSubscriptionBlocksNewEnrollment("DEACTIVATED") &&
        !existingSquareSubscriptionBlocksNewEnrollment("CANCELED") &&
        !existingSquareSubscriptionBlocksNewEnrollment("COMPLETED"),
      "terminal statuses allow new enrollment",
    );

    async function enrollWithHost(options: {
      host?: SquareHostSubscriptionPersistence;
      status?: string;
      locationMismatch?: boolean;
      customerMismatch?: boolean;
      uuidPrefix: string;
    }) {
      const clock = createClock();
      const host = options.host;
      const stores = createMemorySquareBillingStores({
        now: clock.now,
        uuid: createUuidSource(options.uuidPrefix),
        ...(host ? { subscriptions: [host] } : {}),
      });
      const writeCount = trackStoreWrites(stores);
      const intent = await createPendingIntent(stores);
      const { client, state } = createMockSquare({
        state: {
          subscriptionById: new Map([
            [
              "SUB_EXISTING",
              squareSub(options.status ?? "ACTIVE", {
                ...(options.customerMismatch
                  ? { customerId: "CUSTOMER_OTHER" }
                  : {}),
                ...(options.locationMismatch
                  ? { locationId: "LOC_OTHER" }
                  : {}),
              }),
            ],
          ]),
        },
      });
      const result = await enrollSquareSubscription(
        baseEnrollInput({ intentId: intent.id }),
        { stores, square: client, now: clock.now },
      );
      return { result, state, writeCount, intent, stores };
    }

    {
      const blocked = await enrollWithHost({
        host: existingHost(),
        status: "ACTIVE",
        uuidPrefix: "aa01aa01-aa01-4a01-8a01",
      });
      assert(blocked.result.ok === false, "ACTIVE blocks");
      if (blocked.result.ok) throw new Error("unreachable");
      assert(blocked.result.error === "conflict", "ACTIVE conflict");
      assert(blocked.state.customersCreated === 0, "ACTIVE no customer create");
      assert(blocked.state.cardsCreated === 0, "ACTIVE no card create");
      assert(blocked.state.subscriptionsCreated === 0, "ACTIVE no sub create");
      assert(blocked.writeCount() === 0, "ACTIVE no database writes");
      assert(blocked.state.subscriptionsRetrieved === 1, "ACTIVE GET once");
      const stored = await blocked.stores.intents.getIntent(blocked.intent.id);
      assert(stored?.status === "pending", "ACTIVE leaves intent pending");
    }

    {
      const blocked = await enrollWithHost({
        host: existingHost({ square_subscription_status: "PENDING" }),
        status: "PENDING",
        uuidPrefix: "aa02aa02-aa02-4a02-8a02",
      });
      assert(
        blocked.result.ok === false &&
          blocked.result.error === "conflict" &&
          blocked.state.subscriptionsCreated === 0 &&
          blocked.writeCount() === 0,
        "PENDING blocks before writes",
      );
    }

    {
      const blocked = await enrollWithHost({
        host: existingHost({ square_subscription_status: "PAUSED" }),
        status: "PAUSED",
        uuidPrefix: "aa03aa03-aa03-4a03-8a03",
      });
      assert(
        blocked.result.ok === false &&
          blocked.result.error === "conflict" &&
          blocked.state.cardsCreated === 0 &&
          blocked.state.subscriptionsCreated === 0 &&
          blocked.writeCount() === 0,
        "PAUSED blocks before writes",
      );
    }

    const terminalPrefixes: Record<string, string> = {
      DEACTIVATED: "aa14aa14-aa14-4a14-8a14",
      CANCELED: "aa15aa15-aa15-4a15-8a15",
      COMPLETED: "aa16aa16-aa16-4a16-8a16",
    };
    for (const status of ["DEACTIVATED", "CANCELED", "COMPLETED"] as const) {
      const allowed = await enrollWithHost({
        host: existingHost({ square_subscription_status: status }),
        status,
        uuidPrefix: terminalPrefixes[status],
      });
      assert(allowed.result.ok === true, `${status} allows enroll`);
      assert(allowed.state.subscriptionsRetrieved === 1, `${status} GET once`);
      assert(allowed.state.subscriptionsCreated === 1, `${status} creates once`);
      assert(allowed.state.cardsCreated === 1, `${status} creates card`);
    }

    {
      const mismatched = await enrollWithHost({
        host: existingHost({ square_location_id: "LOC_OTHER" }),
        status: "ACTIVE",
        uuidPrefix: "aa05aa05-aa05-4a05-8a05",
      });
      assert(
        mismatched.result.ok === false &&
          mismatched.result.error === "conflict" &&
          mismatched.state.subscriptionsRetrieved === 0 &&
          mismatched.state.subscriptionsCreated === 0 &&
          mismatched.writeCount() === 0,
        "mismatched location fails closed before Square GET/create",
      );
      assert(
        existingHostCorrelationConflictsWithIntent(
          {
            user_id: USER_A,
            square_environment: "production",
            square_location_id: "LOC_SANDBOX",
            square_customer_id: "CUSTOMER_EXISTING",
            square_subscription_id: "SUB_EXISTING",
          },
          {
            ...mismatched.intent,
            square_environment: "sandbox",
          },
        ),
        "mismatched environment conflicts",
      );
    }

    {
      const first = await enrollWithHost({
        uuidPrefix: "aa06aa06-aa06-4a06-8a06",
      });
      assert(first.result.ok === true, "no existing host still enrolls");
      assert(first.state.subscriptionsRetrieved === 0, "no GET without host");
      assert(first.state.subscriptionsCreated === 1, "one create without host");
    }
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
        email: "new-host@zencierge.io",
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
      source.includes('throwCustomerPathFailure("customer_search_failed"'),
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
    assert(
      !source.includes("zencierge-sandbox+"),
      "sandbox never invents mapped emails",
    );
    assert(
      !source.includes("@example.com"),
      "enroll never invents @example.com customer emails",
    );
    assert(
      source.includes("customer_retrieve_failed"),
      "retrieve stage tagged",
    );
  }

  function expectInvalidInput(run: () => unknown, message: string) {
    let thrown = false;
    try {
      run();
    } catch (error) {
      thrown =
        error instanceof SquareSubscriptionEnrollError &&
        error.code === "invalid_input";
    }
    assert(thrown, message);
  }

  async function enrollExpecting(
    input: Partial<EnrollSquareSubscriptionInput>,
    mockState?: Partial<MockSquareState>,
  ) {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("aabbccdd-eeee-4fff-8aaa"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare(
      mockState ? { state: mockState } : undefined,
    );
    const result = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id, ...input }),
      { stores, square: client, now: clock.now },
    );
    return { result, state, stores, intent, clock };
  }

  // valid first + last name
  {
    const identity = resolveSquareCustomerIdentity({
      email: HOST_EMAIL,
      userId: USER_A,
      userMetadata: { first_name: "Ada", last_name: "Lovelace" },
    });
    assert(identity.givenName === "Ada", "first_name given");
    assert(identity.familyName === "Lovelace", "last_name family");
    assert(identity.referenceId === USER_A, "reference is user id");
    assert(identity.email === HOST_EMAIL, "auth email");
  }

  // valid one-part full name
  {
    const identity = resolveSquareCustomerName({
      userMetadata: { full_name: "Madonna" },
    });
    assert(identity.givenName === "Madonna", "one-part givenName");
    assert(identity.familyName === null, "one-part has no familyName");
  }

  // missing name
  {
    expectInvalidInput(
      () => resolveSquareCustomerName({ userMetadata: {} }),
      "missing name fails",
    );
    const { result, state } = await enrollExpecting({ userMetadata: {} });
    assert(result.ok === false && result.error === "invalid_input", "enroll missing name");
    assert(state.cardsCreated === 0, "no card without name");
    assert(state.customersCreated === 0, "no customer without name");
  }

  // missing email
  {
    expectInvalidInput(
      () =>
        resolveSquareCustomerEmail({
          email: "",
          userId: USER_A,
          squareEnvironment: "sandbox",
        }),
      "missing email fails sandbox",
    );
    expectInvalidInput(
      () =>
        resolveSquareCustomerEmail({
          email: "   ",
          userId: USER_A,
          squareEnvironment: "production",
        }),
      "missing email fails production",
    );
    const { result, state } = await enrollExpecting({ email: "" });
    assert(result.ok === false && result.error === "invalid_input", "enroll missing email");
    assert(state.cardsCreated === 0, "no card without email");
  }

  // reserved / placeholder domains — identical sandbox and production
  {
    const reserved = [
      "user@example.com",
      "user@example.org",
      "user@example.net",
      "user@foo.example",
      "user@example.invalid",
      "user@foo.test",
      "user@device.localhost",
      "user@localhost",
      "user@test.com",
      "user@test.org",
    ];
    for (const email of reserved) {
      assert(!isSquareAcceptableEmail(email), `reject ${email}`);
      expectInvalidInput(
        () =>
          resolveSquareCustomerEmail({
            email,
            userId: USER_A,
            squareEnvironment: "sandbox",
          }),
        `sandbox rejects ${email}`,
      );
      expectInvalidInput(
        () =>
          resolveSquareCustomerEmail({
            email,
            userId: USER_A,
            squareEnvironment: "production",
          }),
        `production rejects ${email}`,
      );
    }

    const { result, state } = await enrollExpecting({
      email: "fixture@example.invalid",
    });
    assert(
      result.ok === false && result.error === "invalid_input",
      "sandbox fixture email fails closed",
    );
    assert(state.lastCustomerSearchEmail === null, "Square never searched fixture email");
    assert(state.customersCreated === 0, "sandbox never creates example.com customer");
    assert(state.cardsCreated === 0, "no card on reserved email");
  }

  // existing owned customer succeeds
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("a1a1a1a1-aaaa-4aaa-8aaa"),
    });
    const intent = await createPendingIntent(stores);
    await stores.intents.recordCustomer({
      intentId: intent.id,
      squareCustomerId: "CUSTOMER_OWNED",
    });
    const owned: SquareEnrollCustomerProfile = {
      id: "CUSTOMER_OWNED",
      emailAddress: HOST_EMAIL,
      givenName: "Ada",
      referenceId: USER_A,
    };
    const { client, state } = createMockSquare({
      state: {
        customerByEmail: new Map(),
        customerProfiles: new Map([["CUSTOMER_OWNED", owned]]),
      },
    });
    const result = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === true, "owned stored customer enrolls");
    assert(state.customersCreated === 0, "did not create when owned stored");
    assert(state.lastCardRequest?.card.customerId === "CUSTOMER_OWNED", "card uses owned id");
    assert(isOwnedReusableSquareCustomer(owned, USER_A), "owned profile reusable");
  }

  // existing customer with missing / wrong / generic referenceId fails
  {
    const cases: Array<[string, SquareEnrollCustomerProfile]> = [
      [
        "missing",
        {
          id: "CUSTOMER_BAD",
          emailAddress: HOST_EMAIL,
          givenName: "Ada",
          referenceId: null,
        },
      ],
      [
        "wrong",
        {
          id: "CUSTOMER_BAD",
          emailAddress: HOST_EMAIL,
          givenName: "Ada",
          referenceId: USER_B,
        },
      ],
      [
        "generic",
        {
          id: "CUSTOMER_BAD",
          emailAddress: HOST_EMAIL,
          givenName: "Ada",
          referenceId: "zencierge-host",
        },
      ],
    ];
    for (const [label, profile] of cases) {
      const clock = createClock();
      const stores = createMemorySquareBillingStores({
        now: clock.now,
        uuid: createUuidSource("b2b2b2b2-bbbb-4bbb-8bbb"),
      });
      const intent = await createPendingIntent(stores);
      await stores.intents.recordCustomer({
        intentId: intent.id,
        squareCustomerId: "CUSTOMER_BAD",
      });
      const { client, state } = createMockSquare({
        state: {
          customerByEmail: new Map(),
          customerProfiles: new Map([["CUSTOMER_BAD", profile]]),
        },
      });
      const result = await enrollSquareSubscription(
        baseEnrollInput({ intentId: intent.id }),
        { stores, square: client, now: clock.now },
      );
      assert(
        result.ok === false && result.error === "customer_failed",
        `stored ${label} reference fails closed`,
      );
      assert(state.cardsCreated === 0, `no card for ${label} stored customer`);
      assert(state.customersCreated === 0, `no create for ${label} stored customer`);
    }
  }

  // search same email different owner is ignored; create new owned customer
  {
    const other: SquareEnrollCustomerProfile = {
      id: "CUSTOMER_OTHER",
      emailAddress: HOST_EMAIL,
      givenName: "Other",
      referenceId: USER_B,
    };
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("c3c3c3c3-cccc-4ccc-8ccc"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare({
      state: {
        customerByEmail: new Map(),
        customerProfiles: new Map([["CUSTOMER_OTHER", other]]),
      },
    });
    const result = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === true, "ignores other-owner search hit");
    assert(state.customersCreated === 1, "creates owned customer after ignore");
    assert(state.lastCustomerCreate?.referenceId === USER_A, "create reference is user id");
    assert(state.lastCardRequest?.card.customerId === "CUSTOMER_NEW_1", "card uses new owned id");
    assert(
      state.lastCardRequest?.card.customerId !== "CUSTOMER_OTHER",
      "card never uses mismatched customer",
    );
  }

  // multiple results reuse only the correct owned customer
  {
    const other: SquareEnrollCustomerProfile = {
      id: "CUSTOMER_OTHER_MULTI",
      emailAddress: HOST_EMAIL,
      givenName: "Other",
      referenceId: USER_B,
    };
    const generic: SquareEnrollCustomerProfile = {
      id: "CUSTOMER_GENERIC_MULTI",
      emailAddress: HOST_EMAIL,
      givenName: "Host",
      referenceId: "zencierge-host",
    };
    const owned: SquareEnrollCustomerProfile = {
      id: "CUSTOMER_OWNED_MULTI",
      emailAddress: HOST_EMAIL,
      givenName: "Ada",
      companyName: "Zencierge",
      referenceId: USER_A,
    };
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("d4d4d4d4-dddd-4ddd-8ddd"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare({
      state: {
        customerByEmail: new Map(),
        customerProfiles: new Map([
          ["CUSTOMER_OTHER_MULTI", other],
          ["CUSTOMER_GENERIC_MULTI", generic],
          ["CUSTOMER_OWNED_MULTI", owned],
        ]),
      },
    });
    const result = await enrollSquareSubscription(
      baseEnrollInput({ intentId: intent.id }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === true, "multi-search reuses owned");
    assert(state.customersCreated === 0, "did not create when owned search hit exists");
    assert(
      state.lastCardRequest?.card.customerId === "CUSTOMER_OWNED_MULTI",
      "reused only owned customer",
    );
    assert(
      state.lastCustomerRetrieveIds.includes("CUSTOMER_OTHER_MULTI"),
      "inspected other candidate",
    );
    assert(
      state.lastCustomerRetrieveIds.includes("CUSTOMER_OWNED_MULTI"),
      "inspected owned candidate",
    );
  }

  // no valid owned result creates a new customer with identity fields
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("e5e5e5e5-eeee-4eee-8eee"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare({
      state: { customerByEmail: new Map(), customerProfiles: new Map() },
    });
    const result = await enrollSquareSubscription(
      baseEnrollInput({
        intentId: intent.id,
        email: "new-owner@zencierge.io",
        userMetadata: { given_name: "Grace", family_name: "Hopper" },
        cardholderName: "CARDHOLDER NOT IDENTITY",
      }),
      { stores, square: client, now: clock.now },
    );
    assert(result.ok === true, "create path ok");
    assert(state.customersCreated === 1, "created customer");
    assert(state.lastCustomerCreate?.emailAddress === "new-owner@zencierge.io", "create email");
    assert(state.lastCustomerCreate?.givenName === "Grace", "create givenName");
    assert(state.lastCustomerCreate?.familyName === "Hopper", "create familyName");
    assert(state.lastCustomerCreate?.referenceId === USER_A, "create referenceId");
    assert(
      state.lastCustomerCreate?.idempotencyKey === intent.customer_idempotency_key,
      "create uses stored customer idempotency key",
    );
    assert(
      state.lastCustomerCreate?.givenName !== "CARDHOLDER NOT IDENTITY",
      "cardholderName is not customer identity",
    );
    assert(
      state.lastCardRequest?.card.cardholderName === "CARDHOLDER NOT IDENTITY",
      "cardholderName stays on cards.create only",
    );
    assert(
      state.lastCardRequest?.card.customerId === "CUSTOMER_NEW_1",
      "card waits for resolved owned customer",
    );
  }

  // cardholderName never becomes customer identity even when metadata uses name
  {
    const clock = createClock();
    const stores = createMemorySquareBillingStores({
      now: clock.now,
      uuid: createUuidSource("f6f6f6f6-ffff-4fff-8fff"),
    });
    const intent = await createPendingIntent(stores);
    const { client, state } = createMockSquare({
      state: { customerByEmail: new Map(), customerProfiles: new Map() },
    });
    await enrollSquareSubscription(
      baseEnrollInput({
        intentId: intent.id,
        email: "onepart@zencierge.io",
        userMetadata: { name: "Prince" },
        cardholderName: "Host",
      }),
      { stores, square: client, now: clock.now },
    );
    assert(state.lastCustomerCreate?.givenName === "Prince", "metadata name used");
    assert(state.lastCustomerCreate?.givenName !== "Host", "never uses Host fallback");
    assert(state.lastCardRequest?.card.cardholderName === "Host", "Host only on card");
  }

  console.log("square-subscription-enroll tests passed");
}

void runSquareSubscriptionEnrollTests();
