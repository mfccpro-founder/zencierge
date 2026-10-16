import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const provider = read("src/components/dashboard/listings-provider.tsx");
const propertyRoute = read("src/app/api/properties/route.ts");
const reservationRoute = read("src/app/api/reservations/route.ts");
const billingRoute = read("src/app/api/billing/subscription/route.ts");
const serverStore = read("src/lib/host-listings-server.ts");
const principalSupport = read(
  "supabase/review/principal/20261014120000_properties_atomic_create_support.sql",
);
const principalLockdown = read(
  "supabase/review/principal/20261014130000_properties_lockdown.sql",
);
const sandboxBootstrap = read(
  "supabase/review/sandbox/20261014120000_create_properties_secure.sql",
);

assert(!provider.includes("supabase-listings"), "dashboard does not import the anonymous listings client");
assert(provider.includes('fetch("/api/properties"'), "dashboard listings use authenticated server route");
assert(provider.includes('fetch("/api/reservations"'), "reservation writes use authenticated server route");
assert(propertyRoute.includes("requireHostUser"), "properties route authenticates hosts");
assert(propertyRoute.includes("createHostPropertyAtomically"), "create uses atomic server operation");
assert(reservationRoute.includes("upsertOwnedReservation"), "reservation route checks property ownership");
assert(billingRoute.includes("countHostProperties"), "billing uses remote host-scoped count");
assert(!billingRoute.includes("fetchListings"), "billing does not count anonymous/global/demo listings");
assert(serverStore.includes('count: "exact", head: true'), "count is an exact remote count");
assert(serverStore.includes("if (error || count === null)"), "count failure is unavailable, never zero");

for (const sql of [principalSupport, sandboxBootstrap]) {
  assert(sql.includes("pg_advisory_xact_lock"), "create serializes limit checks per host");
  assert(sql.includes("where host_id = p_host_id"), "create counts only the remote host rows");
  assert(sql.includes("errcode = 'ZP001'"), "create has a stable plan-limit error");
  assert(
    sql.includes("revoke all on function public.create_host_property_with_limit") &&
      sql.includes("from authenticated"),
    "authenticated cannot invoke the mutation RPC directly",
  );
}

assert(principalLockdown.includes("enable row level security"), "principal containment enables RLS");
assert(principalLockdown.includes("force row level security"), "principal containment forces RLS");
assert(
  principalLockdown.includes("revoke all privileges on table public.properties from anon") &&
    principalLockdown.includes("revoke all privileges on table public.properties from authenticated"),
  "principal containment removes direct API-role table grants",
);
assert(!/grant\s+(insert|update|delete).*\b(anon|authenticated)\b/i.test(principalLockdown), "no direct API-role mutations");
assert(sandboxBootstrap.includes("create table public.properties"), "sandbox creates the missing table");
assert(!/create table if not exists/i.test(sandboxBootstrap), "sandbox bootstrap fails on unexpected pre-existing table");

console.log("properties security boundary tests passed");
