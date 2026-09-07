import {
  complimentaryEndsAtFromPreset,
  evaluateSquareCompSafety,
  isComplimentaryWindowOpen,
  complimentaryDaysRemaining,
} from "./complimentary-access-core";
import { isHostAccessGranted } from "./zencierge-plans";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function runComplimentaryBlock3Tests() {
  const now = new Date("2026-09-05T12:00:00.000Z");
  const sixMonths = complimentaryEndsAtFromPreset(6, now);
  const end = new Date(sixMonths);
  assert(end.getUTCFullYear() === 2027 && end.getUTCMonth() === 2 && end.getUTCDate() === 5, "6-month grant lands on 2027-03-05");
  assert(isComplimentaryWindowOpen(sixMonths, now), "future complimentary window is open");
  assert(!isComplimentaryWindowOpen(sixMonths, new Date("2027-03-06T00:00:00.000Z")), "expired complimentary closes");
  assert(complimentaryDaysRemaining(sixMonths, now) > 170, "days remaining for 6 months");

  assert(
    evaluateSquareCompSafety({ status: "inactive", squareSubscriptionId: null }).ok,
    "no Square sub is safe",
  );
  assert(
    evaluateSquareCompSafety({ status: "canceled", squareSubscriptionId: "sq_sub" }).ok,
    "canceled Square sub is safe",
  );
  assert(
    !evaluateSquareCompSafety({ status: "active", squareSubscriptionId: "sq_sub" }).ok,
    "active Square sub is blocked",
  );
  assert(
    !evaluateSquareCompSafety({ status: "past_due", squareSubscriptionId: "sq_sub" }).ok,
    "past_due Square sub is blocked",
  );

  assert(
    isHostAccessGranted({
      subscriptionStatus: "inactive",
      complimentaryEndsAt: sixMonths,
    }),
    "complimentary grants host access",
  );
  assert(
    !isHostAccessGranted({
      subscriptionStatus: "inactive",
      complimentaryEndsAt: "2020-01-01T00:00:00.000Z",
    }),
    "expired complimentary does not grant access",
  );
  assert(
    isHostAccessGranted({
      subscriptionStatus: "active",
      complimentaryEndsAt: null,
    }),
    "paid users remain paid",
  );
  assert(
    isHostAccessGranted({
      subscriptionStatus: "inactive",
      isLifetimeFree: true,
    }),
    "lifetime free remains intact",
  );
  assert(
    !isHostAccessGranted({
      subscriptionStatus: "trial",
      metadata: {},
    }),
    "bare trial status without ends_at does not grant access",
  );

  const root = process.cwd();
  const migration = join(root, "supabase/migrations/20260905220500_host_subscriptions_complimentary.sql");
  assert(existsSync(migration), "complimentary migration exists");
  const sql = readFileSync(migration, "utf8");
  assert(sql.includes("complimentary_ends_at"), "migration adds ends_at");
  assert(sql.includes("complimentary_starts_at"), "migration adds starts_at");
  assert(sql.includes("complimentary_granted_by"), "migration adds granted_by");
  assert(!/square/i.test(sql) || sql.toLowerCase().includes("no square"), "migration does not mutate Square");

  const route = readFileSync(
    join(root, "src/app/api/backoffice/customers/[id]/complimentary/route.ts"),
    "utf8",
  );
  assert(route.includes("isSuperAdmin"), "write API requires SuperAdmin");
  assert(route.includes("applyComplimentaryAccess"), "write API uses server mutation");
  assert(route.includes('status: 403'), "non-founder forbidden");

  const applySrc = readFileSync(join(root, "src/lib/complimentary-access.ts"), "utf8");
  assert(applySrc.includes("evaluateSquareCompSafety"), "mutation checks Square safety");
  assert(applySrc.includes("Never calls Square") || applySrc.includes("never"), "no Square API calls in mutation");
  assert(!applySrc.includes("createSquare") && !applySrc.includes("SquareClient"), "no Square client usage");

  const checkout = readFileSync(join(root, "src/app/api/payments/square/checkout/route.ts"), "utf8");
  assert(checkout.includes("isComplimentaryWindowOpen"), "checkout skips Square while complimentary");
  assert(checkout.includes("squareSkipped: true"), "checkout returns squareSkipped for complimentary");

  const billing = readFileSync(join(root, "src/lib/admin-billing.ts"), "utf8");
  assert(billing.includes("complimentaryActive"), "admin billing tracks complimentary");
  assert(billing.includes("!row.complimentaryActive"), "MRR excludes complimentary");

  const panel = readFileSync(
    join(root, "src/components/admin/backoffice-complimentary-panel.tsx"),
    "utf8",
  );
  assert(panel.includes("Grant complimentary"), "detail panel grant control");
  assert(panel.includes("Extend"), "detail panel extend");
  assert(panel.includes("End complimentary"), "detail panel end");

  const migrationsDir = join(root, "supabase/migrations");
  const names = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
  assert(
    names.filter((name) => /complimentary/i.test(name)).length === 1,
    "only one complimentary migration",
  );

  console.log("complimentary block3 tests passed");
}

runComplimentaryBlock3Tests();
