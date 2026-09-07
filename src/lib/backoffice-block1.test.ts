import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function runBackOfficeBlock1Tests() {
  const root = process.cwd();
  const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
  const layout = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/layout.tsx"),
    "utf8",
  );
  const overview = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/page.tsx"),
    "utf8",
  );
  const nav = readFileSync(join(root, "src/components/admin/backoffice-nav.tsx"), "utf8");
  const adminAuth = readFileSync(join(root, "src/lib/admin-auth.ts"), "utf8");
  const adminPage = readFileSync(join(root, "src/app/(founder-admin)/admin/page.tsx"), "utf8");

  assert(middleware.includes('path.startsWith("/backoffice")'), "middleware treats /backoffice as founder surface");
  assert(middleware.includes("isFounderSurface"), "middleware shares founder gate for /admin and /backoffice");
  assert(middleware.includes("isSuperAdmin"), "middleware still uses isSuperAdmin");
  assert(middleware.includes('"/backoffice"') || middleware.includes('"/backoffice/:path*"'), "matcher includes /backoffice");
  assert(middleware.includes('value.startsWith("/backoffice")'), "login next= allows /backoffice");

  assert(layout.includes("isSuperAdmin"), "backoffice layout uses isSuperAdmin");
  assert(layout.includes("requireHostUser"), "backoffice layout requires authenticated user");
  assert(layout.includes('redirect("/login?next=/backoffice")'), "unauthenticated users redirect to login");
  assert(layout.includes('redirect("/dashboard")'), "ordinary hosts redirect to dashboard");
  assert(layout.includes("Zencierge Founder Back Office"), "Founder Back Office branding");

  assert(overview.includes("getAdminBillingSnapshot"), "Overview uses live billing snapshot");
  assert(overview.includes("metrics.alDia"), "Overview shows paying customers");
  assert(overview.includes("metrics.morosos"), "Overview shows past-due customers");
  assert(overview.includes("metrics.cancelados"), "Overview shows canceled customers");
  assert(overview.includes("metrics.mrr"), "Overview shows MRR");
  assert(overview.includes("metrics.failedPayments30d"), "Overview shows failed payments 30d");
  assert(overview.includes("metrics.complimentary"), "Overview shows complimentary count");
  assert(overview.includes("metrics.trials"), "Overview shows trial count");
  assert(overview.includes("getAiUsageMonthSnapshot"), "Overview shows measured Isabela usage");
  assert(overview.includes("Exact cost") || overview.includes("exactTrackedCostLabel"), "Overview shows exact cost label");
  assert(!overview.includes("Usage tracking not instrumented yet"), "Isabela usage is instrumented");
  assert(overview.includes("getAdminSystemHealthSnapshot"), "Overview shows live System Health");
  assert(overview.includes("Open System Health") || overview.includes("/backoffice/system"), "Overview links to System");
  assert(!overview.includes("System monitoring — not instrumented"), "system placeholder removed");
  assert(!overview.includes("admin-revenue-store"), "Overview does not import demo Revenue store");
  assert(!overview.includes("getAdminRevenueSnapshot"), "Overview does not use demo revenue snapshot");
  assert(!overview.includes("Pricing not configured yet"), "Overview Phase 1 cost stub removed");

  assert(nav.includes("/backoffice/customers"), "nav includes Customers");
  assert(!nav.includes("/backoffice/properties"), "nav does not include Properties as a primary section");
  assert(!nav.includes('label: "Properties"'), "Properties label removed from primary nav");
  assert(nav.includes("/backoffice/billing"), "nav includes Billing");
  assert(nav.includes("/backoffice/isabela-usage"), "nav includes Isabela Usage");
  assert(nav.includes("/backoffice/income"), "nav includes Income");
  assert(nav.includes("/backoffice/payroll-expenses"), "nav includes Payroll & Expenses");
  assert(nav.includes("/backoffice/profit"), "nav includes Profit");
  assert(nav.includes("/backoffice/system"), "nav includes System");
  assert(nav.includes("Coming next") || nav.includes("Soon"), "unfinished sections marked");

  const navOrder = [
    nav.indexOf('href: "/backoffice"'),
    nav.indexOf('href: "/backoffice/customers"'),
    nav.indexOf('href: "/backoffice/billing"'),
    nav.indexOf('href: "/backoffice/isabela-usage"'),
    nav.indexOf('href: "/backoffice/income"'),
    nav.indexOf('href: "/backoffice/payroll-expenses"'),
    nav.indexOf('href: "/backoffice/profit"'),
    nav.indexOf('href: "/backoffice/system"'),
  ];
  assert(navOrder.every((index) => index >= 0), "owner nav links all present");
  assert(
    navOrder.every((index, i) => i === 0 || index > navOrder[i - 1]!),
    "owner nav order is Overview → Customers → Billing → Isabela → Income → Payroll → Profit → System",
  );

  assert(adminAuth.includes("export function isSuperAdmin"), "reuses existing isSuperAdmin — no second auth system");
  assert(adminPage.includes("getAdminBillingSnapshot"), "/admin Overview still uses live billing");
  assert(existsSync(join(root, "src/app/(founder-admin)/admin/page.tsx")), "/admin still present");

  const migrationsDir = join(root, "supabase/migrations");
  const migrationNames = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
  assert(
    migrationNames.some((name) => name.includes("ai_usage_events")),
    "Phase 1 ai_usage_events migration exists",
  );

  const customersPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/customers/page.tsx"),
    "utf8",
  );
  assert(customersPage.includes("getAdminBillingSnapshot"), "Customers uses live billing snapshot");
  assert(!customersPage.includes("BackOfficeComingNext"), "Customers is no longer a Coming next stub");

  const isabelaPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/isabela-usage/page.tsx"),
    "utf8",
  );
  assert(isabelaPage.includes("getAiUsageMonthSnapshot"), "Isabela Usage page reads measured events");
  assert(isabelaPage.includes("Exact tracked cost") || isabelaPage.includes("exactTrackedCostLabel"), "Isabela Usage shows exact cost");
  assert(isabelaPage.includes("Awaiting exact pricing") || isabelaPage.includes("pendingExactPricing"), "Isabela Usage shows pending pricing");
  assert(!isabelaPage.includes("BackOfficeComingNext"), "Isabela Usage is no longer Coming next");
  assert(!isabelaPage.includes("Pricing not configured yet"), "Phase 1 pricing stub removed");

  const billingPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/billing/page.tsx"),
    "utf8",
  );
  assert(billingPage.includes("getAdminBillingSnapshot"), "Billing uses live billing snapshot");
  assert(billingPage.includes("BackOfficeBillingPanel"), "Billing mounts read-only detail panel");
  assert(!billingPage.includes("BackOfficeComingNext"), "Billing is no longer Coming next");
  assert(!billingPage.includes("admin-revenue-store"), "Billing does not use demo revenue store");

  const incomePage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/income/page.tsx"),
    "utf8",
  );
  assert(incomePage.includes("getAdminIncomeSnapshot"), "Income uses live income snapshot");
  assert(!incomePage.includes("BackOfficeComingNext"), "Income is no longer Coming next");
  assert(!incomePage.includes("admin-revenue-store"), "Income does not use demo revenue store");
  assert(incomePage.includes("Recurring run-rate") || incomePage.includes("mrrNote"), "Income keeps MRR distinct");

  const payrollPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/payroll-expenses/page.tsx"),
    "utf8",
  );
  assert(payrollPage.includes("getAdminExpensesSnapshot"), "Payroll & Expenses uses live expenses snapshot");
  assert(!payrollPage.includes("BackOfficeComingNext"), "Payroll & Expenses is no longer Coming next");
  assert(payrollPage.includes("BackOfficeExpensesPanel"), "Payroll & Expenses mounts CRUD panel");
  assert(
    migrationNames.some((name) => name.includes("business_expenses")),
    "business_expenses migration exists",
  );
  assert(
    /href: "\/backoffice\/payroll-expenses"[\s\S]*?status: "ready"/.test(nav),
    "Payroll & Expenses nav marked ready",
  );

  const profitPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/profit/page.tsx"),
    "utf8",
  );
  assert(profitPage.includes("getAdminProfitSnapshot"), "Profit uses live profit snapshot");
  assert(!profitPage.includes("BackOfficeComingNext"), "Profit is no longer Coming next");
  assert(profitPage.includes("Net Operating Profit"), "Profit shows net operating profit");
  assert(
    /href: "\/backoffice\/profit"[\s\S]*?status: "ready"/.test(nav),
    "Profit nav marked ready",
  );

  const systemPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/system/page.tsx"),
    "utf8",
  );
  assert(systemPage.includes("getAdminSystemHealthSnapshot"), "System uses live health snapshot");
  assert(!systemPage.includes("BackOfficeComingNext"), "System is no longer Coming next");
  assert(
    /href: "\/backoffice\/system"[\s\S]*?status: "ready"/.test(nav),
    "System nav marked ready",
  );

  assert(
    existsSync(join(root, "src/app/(founder-admin)/backoffice/properties/page.tsx")),
    "properties route retained for internal/legacy access (not primary nav)",
  );

  console.log("backoffice block1 tests passed");
}

runBackOfficeBlock1Tests();
