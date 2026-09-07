import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AdminSubscriberRow } from "./admin-billing";
import {
  backOfficeCustomerStatusLabel,
  customerMatchesFilter,
  filterBackOfficeCustomers,
  findBackOfficeCustomer,
  isTrialCustomer,
} from "./backoffice-customers";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sample(partial: Partial<AdminSubscriberRow> & Pick<AdminSubscriberRow, "userId" | "email" | "paymentState" | "rawStatus">): AdminSubscriberRow {
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

function runBackOfficeBlock2Tests() {
  const root = process.cwd();
  const customersPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/customers/page.tsx"),
    "utf8",
  );
  const detailPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/customers/[id]/page.tsx"),
    "utf8",
  );
  const table = readFileSync(
    join(root, "src/components/admin/backoffice-customers-table.tsx"),
    "utf8",
  );
  const nav = readFileSync(join(root, "src/components/admin/backoffice-nav.tsx"), "utf8");
  const overview = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/page.tsx"),
    "utf8",
  );
  const layout = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/layout.tsx"),
    "utf8",
  );

  assert(customersPage.includes("getAdminBillingSnapshot"), "customers page uses live billing snapshot");
  assert(!customersPage.includes("admin-revenue-store"), "no demo revenue store on customers");
  assert(!customersPage.includes("getAdminRevenueSnapshot"), "no demo revenue snapshot");
  assert(customersPage.includes("BackOfficeCustomersTable"), "customers table rendered");
  assert(customersPage.includes("loadPropertyCountsByHostId"), "customers use live host_id counts");
  assert(table.includes("propertyCountForHost") || table.includes("formatBackOfficePropertyCount"), "table renders real property counts");
  assert(!table.includes("Not linked yet"), "table no longer hardcodes Not linked yet");
  assert(table.includes("Not instrumented"), "Isabela usage not faked");
  assert(!/\$0\.00/.test(table), "no fake $0.00 on customer table");

  assert(detailPage.includes("getAdminBillingSnapshot"), "detail uses live snapshot");
  assert(detailPage.includes("findBackOfficeCustomer"), "detail looks up live customer");
  assert(detailPage.includes("loadPropertyCountsByHostId") || detailPage.includes("formatBackOfficePropertyCount"), "detail uses live property counts");
  assert(detailPage.includes("BackOfficeComplimentaryPanel") || detailPage.includes("Complimentary"), "detail has complimentary panel");
  assert(detailPage.includes("Not instrumented"), "detail Isabela placeholder");
  assert(!detailPage.includes("notFound("), "detail no longer uses blind notFound()");
  assert(!detailPage.includes("admin-revenue-store"), "detail avoids demo revenue");

  assert(layout.includes("isSuperAdmin"), "customers inherit Founder layout gate");
  assert(nav.includes('href: "/backoffice/customers"') && nav.includes('status: "ready"'), "Customers nav activated");
  assert(overview.includes("getAdminBillingSnapshot"), "Block 1 Overview still live");

  const paying = sample({
    userId: "u1",
    email: "pay@example.com",
    fullName: "Pay Host",
    paymentState: "al_dia",
    rawStatus: "active",
  });
  const trial = sample({
    userId: "u2",
    email: "trial@example.com",
    fullName: "Trial Host",
    paymentState: "sin_suscripcion",
    rawStatus: "inactive",
    trialActive: true,
    trialEndsAt: "2026-09-19T12:00:00.000Z",
  });
  const pastDue = sample({
    userId: "u3",
    email: "late@example.com",
    fullName: "Late Host",
    paymentState: "moroso",
    rawStatus: "past_due",
  });
  const canceled = sample({
    userId: "u4",
    email: "gone@example.com",
    fullName: "Gone Host",
    paymentState: "cancelado",
    rawStatus: "canceled",
  });
  const rows = [paying, trial, pastDue, canceled];

  assert(isTrialCustomer(trial), "trial detected from rawStatus");
  assert(customerMatchesFilter(paying, "paying"), "paying filter");
  assert(customerMatchesFilter(trial, "trial"), "trial filter");
  assert(customerMatchesFilter(pastDue, "past_due"), "past due filter");
  assert(customerMatchesFilter(canceled, "canceled"), "canceled filter");
  assert(backOfficeCustomerStatusLabel(paying) === "Paying", "paying label");
  assert(backOfficeCustomerStatusLabel(trial) === "14-Day Trial", "trial label");

  const searched = filterBackOfficeCustomers(rows, { query: "trial@", filter: "all" });
  assert(searched.length === 1 && searched[0]?.userId === "u2", "search by email works");

  const filteredPaying = filterBackOfficeCustomers(rows, { query: "", filter: "paying" });
  assert(filteredPaying.length === 1 && filteredPaying[0]?.userId === "u1", "status filter works");

  const empty = filterBackOfficeCustomers(rows, { query: "nobody-matches", filter: "all" });
  assert(empty.length === 0, "empty search result supported");
  assert(table.includes("No customers match") || table.includes("No customers yet"), "empty states present");

  assert(findBackOfficeCustomer(rows, "u3")?.email === "late@example.com", "detail lookup works");
  assert(findBackOfficeCustomer(rows, "missing") === null, "missing customer is null");

  const migrationsDir = join(root, "supabase/migrations");
  const migrationNames = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
  assert(
    !migrationNames.some((name) => /backoffice_block2|customer_comp/i.test(name)),
    "Block 2 created no migrations",
  );

  assert(table.includes("filterBackOfficeCustomers") || table.includes("BackOfficeCustomerFilter") || table.includes('filter === chip.id'), "client filters wired");
  assert(!customersPage.includes("upsert") && !detailPage.includes("update("), "no billing mutations in pages");

  console.log("backoffice block2 customers tests passed");
}

runBackOfficeBlock2Tests();
