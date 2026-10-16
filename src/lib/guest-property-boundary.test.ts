import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const read = (path: string) => readFileSync(path, "utf8");
const helper = read("src/lib/guest-property-access.ts");
for (const route of ["chat", "avatar", "places/nearby"]) {
  const source = read(`src/app/api/${route}/route.ts`);
  assert(source.includes("authorizeGuestProperty"), `${route} validates guest property access`);
  assert(source.includes('Object.hasOwn(body, "token")'), `${route} treats a supplied token as authoritative`);
  assert(source.includes("requireHostUser"), `${route} preserves host access`);
}
assert(helper.includes("validateGuestStayToken"), "shared helper validates expiry/revocation/reservation");
assert(helper.includes("requested !== tokenRow.property_id"), "guest token cannot cross property boundary");
assert(helper.includes('select("property_id")'), "token lookup exposes only its property id");

const propertiesRoute = read("src/app/api/properties/route.ts");
const listings = read("src/lib/host-listings-server.ts");
assert(propertiesRoute.includes("isSuperAdmin(auth.user)"), "superadmin override remains explicit");
assert(!propertiesRoute.includes("planFromMetadata"), "property limit never trusts user-editable plan metadata");
assert(propertiesRoute.includes("metadata: auth.user.app_metadata"), "entitlement metadata is server-controlled auth metadata");
assert(propertiesRoute.includes("hostId: auth.user.id"), "RPC host id comes from authenticated server identity");
assert(propertiesRoute.includes('ownership.kind === "owned" ? auth.user.id : undefined'), "superadmin cross-host update is not silently host-filtered");
assert(!listings.match(/\.update\([^)]*host_id/), "update helper never writes host_id");
assert(listings.includes('query.eq("host_id", expectedHostId)'), "ordinary host updates retain ownership filter");

console.log("guest property boundary tests passed");
