import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import type { AdminSubscriberRow } from "./admin-billing";

const projectSourceUrl = `${pathToFileURL(join(process.cwd(), "src")).href}/`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(
        new URL(`./src/${specifier.slice(2)}.ts`, pathToFileURL(`${process.cwd()}/`)).href,
        context,
      );
    }
    if (
      context.parentURL?.startsWith(projectSourceUrl) &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  complimentaryEndsAtFromPreset,
  evaluateSquareCompSafety,
} = await import("./complimentary-access-core.ts");
const {
  TRIAL_DAYS,
  buildTrialMetadata,
  isHostAccessGranted,
  isPaidSubscriptionStatus,
  isSquareBackedPaidEntitlement,
  isTrialWindowOpen,
  trialDaysRemaining,
  trialEndsAtIso,
} = await import("./zencierge-plans.ts");
const {
  backOfficeCustomerStatusLabel,
  customerMatchesFilter,
  isTrialCustomer,
} = await import("./backoffice-customers.ts");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sample(
  partial: Partial<AdminSubscriberRow> &
    Pick<AdminSubscriberRow, "userId" | "email" | "paymentState" | "rawStatus">,
): AdminSubscriberRow {
  return {
    fullName: partial.fullName ?? null,
    phone: partial.phone ?? null,
    planId: partial.planId ?? "starter",
    planName: partial.planName ?? "Starter",
    monthlyUsd: partial.monthlyUsd ?? 49,
    lastPaymentAt: partial.lastPaymentAt ?? null,
    nextChargeAt: partial.nextChargeAt ?? null,
    squareCustomerId: partial.squareCustomerId ?? null,
    squareSubscriptionId: partial.squareSubscriptionId ?? null,
    isLifetimeFree: partial.isLifetimeFree ?? false,
    complimentaryActive: partial.complimentaryActive ?? false,
    complimentaryStartsAt: partial.complimentaryStartsAt ?? null,
    complimentaryEndsAt: partial.complimentaryEndsAt ?? null,
    complimentaryGrantedBy: partial.complimentaryGrantedBy ?? null,
    trialActive: partial.trialActive ?? false,
    trialStartsAt: partial.trialStartsAt ?? null,
    trialEndsAt: partial.trialEndsAt ?? null,
    failedPayments: partial.failedPayments ?? [],
    alerts: partial.alerts ?? [],
    userId: partial.userId,
    email: partial.email,
    paymentState: partial.paymentState,
    rawStatus: partial.rawStatus,
  };
}

function runBillingAccessTypesTests() {
  const now = new Date("2026-09-05T12:00:00.000Z");
  assert(TRIAL_DAYS === 14, "public trial is exactly 14 days");
  const ends = trialEndsAtIso(now);
  assert(ends === "2026-09-19T12:00:00.000Z", "14-day trial end is exact UTC +14 days");
  assert(isTrialWindowOpen(ends, now), "trial grants access during window");
  assert(!isTrialWindowOpen(ends, new Date("2026-09-20T00:00:00.000Z")), "trial expires correctly");
  assert(trialDaysRemaining(ends, now) === 14, "trial days remaining at start");

  const meta = buildTrialMetadata("pro");
  assert(meta.subscription_status === "trial", "trial metadata status");
  assert(typeof meta.trial_ends_at === "string", "trial metadata has ends_at");
  assert(
    isHostAccessGranted({ subscriptionStatus: "inactive", metadata: meta }),
    "trial metadata grants host access",
  );
  assert(
    !isHostAccessGranted({
      subscriptionStatus: "trial",
      metadata: { trial_ends_at: "2020-01-01T00:00:00.000Z" },
    }),
    "expired/bare trial status does not grant permanent access",
  );
  assert(
    !isHostAccessGranted({ subscriptionStatus: "trial", metadata: {} }),
    "status=trial without ends_at does not grant access",
  );

  const six = complimentaryEndsAtFromPreset(6, now);
  assert(six.startsWith("2027-03-05"), "6-month complimentary ends ~Mar 5 2027");
  assert(
    isHostAccessGranted({ subscriptionStatus: "inactive", complimentaryEndsAt: six }),
    "complimentary grants access",
  );
  assert(
    !isHostAccessGranted({
      subscriptionStatus: "inactive",
      complimentaryEndsAt: "2020-01-01T00:00:00.000Z",
    }),
    "complimentary expiration stops access",
  );
  assert(
    isHostAccessGranted({ subscriptionStatus: "inactive", isLifetimeFree: true }),
    "lifetime VIP remains intact",
  );
  assert(
    isHostAccessGranted({ subscriptionStatus: "active" }),
    "paid remains paid",
  );

  assert(isPaidSubscriptionStatus("active") === true, "isPaidSubscriptionStatus active");
  assert(isPaidSubscriptionStatus("inactive") === false, "isPaidSubscriptionStatus inactive");
  assert(isPaidSubscriptionStatus("canceled") === false, "isPaidSubscriptionStatus canceled");
  assert(isPaidSubscriptionStatus("ACTIVE") === false, "isPaidSubscriptionStatus does not reinterpret case");
  assert(isPaidSubscriptionStatus(" active ") === false, "isPaidSubscriptionStatus does not trim");

  assert(
    isSquareBackedPaidEntitlement({
      localStatus: "active",
      squareSubscriptionId: null,
      squareSubscriptionStatus: null,
    }),
    "legacy local active without Square fields remains entitled",
  );
  assert(
    isHostAccessGranted({ subscriptionStatus: "active" }),
    "legacy host access without Square fields remains entitled",
  );

  const nonActiveSquare = [
    "DEACTIVATED",
    "CANCELED",
    "PAUSED",
    "PENDING",
    "COMPLETED",
  ] as const;
  for (const squareStatus of nonActiveSquare) {
    assert(
      !isSquareBackedPaidEntitlement({
        localStatus: "active",
        squareSubscriptionId: "sqsub_1",
        squareSubscriptionStatus: squareStatus,
      }),
      `Square ${squareStatus} denies ordinary paid access`,
    );
    assert(
      !isHostAccessGranted({
        subscriptionStatus: "active",
        squareSubscriptionId: "sqsub_1",
        squareSubscriptionStatus: squareStatus,
      }),
      `host access denied for Square ${squareStatus}`,
    );
  }

  assert(
    isSquareBackedPaidEntitlement({
      localStatus: "active",
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "ACTIVE",
    }),
    "Square ACTIVE grants ordinary paid access",
  );
  assert(
    isHostAccessGranted({
      subscriptionStatus: "active",
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "ACTIVE",
    }),
    "host access granted for Square ACTIVE",
  );
  assert(
    isSquareBackedPaidEntitlement({
      localStatus: "active",
      squareSubscriptionId: " sqsub_1 ",
      squareSubscriptionStatus: " ACTIVE ",
    }),
    "Square fields normalize surrounding whitespace only",
  );
  assert(
    !isSquareBackedPaidEntitlement({
      localStatus: "active",
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "active",
    }),
    "unknown/lowercase Square status is not reinterpreted",
  );

  assert(
    !isSquareBackedPaidEntitlement({
      localStatus: "active",
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: null,
    }),
    "Square ID plus missing status denies access",
  );
  assert(
    !isSquareBackedPaidEntitlement({
      localStatus: "active",
      squareSubscriptionId: null,
      squareSubscriptionStatus: "ACTIVE",
    }),
    "status without ID denies access",
  );
  assert(
    !isSquareBackedPaidEntitlement({
      localStatus: "inactive",
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "ACTIVE",
    }),
    "inactive local status plus Square ACTIVE denies ordinary paid access",
  );
  assert(
    !isHostAccessGranted({
      subscriptionStatus: "inactive",
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "ACTIVE",
    }),
    "inactive local plus Square ACTIVE does not grant host access",
  );

  assert(
    isHostAccessGranted({
      subscriptionStatus: "inactive",
      metadata: meta,
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "DEACTIVATED",
    }),
    "trial remains granted independently of Square status",
  );
  assert(
    isHostAccessGranted({
      subscriptionStatus: "inactive",
      complimentaryEndsAt: six,
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "CANCELED",
    }),
    "complimentary remains granted independently of Square status",
  );
  assert(
    isHostAccessGranted({
      subscriptionStatus: "inactive",
      isLifetimeFree: true,
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "PAUSED",
    }),
    "lifetime access remains unchanged",
  );
  assert(
    isHostAccessGranted({
      subscriptionStatus: "inactive",
      lifetimeVip: true,
      squareSubscriptionId: "sqsub_1",
      squareSubscriptionStatus: "PENDING",
    }),
    "founder/VIP access remains unchanged",
  );

  assert(!evaluateSquareCompSafety({ status: "active", squareSubscriptionId: "sq" }).ok, "active Square blocked");
  assert(!evaluateSquareCompSafety({ status: "past_due", squareSubscriptionId: "sq" }).ok, "past_due Square blocked");
  assert(evaluateSquareCompSafety({ status: "canceled", squareSubscriptionId: "sq" }).ok, "canceled Square safe");
  assert(evaluateSquareCompSafety({ status: "inactive", squareSubscriptionId: null }).ok, "no Square safe");

  const trialRow = sample({
    userId: "t1",
    email: "trial@x.com",
    paymentState: "sin_suscripcion",
    rawStatus: "inactive",
    trialActive: true,
    trialEndsAt: ends,
  });
  const compRow = sample({
    userId: "c1",
    email: "comp@x.com",
    paymentState: "sin_suscripcion",
    rawStatus: "inactive",
    complimentaryActive: true,
    complimentaryEndsAt: six,
  });
  const paidRow = sample({
    userId: "p1",
    email: "pay@x.com",
    paymentState: "al_dia",
    rawStatus: "active",
  });

  assert(backOfficeCustomerStatusLabel(trialRow) === "14-Day Trial", "trial label");
  assert(backOfficeCustomerStatusLabel(compRow) === "Complimentary", "comp label");
  assert(backOfficeCustomerStatusLabel(paidRow) === "Paying", "paying label");
  assert(customerMatchesFilter(trialRow, "trial"), "trial filter");
  assert(customerMatchesFilter(compRow, "complimentary"), "comp filter");
  assert(customerMatchesFilter(paidRow, "paying"), "paying filter");
  assert(!customerMatchesFilter(trialRow, "paying"), "trial not paying");
  assert(!customerMatchesFilter(compRow, "paying"), "comp not paying");
  assert(isTrialCustomer(trialRow), "isTrialCustomer uses trialActive");

  const root = process.cwd();
  const billing = readFileSync(join(root, "src/lib/admin-billing.ts"), "utf8");
  assert(billing.includes("trialActive"), "snapshot tracks trial");
  assert(billing.includes("trials:"), "metrics include trials");
  assert(billing.includes("!row.trialActive"), "MRR excludes trials");
  assert(billing.includes("!row.complimentaryActive"), "MRR excludes complimentary");

  const checkout = readFileSync(join(root, "src/app/api/payments/square/checkout/route.ts"), "utf8");
  assert(checkout.includes("isComplimentaryWindowOpen"), "checkout skips Square for complimentary");
  assert(checkout.includes("squareSkipped: true"), "no Square session for complimentary");

  const route = readFileSync(
    join(root, "src/app/api/backoffice/customers/[id]/complimentary/route.ts"),
    "utf8",
  );
  assert(
    route.includes("isFounderBillingOperator"),
    "complimentary access uses strict Founder Billing authorization",
  );
  assert(
    route.includes("source: auth.source"),
    "complimentary access verifies authenticated-session provenance",
  );
  assert(
    !route.includes("isSuperAdmin"),
    "complimentary access does not fall back to broad superadmin authorization",
  );

  const panel = readFileSync(
    join(root, "src/components/admin/backoffice-complimentary-panel.tsx"),
    "utf8",
  );
  assert(panel.includes("Complimentary Beta Partner"), "panel names beta partner access type");
  assert(panel.includes("window.confirm"), "confirm before write");

  const migration = join(root, "supabase/migrations/20260905220500_host_subscriptions_complimentary.sql");
  assert(existsSync(migration), "complimentary migration present (no new migration required)");

  const overview = readFileSync(join(root, "src/app/(founder-admin)/backoffice/page.tsx"), "utf8");
  assert(overview.includes("metrics.trials"), "Overview shows trial count");
  assert(overview.includes("metrics.complimentary"), "Overview shows complimentary count");

  const billingRoute = readFileSync(
    join(root, "src/app/api/billing/subscription/route.ts"),
    "utf8",
  );
  assert(billingRoute.includes("square_subscription_id"), "billing selects Square subscription id");
  assert(
    billingRoute.includes("square_subscription_status"),
    "billing selects Square subscription status",
  );
  assert(
    billingRoute.includes("squareSubscriptionId:"),
    "billing passes Square subscription id into access",
  );
  assert(
    billingRoute.includes("squareSubscriptionStatus:"),
    "billing passes Square subscription status into access",
  );
  assert(billingRoute.includes("isHostAccessGranted"), "billing still uses host access helper");
  assert(
    billingRoute.includes("const trialActive = !stripeSandboxAccess.granted && metadataTrialActive") &&
      billingRoute.includes('stripeSandboxAccess.granted\n    ? "active"') &&
      billingRoute.includes("metadataTrialActive,"),
    "Stripe sandbox paid access is not reported as an active trial while metadata remains observable",
  );

  const propertiesRoute = readFileSync(join(root, "src/app/api/properties/route.ts"), "utf8");
  assert(
    propertiesRoute.includes("square_subscription_id"),
    "properties selects Square subscription id",
  );
  assert(
    propertiesRoute.includes("square_subscription_status"),
    "properties selects Square subscription status",
  );
  assert(
    propertiesRoute.includes("squareSubscriptionId:"),
    "properties passes Square subscription id into access",
  );
  assert(
    propertiesRoute.includes("squareSubscriptionStatus:"),
    "properties passes Square subscription status into access",
  );
  assert(propertiesRoute.includes("isHostAccessGranted"), "properties still uses host access helper");
  assert(
    propertiesRoute.includes('.eq("user_id", auth.user.id)'),
    "properties tenant filter unchanged",
  );

  const authForm = readFileSync(
    join(root, "src/components/auth/host-auth-form.tsx"),
    "utf8",
  );
  assert(
    authForm.includes("isPaidSubscriptionStatus"),
    "login metadata still uses isPaidSubscriptionStatus",
  );
  assert(
    !authForm.includes("isSquareBackedPaidEntitlement"),
    "login metadata is not Square-gated in this microblock",
  );

  console.log("billing access types tests passed");
}

runBillingAccessTypesTests();
