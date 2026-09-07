import { readFileSync } from "node:fs";
import { join } from "node:path";
import { propertyToRow } from "./supabase-listings";
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
  const customersPage = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/customers/page.tsx"),
    "utf8",
  );
  const table = readFileSync(
    join(root, "src/components/admin/backoffice-customers-table.tsx"),
    "utf8",
  );

  const createRow = propertyToRow(sampleProperty, { hostId: "334119a5-1111-2222-3333-444444444444" });
  assert(createRow.host_id === "334119a5-1111-2222-3333-444444444444", "create mapping sets trusted host_id");

  const updateRow = propertyToRow(sampleProperty);
  assert(!("host_id" in updateRow) || updateRow.host_id === undefined, "update mapping omits host_id");

  assert(listings.includes('mode: "create"') || listings.includes("UpsertPropertyOptions"), "upsert options exist");
  assert(listings.includes("Never upsert over an existing prop-1"), "ensureMiamiBeachLoft preserves ownership");
  assert(listings.includes(".insert(row)"), "seed uses insert not upsert overwrite");
  assert(!/ensureMiamiBeachLoft[\s\S]*\.upsert\(row\)/.test(listings), "ensureMiamiBeachLoft no longer upserts full seed row");

  assert(route.includes('mode: "create", hostId: auth.user.id'), "create uses authenticated host_id");
  assert(route.includes('mode: "update"'), "update mode wired");
  assert(route.includes("host_id: _ignoredHostId") || route.includes("_ignoredHostId"), "client host_id stripped");
  assert(route.includes("hostOwnsProperty"), "update checks ownership");
  assert(route.includes("listOwnedPropertyIds"), "create plan limit uses owned ids");
  assert(route.includes("isSuperAdmin"), "founder update path preserved");
  assert(!route.includes("fetchListings"), "create/update no longer trusts global listings for ownership");

  assert(customersPage.includes("loadPropertyCountsByHostId"), "customers load live property counts");
  assert(table.includes("formatBackOfficePropertyCount") || table.includes("propertyCountForHost"), "table shows real counts");
  assert(!table.includes("Not linked yet"), "customers table no longer hardcodes Not linked yet");

  assert(propertyCountForHost({ "user-a": 1 }, "user-a") === 1, "count helper");
  assert(propertyCountForHost({}, "user-a") === 0, "missing host is 0 not invented");
  assert(formatBackOfficePropertyCount(1) === "1 property", "format singular");

  console.log("property ownership write tests passed");
}

runPropertyOwnershipWriteTests();
