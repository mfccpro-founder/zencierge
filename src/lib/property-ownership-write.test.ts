import { readFileSync } from "node:fs";
import { join } from "node:path";
import { propertyFromRow, propertyToRow } from "./supabase-listings";
import type { Property } from "./dashboard-data";
import {
  formatBackOfficePropertyCount,
  propertyCountForHost,
} from "./backoffice-customers";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const sampleProperty: Property = {
  id: "prop-new",
  name: "Test Listing",
  city: "Miami Beach",
  address: "1 Main",
  status: "Vacant",
  revenue: "$0",
  doorCode: "",
  smartlock: "",
  wifiNetwork: "",
  wifiPassword: "",
  parking: "",
  gateCode: "",
  checkIn: "",
  checkOut: "",
  currentGuest: null,
  trash: "",
  handbook: "",
  assignedAvatarName: "Elena",
  assignedPhoneNumber: "",
  avatarSystemPrompt: "",
  timezone: "America/New_York",
};

function runPropertyOwnershipWriteTests() {
  const root = process.cwd();
  const listings = readFileSync(join(root, "src/lib/supabase-listings.ts"), "utf8");
  const route = readFileSync(join(root, "src/app/api/properties/route.ts"), "utf8");
  const serverStore = readFileSync(join(root, "src/lib/host-listings-server.ts"), "utf8");
  const customersPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/customers/page.tsx"),
    "utf8",
  );
  const table = readFileSync(
    join(root, "src/components/admin/backoffice-customers-table.tsx"),
    "utf8",
  );

  const updateRow = propertyToRow(sampleProperty);
  assert(!("host_id" in updateRow) || updateRow.host_id === undefined, "update mapping omits host_id");
  assert(
    propertyFromRow({ ...updateRow, city: "Savannah" }).city === "Savannah",
    "DAL preserves a free-form city instead of replacing it with Miami Beach",
  );

  assert(!listings.includes('@/lib/supabase"'), "mapping module has no anonymous database client");
  assert(!/\.from\(|\.insert\(|\.upsert\(|\.update\(/.test(listings), "mapping module performs no database operations");

  assert(route.includes("createHostPropertyAtomically"), "create uses the atomic server-only operation");
  assert(route.includes("hostId: auth.user.id"), "create uses authenticated host_id");
  assert(route.includes("updateHostProperty"), "update uses the server-only operation");
  assert(serverStore.includes("create_host_property_with_limit"), "create delegates limit enforcement to database RPC");
  assert(route.includes("host_id: _ignoredHostId") || route.includes("_ignoredHostId"), "client host_id stripped");
  assert(route.includes("hostOwnsProperty"), "update checks ownership");
  assert(route.includes("listOwnedPropertyIds"), "create plan limit uses owned ids");
  assert(route.includes("isSuperAdmin"), "founder update path preserved");
  assert(!route.includes("fetchListings"), "create/update no longer trusts global listings for ownership");
  assert(route.includes("validatePropertyWriteIdentity"), "server validates free-form city input");
  assert(route.includes("property.city = identity.value.city"), "server accepts the normalized free-form city");

  assert(customersPage.includes("loadPropertyCountsByHostId"), "customers load live property counts");
  assert(table.includes("formatBackOfficePropertyCount") || table.includes("propertyCountForHost"), "table shows real counts");
  assert(!table.includes("Not linked yet"), "customers table no longer hardcodes Not linked yet");

  assert(propertyCountForHost({ "user-a": 1 }, "user-a") === 1, "count helper");
  assert(propertyCountForHost({}, "user-a") === 0, "missing host is 0 not invented");
  assert(formatBackOfficePropertyCount(1) === "1 property", "format singular");

  console.log("property ownership write tests passed");
}

runPropertyOwnershipWriteTests();
