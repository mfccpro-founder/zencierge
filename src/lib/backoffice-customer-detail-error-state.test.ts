import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdminSubscriberRow } from "./admin-billing";
import { findBackOfficeCustomer } from "./backoffice-customers";

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

function runCustomerDetailErrorStateTests() {
  const root = process.cwd();
  const detailPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/customers/[id]/page.tsx"),
    "utf8",
  );

  assert(detailPage.includes("getAdminBillingSnapshot"), "healthy path still loads live snapshot");
  assert(detailPage.includes("findBackOfficeCustomer"), "healthy path still looks up customer");
  assert(detailPage.includes("BackOfficeComplimentaryPanel"), "existing detail still renders when found");
  assert(!detailPage.includes("notFound("), "blind notFound() removed");
  assert(!detailPage.includes('from "next/navigation"'), "next/navigation notFound import removed");

  assert(detailPage.includes("!snapshot.serviceRoleReady || snapshot.error"), "snapshot error branch exists");
  assert(
    detailPage.includes("Live customer data could not be loaded"),
    "snapshot error shows Founder load failure copy",
  );
  assert(
    detailPage.includes("SUPABASE_SERVICE_ROLE_KEY") || detailPage.includes("snapshot.error"),
    "snapshot error surfaces billing/admin-style message",
  );

  assert(
    detailPage.includes("Customer not found in the current live billing snapshot"),
    "missing customer shows clear Founder state",
  );
  assert(detailPage.includes('href="/backoffice/customers"'), "error states link back to Customers");
  assert(detailPage.includes("Snapshot has"), "missing-customer state reports snapshot size");

  const existing = sample({
    userId: "334119a5-44b0-4567-8184-c2c6ff83a49e",
    email: "found@example.com",
    paymentState: "sin_suscripcion",
    rawStatus: "inactive",
  });
  assert(
    findBackOfficeCustomer([existing], existing.userId)?.email === "found@example.com",
    "healthy snapshot + existing customer resolves",
  );
  assert(
    findBackOfficeCustomer([existing], "missing-id") === null,
    "healthy snapshot + missing id returns null (page must not call notFound)",
  );

  console.log("customer detail error-state tests passed");
}

runCustomerDetailErrorStateTests();
