import {
  SquareBillingStoreError,
  mapSquareSubscriptionStatusToHostStatus,
  serializeSquareBillingStoreError,
  type CreateSquareSubscriptionIntentInput,
} from "./square-billing-stores";
import { isPaidSubscriptionStatus } from "./zencierge-plans";
import {
  createSupabaseSquareBillingStores,
  logSafeHostCorrelationUpsertDiagnostic,
  mapSquareBillingDbError,
  safeHostCorrelationDiagnosticText,
  type SquareBillingDbResponse,
  type SquareBillingSupabaseClient,
  type SquareBillingSupabaseQuery,
} from "./square-billing-supabase-stores";

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
      throw new Error(`${message}: store error (${String(error)})`);
    }
    assert(error.code === code, `${message}: code ${error.code}`);
  }
}

const USER_A = "11111111-1111-4111-8111-111111111111";
const PAYMENT_ID = "33333333-3333-4333-8333-333333333333";
const BASE_MS = Date.parse("2026-09-10T12:00:00.000Z");

type Row = Record<string, unknown>;

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

function matches(row: Row, filters: Array<(row: Row) => boolean>) {
  return filters.every((filter) => filter(row));
}

/**
 * In-memory Supabase/PostgREST fake for Phase C tests.
 * No network. Enforces the unique constraints relied on by the store.
 */
function createFakeSquareBillingSupabaseClient(seed?: {
  payments?: Row[];
  hosts?: Row[];
}): SquareBillingSupabaseClient & { hostRows: Row[] } {
  const tables: Record<string, Row[]> = {
    square_subscription_intents: [],
    square_payment_methods: [],
    square_subscription_invoices: [],
    host_subscriptions: (seed?.hosts ?? []).map((row) => ({ ...row })),
    subscription_payments: (seed?.payments ?? []).map((row) => ({ ...row })),
  };

  function uniqueViolation(): SquareBillingDbResponse<Row[]> {
    return { data: [], error: { code: "23505", message: "duplicate key" } };
  }

  function from(table: string): SquareBillingSupabaseQuery {
    const rows = () => tables[table] ?? (tables[table] = []);
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    const filters: Array<(row: Row) => boolean> = [];
    let orderBy: { column: string; ascending: boolean } | null = null;
    let limitCount: number | null = null;
    let selectColumns = "*";

    const api: SquareBillingSupabaseQuery = {
      select(columns: string) {
        selectColumns = columns;
        return api;
      },
      insert(values: Record<string, unknown>) {
        mode = "insert";
        payload = { ...values };
        return api;
      },
      update(values: Record<string, unknown>) {
        mode = "update";
        payload = { ...values };
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return api;
      },
      in(column: string, values: readonly unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      is(column: string, value: null) {
        filters.push((row) => row[column] === value);
        return api;
      },
      or() {
        return api;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderBy = { column, ascending: options?.ascending !== false };
        return api;
      },
      limit(count: number) {
        limitCount = count;
        return api;
      },
      async maybeSingle() {
        const result = await execute();
        if (result.error) return { data: null, error: result.error };
        const data = result.data;
        if (!Array.isArray(data)) return { data: data as Row | null, error: null };
        if (data.length === 0) return { data: null, error: null };
        if (data.length > 1) {
          return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
        }
        return { data: data[0] ?? null, error: null };
      },
      then(onfulfilled, onrejected) {
        return execute().then(onfulfilled as never, onrejected as never);
      },
    };

    async function execute(): Promise<SquareBillingDbResponse<Row[]>> {
      void selectColumns;
      if (mode === "insert" && payload) {
        if (table === "square_subscription_intents") {
          const open = rows().find(
            (row) =>
              row.user_id === payload!.user_id &&
              row.square_environment === payload!.square_environment &&
              ["pending", "customer_ready", "card_ready", "subscription_ready"].includes(
                String(row.status),
              ),
          );
          if (open) return uniqueViolation();
          if (
            rows().some(
              (row) =>
                row.square_environment === payload!.square_environment &&
                (row.customer_idempotency_key === payload!.customer_idempotency_key ||
                  row.card_idempotency_key === payload!.card_idempotency_key ||
                  row.subscription_idempotency_key ===
                    payload!.subscription_idempotency_key),
            )
          ) {
            return uniqueViolation();
          }
        }
        if (table === "square_payment_methods") {
          if (
            rows().some(
              (row) =>
                row.square_environment === payload!.square_environment &&
                row.square_card_id === payload!.square_card_id,
            )
          ) {
            return uniqueViolation();
          }
        }
        if (table === "square_subscription_invoices") {
          if (
            rows().some(
              (row) =>
                row.square_environment === payload!.square_environment &&
                row.square_invoice_id === payload!.square_invoice_id,
            )
          ) {
            return uniqueViolation();
          }
          if (
            payload.square_order_id != null &&
            rows().some(
              (row) =>
                row.square_environment === payload!.square_environment &&
                row.square_order_id === payload!.square_order_id,
            )
          ) {
            return uniqueViolation();
          }
        }
        if (table === "host_subscriptions") {
          if (rows().some((row) => row.user_id === payload!.user_id)) {
            return uniqueViolation();
          }
          if (
            payload.square_environment != null &&
            payload.square_customer_id != null &&
            rows().some(
              (row) =>
                row.square_environment === payload!.square_environment &&
                row.square_customer_id === payload!.square_customer_id,
            )
          ) {
            return uniqueViolation();
          }
        }
        const inserted = { ...payload };
        rows().push(inserted);
        return { data: [inserted], error: null };
      }

      let matched = rows().filter((row) => matches(row, filters));
      if (mode === "update" && payload) {
        matched = matched.map((row) => {
          Object.assign(row, payload);
          return row;
        });
      }
      if (orderBy) {
        const column = orderBy.column;
        const ascending = orderBy.ascending;
        matched = [...matched].sort((left, right) => {
          const a = String(left[column] ?? "");
          const b = String(right[column] ?? "");
          return ascending ? a.localeCompare(b) : b.localeCompare(a);
        });
      }
      if (limitCount !== null) matched = matched.slice(0, limitCount);
      return { data: matched.map((row) => ({ ...row })), error: null };
    }

    return api;
  }

  return {
    from,
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const hosts = () => tables.host_subscriptions ?? (tables.host_subscriptions = []);
      if (fn === "square_billing_host_customer_owners") {
        const environment = String(args.p_square_environment ?? "");
        const customerId = String(args.p_square_customer_id ?? "");
        if (
          (environment !== "sandbox" && environment !== "production") ||
          customerId.trim().length === 0
        ) {
          return { data: [], error: { code: "ZB001", message: "invalid input" } };
        }
        const owners = hosts()
          .filter(
            (row) =>
              row.square_environment === environment &&
              row.square_customer_id === customerId,
          )
          .map((row) => ({ user_id: row.user_id }));
        return { data: owners, error: null };
      }
      if (fn === "square_billing_host_by_subscription") {
        const environment = String(args.p_square_environment ?? "");
        const subscriptionId = String(args.p_square_subscription_id ?? "");
        if (
          (environment !== "sandbox" && environment !== "production") ||
          subscriptionId.trim().length === 0
        ) {
          return { data: [], error: { code: "ZB001", message: "invalid input" } };
        }
        const matched = hosts().filter(
          (row) =>
            row.square_environment === environment &&
            row.square_subscription_id === subscriptionId,
        );
        return {
          data: matched.map((row) => ({
            user_id: row.user_id,
            plan_id: row.plan_id,
            billing_cycle: row.billing_cycle,
            billing_amount_usd: row.billing_amount_usd,
            square_environment: row.square_environment,
            square_location_id: row.square_location_id,
            square_plan_variation_id: row.square_plan_variation_id,
            square_customer_id: row.square_customer_id,
            square_subscription_id: row.square_subscription_id,
            square_subscription_status: row.square_subscription_status,
            square_subscription_version: row.square_subscription_version,
            square_start_date: row.square_start_date,
            square_charged_through_date: row.square_charged_through_date,
            square_canceled_date: row.square_canceled_date,
            complimentary_ends_at: row.complimentary_ends_at,
          })),
          error: null,
        };
      }
      if (fn === "square_billing_upsert_host_square_correlation") {
        const userId = String(args.p_user_id ?? "");
        const environment = String(args.p_square_environment ?? "");
        const customerId = String(args.p_square_customer_id ?? "");
        const subscriptionId = String(args.p_square_subscription_id ?? "");
        if (
          !userId ||
          (environment !== "sandbox" && environment !== "production") ||
          !customerId ||
          !subscriptionId
        ) {
          return { data: null, error: { code: "ZB001", message: "invalid input" } };
        }
        if (
          hosts().some(
            (row) =>
              row.square_environment === environment &&
              row.square_customer_id === customerId &&
              row.user_id !== userId,
          )
        ) {
          return {
            data: null,
            error: { code: "ZB409", message: "square customer ownership conflict" },
          };
        }
        if (
          hosts().some(
            (row) =>
              row.square_environment === environment &&
              row.square_subscription_id === subscriptionId &&
              row.user_id !== userId,
          )
        ) {
          return {
            data: null,
            error: {
              code: "ZB409",
              message: "square subscription ownership conflict",
            },
          };
        }
        let localStatus: string;
        try {
          localStatus = mapSquareSubscriptionStatusToHostStatus(
            String(args.p_square_subscription_status ?? ""),
          );
        } catch {
          return {
            data: null,
            error: {
              code: "ZB001",
              message: "unsupported square subscription status",
            },
          };
        }
        const patch: Row = {
          user_id: userId,
          plan_id: args.p_plan_id,
          status: localStatus,
          monthly_usd: args.p_billing_amount_usd,
          billing_cycle: args.p_billing_cycle,
          billing_amount_usd: args.p_billing_amount_usd,
          square_environment: environment,
          square_location_id: args.p_square_location_id,
          square_plan_variation_id: args.p_square_plan_variation_id,
          square_customer_id: customerId,
          square_subscription_id: subscriptionId,
          square_subscription_status: args.p_square_subscription_status,
          square_subscription_version: args.p_square_subscription_version,
          square_start_date: args.p_square_start_date,
          square_charged_through_date: args.p_square_charged_through_date,
          square_canceled_date: args.p_square_canceled_date,
          complimentary_ends_at: args.p_complimentary_ends_at,
        };
        const existing = hosts().find((row) => row.user_id === userId);
        if (existing) {
          Object.assign(existing, patch);
        } else {
          hosts().push({ ...patch });
        }
        const stored = hosts().find((row) => row.user_id === userId)!;
        return {
          data: [
            {
              user_id: stored.user_id,
              plan_id: stored.plan_id,
              billing_cycle: stored.billing_cycle,
              billing_amount_usd: stored.billing_amount_usd,
              square_environment: stored.square_environment,
              square_location_id: stored.square_location_id,
              square_plan_variation_id: stored.square_plan_variation_id,
              square_customer_id: stored.square_customer_id,
              square_subscription_id: stored.square_subscription_id,
              square_subscription_status: stored.square_subscription_status,
              square_subscription_version: stored.square_subscription_version,
              square_start_date: stored.square_start_date,
              square_charged_through_date: stored.square_charged_through_date,
              square_canceled_date: stored.square_canceled_date,
              complimentary_ends_at: stored.complimentary_ends_at,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { code: "PGRST202", message: `unknown rpc ${fn}` } };
    },
    get hostRows() {
      return tables.host_subscriptions;
    },
  };
}

async function openCardReady(stores: ReturnType<typeof createSupabaseSquareBillingStores>, clock: ReturnType<typeof createClock>) {
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
  return { intentId: created.intent.id, payment };
}

function captureConsoleInfo<T>(run: () => T): { value: T; logs: string[] } {
  const logs: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map((part) => String(part)).join(" "));
  };
  try {
    return { value: run(), logs };
  } finally {
    console.info = original;
  }
}

async function captureConsoleInfoAsync<T>(
  run: () => Promise<T>,
): Promise<{ value: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map((part) => String(part)).join(" "));
  };
  try {
    return { value: await run(), logs };
  } finally {
    console.info = original;
  }
}

function diagnosticHasForbidden(text: string): boolean {
  return (
    /token|nonce|sourceid|source_id|service_role|password|secret|authorization|bearer|customer_id|user_id|card_id|subscription_id/i.test(
      text,
    ) ||
    /eyj[\w-]+\.[\w-]+\.[\w-]+/i.test(text) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(
      text,
    )
  );
}

function wrapUpsertRpc(
  inner: SquareBillingSupabaseClient & { hostRows: Row[] },
  impl: SquareBillingSupabaseClient["rpc"],
): SquareBillingSupabaseClient & { hostRows: Row[] } {
  return {
    from: inner.from.bind(inner),
    rpc: async (fn, args) => {
      if (fn === "square_billing_upsert_host_square_correlation") {
        return impl(fn, args);
      }
      return inner.rpc(fn, args);
    },
    get hostRows() {
      return inner.hostRows;
    },
  };
}

export async function runSquareBillingSupabaseStoresTests() {
  // create intent + idempotent replay + conflicting replay
  {
    const clock = createClock();
    const stores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient(),
      now: clock.now,
      uuid: createUuidSource(),
    });
    const created = await stores.intents.createIntent(intentInput());
    assert(created.replayed === false, "createIntent write");
    assert(created.intent.status === "pending", "createIntent pending");
    const replay = await stores.intents.createIntent(intentInput());
    assert(replay.replayed === true, "createIntent replay");
    assert(replay.intent.id === created.intent.id, "createIntent same id");
    await assertRejects(
      () => stores.intents.createIntent(intentInput({ planId: "pro", billingAmountUsd: 99 })),
      "conflict",
      "createIntent conflicting replay",
    );
    await assertRejects(
      () =>
        stores.intents.createIntent({
          ...intentInput(),
          sourceId: "tok",
        } as CreateSquareSubscriptionIntentInput & { sourceId: string }),
      "invalid_input",
      "token-like key rejected",
    );
  }

  // customer correlation
  {
    const clock = createClock();
    const stores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient(),
      now: clock.now,
      uuid: createUuidSource("bbbbbbbb-bbbb-4bbb-8bbb"),
    });
    const created = await stores.intents.createIntent(intentInput());
    const first = await stores.intents.recordCustomer({
      intentId: created.intent.id,
      squareCustomerId: "CUSTOMER_A",
    });
    assert(first.replayed === false, "recordCustomer write");
    assert(first.intent.status === "customer_ready", "customer_ready");
    const replay = await stores.intents.recordCustomer({
      intentId: created.intent.id,
      squareCustomerId: "CUSTOMER_A",
    });
    assert(replay.replayed === true, "recordCustomer replay");
    await assertRejects(
      () =>
        stores.intents.recordCustomer({
          intentId: created.intent.id,
          squareCustomerId: "CUSTOMER_B",
        }),
      "conflict",
      "recordCustomer conflict",
    );
  }

  // payment method persist/disable
  {
    const clock = createClock();
    const stores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient(),
      now: clock.now,
      uuid: createUuidSource("cccccccc-cccc-4ccc-8ccc"),
    });
    const opened = await openCardReady(stores, clock);
    assert(opened.payment.intent.status === "card_ready", "card_ready");
    const replay = await stores.paymentMethods.persistPaymentMethod({
      intentId: opened.intentId,
      squareCardId: "CARD_A",
      cardBrand: "VISA",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      consentedAt: clock.iso(),
    });
    assert(replay.replayed === true, "payment method replay");
    const disabled = await stores.paymentMethods.disablePaymentMethod({
      paymentMethodId: opened.payment.paymentMethod.id,
    });
    assert(disabled.enabled === false, "disable");
    const disabledAgain = await stores.paymentMethods.disablePaymentMethod({
      paymentMethodId: opened.payment.paymentMethod.id,
    });
    assert(disabledAgain.enabled === false, "disable idempotent");
  }

  // subscription correlation + terminal lifecycle
  {
    const clock = createClock();
    const stores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient(),
      now: clock.now,
      uuid: createUuidSource("dddddddd-dddd-4ddd-8ddd"),
    });
    const opened = await openCardReady(stores, clock);
    const persisted = await stores.intents.persistSubscription({
      intentId: opened.intentId,
      squareSubscriptionId: "SUB_A",
      squareSubscriptionStatus: "ACTIVE",
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: "2026-10-10",
      canceledDate: null,
    });
    assert(persisted.replayed === false, "persistSubscription write");
    assert(persisted.intent.status === "completed", "completed via persist");
    assert(
      persisted.subscription.square_subscription_id === "SUB_A",
      "host correlation written",
    );
    const replay = await stores.intents.persistSubscription({
      intentId: opened.intentId,
      squareSubscriptionId: "SUB_A",
      squareSubscriptionStatus: "ACTIVE",
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: "2026-10-10",
      canceledDate: null,
    });
    assert(replay.replayed === true, "persistSubscription replay");
    const completeReplay = await stores.intents.completeIntent({
      intentId: opened.intentId,
    });
    assert(completeReplay.replayed === true, "complete replay");

    const failStores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient(),
      now: clock.now,
      uuid: createUuidSource("eeeeeeee-eeee-4eee-8eee"),
    });
    const failOpen = await openCardReady(failStores, clock);
    const failed = await failStores.intents.failIntent({
      intentId: failOpen.intentId,
      errorCode: "CARD_DECLINED",
    });
    assert(failed.intent.status === "failed", "failIntent");
    await assertRejects(
      () => failStores.intents.completeIntent({ intentId: failOpen.intentId }),
      "invalid_lifecycle",
      "complete after fail",
    );

    const expireClock = createClock();
    const expireStores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient(),
      now: expireClock.now,
      uuid: createUuidSource("ffffffff-ffff-4fff-8fff"),
    });
    const expiring = await expireStores.intents.createIntent(
      intentInput({ expiresAt: "2026-09-10T12:00:01.000Z" }),
    );
    expireClock.advance(2_000);
    const expired = await expireStores.intents.expireIntent({
      intentId: expiring.intent.id,
    });
    assert(expired.intent.status === "expired", "expireIntent");
  }

  // invoice version behavior
  {
    const clock = createClock();
    const stores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient(),
      now: clock.now,
      uuid: createUuidSource("a1a1a1a1-a1a1-41a1-81a1"),
    });
    const opened = await openCardReady(stores, clock);
    await stores.intents.persistSubscription({
      intentId: opened.intentId,
      squareSubscriptionId: "SUB_A",
      squareSubscriptionStatus: "ACTIVE",
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: null,
      canceledDate: null,
    });
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
      paidAt: clock.iso(),
    });
    assert(first.replayed === false, "invoice create");
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
      paidAt: clock.iso(),
    });
    assert(replay.replayed === true, "invoice replay");
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
    assert(newer.invoice.square_invoice_version === 2, "newer version");
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
          paidAt: clock.iso(),
        }),
      "conflict",
      "older invoice version",
    );
  }

  // payment correlation
  {
    const clock = createClock();
    const stores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient({
        payments: [
          {
            id: PAYMENT_ID,
            provider_payment_id: "PAY_A",
            billing_cycle: null,
            square_environment: null,
            square_location_id: null,
            square_subscription_id: null,
            square_invoice_id: null,
            square_order_id: null,
          },
        ],
      }),
      now: clock.now,
      uuid: createUuidSource("b2b2b2b2-b2b2-42b2-82b2"),
    });
    const opened = await openCardReady(stores, clock);
    await stores.intents.persistSubscription({
      intentId: opened.intentId,
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
    assert(first.correlated === true && first.replayed === false, "correlate fill");
    if (!first.correlated) throw new Error("unreachable");
    assert(first.payment.square_invoice_id === "INV_A", "payment linked");
    const replay = await stores.invoicePayments.correlatePayment({
      providerPaymentId: "PAY_A",
      squareEnvironment: "sandbox",
      squareInvoiceId: "INV_A",
      squareOrderId: "ORDER_A",
      squareSubscriptionId: "SUB_A",
    });
    assert(replay.correlated === true && replay.replayed === true, "correlate replay");
  }

  // DB error mapping + secret-safe serialization
  {
    try {
      mapSquareBillingDbError({ code: "23505", message: "Key (secret)=(...)" });
      throw new Error("expected mapSquareBillingDbError to throw");
    } catch (error) {
      if (!(error instanceof SquareBillingStoreError)) {
        throw new Error("maps to store error");
      }
      assert(error.code === "conflict", "unique -> conflict");
      const serialized = serializeSquareBillingStoreError(error);
      assert(!JSON.stringify(serialized).includes("secret"), "no secret leakage");
      assert(serialized.message === "Square billing store conflict", "safe message");
    }
    try {
      mapSquareBillingDbError({
        code: "ZB409",
        message: "square customer ownership conflict",
      });
      throw new Error("expected ZB409 mapping");
    } catch (error) {
      if (!(error instanceof SquareBillingStoreError)) {
        throw new Error("ZB409 maps to store error");
      }
      assert(error.code === "conflict", "ZB409 -> conflict");
    }
    try {
      mapSquareBillingDbError({ code: "ZB001", message: "invalid square environment" });
      throw new Error("expected ZB001 mapping");
    } catch (error) {
      if (!(error instanceof SquareBillingStoreError)) {
        throw new Error("ZB001 maps to store error");
      }
      assert(error.code === "invalid_input", "ZB001 -> invalid_input");
    }
    try {
      mapSquareBillingDbError({ code: "57014", message: "password=super-secret" });
      throw new Error("expected unavailable mapping");
    } catch (error) {
      if (!(error instanceof SquareBillingStoreError)) {
        throw new Error("maps unknown db error");
      }
      assert(error.code === "unavailable", "fallback unavailable");
      const serialized = serializeSquareBillingStoreError(error);
      assert(!JSON.stringify(serialized).includes("password"), "no credential leakage");
      assert(
        !JSON.stringify(serialized).includes("super-secret"),
        "no raw db message leakage",
      );
    }
    const raw = serializeSquareBillingStoreError(new Error("SUPABASE_SERVICE_ROLE_KEY=abc"));
    assert(raw.code === "unavailable", "non-store error safe");
    assert(!JSON.stringify(raw).includes("SUPABASE_SERVICE_ROLE_KEY"), "no env leakage");
    assert(!JSON.stringify(raw).includes("abc"), "no secret value leakage");
  }

  // upsert RPC safe diagnostic capture (mapping unchanged)
  {
    assert(
      safeHostCorrelationDiagnosticText("permission denied for table host_subscriptions") ===
        "permission denied for table host_subscriptions",
      "non-sensitive postgres message kept",
    );
    assert(
      safeHostCorrelationDiagnosticText("user_id=11111111-1111-4111-8111-111111111111") ===
        null,
      "user id messages dropped",
    );
    assert(
      safeHostCorrelationDiagnosticText("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb") ===
        null,
      "token messages dropped",
    );
    const logged = captureConsoleInfo(() => {
      logSafeHostCorrelationUpsertDiagnostic({
        operation: "square_billing_upsert_host_square_correlation",
        diagnosticKind: "rpc_error",
        errorCode: "42501",
        message: "permission denied for table host_subscriptions",
        details: "user_id=11111111-1111-4111-8111-111111111111",
        hint: "sourceId=cnon:secret",
        rowCount: 0,
      });
    });
    assert(logged.logs.length === 1, "rpc_error diagnostic emitted");
    const payload = JSON.parse(logged.logs[0]!) as Record<string, unknown>;
    assert(
      payload.operation === "square_billing_upsert_host_square_correlation",
      "operation name",
    );
    assert(payload.diagnosticKind === "rpc_error", "rpc_error kind");
    assert(payload.errorCode === "42501", "errorCode preserved");
    assert(
      payload.message === "permission denied for table host_subscriptions",
      "safe message kept",
    );
    assert(payload.details === null, "sensitive details omitted");
    assert(payload.hint === null, "sensitive hint omitted");
    assert(!diagnosticHasForbidden(logged.logs[0]!), "rpc_error log has no secrets");

    const persistInput = {
      squareSubscriptionId: "SUB_NEW",
      squareSubscriptionStatus: "ACTIVE" as const,
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: "2026-10-10",
      canceledDate: null,
    };

    const unknownClock = createClock();
    const unknownInner = createFakeSquareBillingSupabaseClient();
    const unknownStores = createSupabaseSquareBillingStores({
      client: wrapUpsertRpc(unknownInner, async () => ({
        data: null,
        error: {
          code: "42501",
          message: "permission denied for table host_subscriptions",
        },
      })),
      now: unknownClock.now,
      uuid: createUuidSource("a1a1a1a1-a1a1-41a1-81a1"),
    });
    const unknownOpened = await openCardReady(unknownStores, unknownClock);
    const unknownCapture = await captureConsoleInfoAsync(() =>
      assertRejects(
        () =>
          unknownStores.intents.persistSubscription({
            intentId: unknownOpened.intentId,
            ...persistInput,
          }),
        "unavailable",
        "unknown RPC error remains unavailable",
      ),
    );
    assert(
      unknownCapture.logs.some((line) => line.includes('"diagnosticKind":"rpc_error"')),
      "unknown RPC error records rpc_error",
    );
    assert(
      unknownCapture.logs.every((line) => !diagnosticHasForbidden(line)),
      "unknown RPC diagnostic has no secrets",
    );

    const emptyClock = createClock();
    const emptyInner = createFakeSquareBillingSupabaseClient();
    const emptyStores = createSupabaseSquareBillingStores({
      client: wrapUpsertRpc(emptyInner, async () => ({ data: [], error: null })),
      now: emptyClock.now,
      uuid: createUuidSource("b1b1b1b1-b1b1-41b1-81b1"),
    });
    const emptyOpened = await openCardReady(emptyStores, emptyClock);
    const emptyCapture = await captureConsoleInfoAsync(() =>
      assertRejects(
        () =>
          emptyStores.intents.persistSubscription({
            intentId: emptyOpened.intentId,
            ...persistInput,
          }),
        "unavailable",
        "empty upsert result remains unavailable",
      ),
    );
    assert(
      emptyCapture.logs.some((line) => {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return (
          parsed.diagnosticKind === "unexpected_row_count" &&
          parsed.rowCount === 0
        );
      }),
      "empty data records unexpected_row_count",
    );
    assert(
      emptyCapture.logs.every((line) => !diagnosticHasForbidden(line)),
      "empty-row diagnostic has no secrets",
    );

    const okClock = createClock();
    const okCapture = await captureConsoleInfoAsync(async () => {
      const okStores = createSupabaseSquareBillingStores({
        client: createFakeSquareBillingSupabaseClient(),
        now: okClock.now,
        uuid: createUuidSource("c1c1c1c1-c1c1-41c1-81c1"),
      });
      const opened = await openCardReady(okStores, okClock);
      return okStores.intents.persistSubscription({
        intentId: opened.intentId,
        ...persistInput,
      });
    });
    assert(okCapture.value.intent.status === "completed", "one-row upsert still completes");
    assert(
      !okCapture.logs.some((line) =>
        line.includes("square_billing_upsert_host_square_correlation"),
      ),
      "successful one-row upsert does not emit failure diagnostic",
    );
  }

  // host correlation RPCs: cross-user customer conflict + store wiring
  {
    const USER_B = "22222222-2222-4222-8222-222222222222";
    const clock = createClock();
    const client = createFakeSquareBillingSupabaseClient({
      hosts: [
        {
          user_id: USER_B,
          plan_id: "starter",
          billing_cycle: "monthly",
          billing_amount_usd: 49,
          square_environment: "sandbox",
          square_location_id: "LOC_SANDBOX",
          square_plan_variation_id: "PLAN_VAR_STARTER_MONTHLY",
          square_customer_id: "CUSTOMER_TAKEN",
          square_subscription_id: "SUB_OTHER",
          square_subscription_status: "ACTIVE",
          square_subscription_version: 1,
          square_start_date: "2026-09-01",
          square_charged_through_date: null,
          square_canceled_date: null,
          complimentary_ends_at: null,
        },
      ],
    });
    const stores = createSupabaseSquareBillingStores({
      client,
      now: clock.now,
      uuid: createUuidSource("b2b2b2b2-b2b2-42b2-82b2"),
    });
    const created = await stores.intents.createIntent(intentInput());
    await assertRejects(
      () =>
        stores.intents.recordCustomer({
          intentId: created.intent.id,
          squareCustomerId: "CUSTOMER_TAKEN",
        }),
      "conflict",
      "recordCustomer rejects other-user host customer owner",
    );

    const okClock = createClock();
    const okClient = createFakeSquareBillingSupabaseClient();
    const okStores = createSupabaseSquareBillingStores({
      client: okClient,
      now: okClock.now,
      uuid: createUuidSource("c3c3c3c3-c3c3-43c3-83c3"),
    });
    const opened = await openCardReady(okStores, okClock);
    const persisted = await okStores.intents.persistSubscription({
      intentId: opened.intentId,
      squareSubscriptionId: "SUB_NEW",
      squareSubscriptionStatus: "ACTIVE",
      squareSubscriptionVersion: 1,
      startDate: "2026-09-10",
      chargedThroughDate: "2026-10-10",
      canceledDate: null,
    });
    assert(persisted.replayed === false, "persist via RPC B");
    assert(persisted.intent.status === "completed", "ACTIVE persist completes");
    assert(okClient.hostRows[0]?.status === "active", "ACTIVE maps to local active");
    assert(
      isPaidSubscriptionStatus(String(okClient.hostRows[0]?.status)),
      "ACTIVE grants paid entitlement",
    );

    const statusPrefixes: Record<string, string> = {
      PENDING: "e1e1e1e1-e1e1-41e1-81e1",
      PAUSED: "e2e2e2e2-e2e2-42e2-82e2",
      CANCELED: "e3e3e3e3-e3e3-43e3-83e3",
      DEACTIVATED: "d4d4d4d4-d4d4-44d4-84d4",
    };
    for (const status of ["PENDING", "PAUSED", "CANCELED", "DEACTIVATED"] as const) {
      const clockForStatus = createClock();
      const clientForStatus = createFakeSquareBillingSupabaseClient();
      const storesForStatus = createSupabaseSquareBillingStores({
        client: clientForStatus,
        now: clockForStatus.now,
        uuid: createUuidSource(statusPrefixes[status]),
      });
      const openedForStatus = await openCardReady(storesForStatus, clockForStatus);
      const persistedForStatus = await storesForStatus.intents.persistSubscription({
        intentId: openedForStatus.intentId,
        squareSubscriptionId: `SUB_${status}`,
        squareSubscriptionStatus: status,
        squareSubscriptionVersion: 1,
        startDate: "2026-09-10",
        chargedThroughDate: null,
        canceledDate: status === "CANCELED" ? "2026-09-10" : null,
      });
      const expectedLocal = mapSquareSubscriptionStatusToHostStatus(status);
      assert(persistedForStatus.replayed === false, `${status} persist writes host row`);
      assert(
        persistedForStatus.intent.status === "card_ready",
        `${status} persist does not complete intent`,
      );
      assert(
        persistedForStatus.intent.square_subscription_id === null,
        `${status} persist does not attach subscription id`,
      );
      assert(
        clientForStatus.hostRows[0]?.status === expectedLocal &&
          !isPaidSubscriptionStatus(String(clientForStatus.hostRows[0]?.status)),
        `${status} maps to ${expectedLocal} without entitlement`,
      );
      assert(
        persistedForStatus.subscription.square_subscription_status === status,
        `${status} keeps raw Square status`,
      );
    }

    const unknownClock = createClock();
    const unknownStores = createSupabaseSquareBillingStores({
      client: createFakeSquareBillingSupabaseClient(),
      now: unknownClock.now,
      uuid: createUuidSource("e4e4e4e4-e4e4-44e4-84e4"),
    });
    const unknownOpened = await openCardReady(unknownStores, unknownClock);
    await assertRejects(
      () =>
        unknownStores.intents.persistSubscription({
          intentId: unknownOpened.intentId,
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

    const owners = await createFakeSquareBillingSupabaseClient({
      hosts: [
        {
          user_id: USER_B,
          plan_id: "starter",
          billing_cycle: "monthly",
          billing_amount_usd: 49,
          square_environment: "sandbox",
          square_location_id: "LOC_SANDBOX",
          square_plan_variation_id: "PLAN_VAR_STARTER_MONTHLY",
          square_customer_id: "CUSTOMER_TAKEN",
          square_subscription_id: "SUB_OTHER",
          square_subscription_status: "ACTIVE",
          square_subscription_version: 1,
          square_start_date: "2026-09-01",
          square_charged_through_date: null,
          square_canceled_date: null,
          complimentary_ends_at: null,
        },
      ],
    }).rpc("square_billing_host_customer_owners", {
      p_square_environment: "sandbox",
      p_square_customer_id: "CUSTOMER_TAKEN",
    });
    assert(
      Array.isArray(owners.data) &&
        owners.data.length === 1 &&
        Object.keys(owners.data[0] ?? {}).length === 1 &&
        owners.data[0]?.user_id === USER_B,
      "RPC A returns only owner user_id",
    );
  }

  {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "src/lib/square-billing-supabase-stores.ts"),
      "utf8",
    );
    assert(
      !/\.from\(\s*["']host_subscriptions["']\s*\)/.test(source),
      "store no longer queries host_subscriptions directly",
    );
    assert(
      source.includes('rpc("square_billing_host_customer_owners"'),
      "recordCustomer/persist path uses RPC A",
    );
    assert(
      source.includes("HOST_CORRELATION_UPSERT_RPC") &&
        (source.includes('rpc(HOST_CORRELATION_UPSERT_RPC') ||
          source.includes('rpc(\n      "square_billing_upsert_host_square_correlation"') ||
          source.includes('rpc("square_billing_upsert_host_square_correlation"')),
      "writeHostSubscription uses RPC B",
    );
    assert(
      source.includes("logSafeHostCorrelationUpsertDiagnostic"),
      "upsert RPC captures a safe diagnostic before unavailable mapping",
    );
    assert(
      source.includes('rpc("square_billing_host_by_subscription"'),
      "findHostBySubscription uses RPC C",
    );
  }

  console.log("square-billing-supabase-stores tests passed");
}

void runSquareBillingSupabaseStoresTests();
