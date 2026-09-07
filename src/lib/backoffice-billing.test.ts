import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  formatBillingUsd,
  isPayingBillingSubscriber,
  summarizeAdminBillingByPlan,
  type AdminSubscriberRow,
} from "./admin-billing";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sample(
  partial: Partial<AdminSubscriberRow> &
    Pick<AdminSubscriberRow, "userId" | "email" | "paymentState" | "rawStatus">,
): AdminSubscriberRow {
  return {
    userId: partial.userId,
    email: partial.email,
    fullName: partial.fullName ?? null,
    phone: partial.phone ?? null,
    planId: partial.planId ?? "starter",
    planName: partial.planName ?? "Starter Host",
    monthlyUsd: partial.monthlyUsd ?? 49,
    rawStatus: partial.rawStatus,
    paymentState: partial.paymentState,
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
  };
}

function runBackOfficeBillingTests() {
  const payingStarter = sample({ userId: "paid", email: "paid@example.com", paymentState: "al_dia", rawStatus: "active" });
  const trialStarter = sample({
    userId: "trial",
    email: "trial@example.com",
    paymentState: "sin_suscripcion",
    rawStatus: "trial",
    trialActive: true,
  });
  const complimentaryPro = sample({
    userId: "comp",
    email: "comp@example.com",
    planId: "pro",
    planName: "Pro Superhost",
    monthlyUsd: 99,
    paymentState: "sin_suscripcion",
    rawStatus: "inactive",
    complimentaryActive: true,
  });
  const pastDuePro = sample({
    userId: "due",
    email: "due@example.com",
    planId: "pro",
    planName: "Pro Superhost",
    monthlyUsd: 99,
    paymentState: "moroso",
    rawStatus: "past_due",
    squareSubscriptionId: "sq_sub_due",
    failedPayments: [{ id: "fail", at: "2026-09-06T12:00:00.000Z", amountUsd: 99 }],
  });

  assert(isPayingBillingSubscriber(payingStarter), "active paid subscriber contributes MRR");
  assert(!isPayingBillingSubscriber(trialStarter), "trial excluded from MRR");
  assert(!isPayingBillingSubscriber(complimentaryPro), "complimentary excluded from MRR");
  assert(!isPayingBillingSubscriber(pastDuePro), "past due excluded from current MRR");

  const plans = summarizeAdminBillingByPlan([payingStarter, trialStarter, complimentaryPro, pastDuePro]);
  const starter = plans.find((row) => row.planId === "starter");
  const pro = plans.find((row) => row.planId === "pro");
  assert(plans.length === 4, "all catalog plans represented without inventing plans");
  assert(starter?.accountCount === 2 && starter.payingCount === 1, "starter counts assigned and paying separately");
  assert(starter?.mrrUsd === 49 && starter.trialCount === 1, "starter MRR and trial rollup");
  assert(pro?.accountCount === 2 && pro.mrrUsd === 0, "non-paying Pro accounts do not create MRR");
  assert(pro?.complimentaryCount === 1 && pro.pastDueCount === 1, "Pro access and dunning signals roll up");
  assert(formatBillingUsd(149) === "$149.00", "billing USD format");

  const root = process.cwd();
  const page = readFileSync(join(root, "src/app/(founder-admin)/backoffice/billing/page.tsx"), "utf8");
  const panel = readFileSync(join(root, "src/components/admin/backoffice-billing-panel.tsx"), "utf8");
  const billing = readFileSync(join(root, "src/lib/admin-billing.ts"), "utf8");
  const nav = readFileSync(join(root, "src/components/admin/backoffice-nav.tsx"), "utf8");

  assert(page.includes("getAdminBillingSnapshot"), "Billing uses live admin snapshot");
  assert(page.includes("BackOfficeBillingPanel"), "Billing renders read-only panel");
  assert(!page.includes("BackOfficeComingNext"), "Billing placeholder removed");
  assert(page.includes("host_subscriptions") && page.includes("subscription_payments"), "live sources disclosed");
  assert(panel.includes("Square subscription ID"), "stored Square subscription id shown");
  assert(panel.includes("nextChargeAt"), "next charge shown when available");
  assert(panel.includes("failedPayments"), "failed payment signal shown when available");
  assert(panel.includes("trialDaysRemaining") && panel.includes("complimentaryDaysRemaining"), "existing access timing reused");
  assert(panel.includes("no cancel, pause, resume") || panel.includes("Read-only"), "Square actions explicitly absent");
  assert(!page.includes("admin-revenue-store") && !panel.includes("admin-revenue-store"), "no demo revenue store");
  assert(!page.includes("fetch(") && !panel.includes("fetch("), "Phase 1 has no mutation API calls");
  assert(billing.includes("ZENCIERGE_PLANS"), "plan catalog remains the pricing source");
  assert(/href: "\/backoffice\/billing"[\s\S]*?status: "ready"/.test(nav), "Billing nav ready");

  const migrations = join(root, "supabase/migrations");
  const migrationNames = existsSync(migrations) ? readdirSync(migrations) : [];
  assert(!migrationNames.some((name) => /backoffice_billing|billing_phase1/i.test(name)), "Phase 1 created no migration");

  console.log("backoffice billing phase1 tests passed");
}

runBackOfficeBillingTests();