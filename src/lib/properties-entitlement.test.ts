import { readFileSync } from "node:fs";
import { isHostAccessGranted } from "./zencierge-plans";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

assert(!isHostAccessGranted({}), "missing billing authorization is denied");
assert(!isHostAccessGranted({ subscriptionStatus: "inactive" }), "starter fallback plus inactive billing is denied");
assert(!isHostAccessGranted({ subscriptionStatus: "trial", metadata: { trial_ends_at: past } }), "expired trial is denied");
assert(!isHostAccessGranted({ metadata: { plan: "agency" } }), "a plan label alone grants nothing");
assert(isHostAccessGranted({ subscriptionStatus: "trial", metadata: { trial_ends_at: future } }), "trusted current trial is allowed");
assert(isHostAccessGranted({ subscriptionStatus: "active" }), "trusted legacy active subscription is allowed");
assert(isHostAccessGranted({ isLifetimeFree: true }), "trusted lifetime billing flag is allowed");

const propertiesRoute = readFileSync(join(process.cwd(), "src/app/api/properties/route.ts"), "utf8");
const accessGate = propertiesRoute.indexOf("if (!billed)");
const createBranch = propertiesRoute.indexOf("if (isCreate)");
const updateCall = propertiesRoute.indexOf("const updated = await updateHostProperty");
assert(accessGate > 0 && accessGate < createBranch, "inactive access blocks property creation");
assert(accessGate < updateCall, "inactive access blocks property updates without deleting stored data");
assert(propertiesRoute.includes("subscriptionError"), "billing read failure is unavailable, never inactive fallback data");
assert(!propertiesRoute.includes("host_id: body"), "client ownership is never trusted");

const route = readFileSync("src/app/api/properties/route.ts", "utf8");
assert(route.includes('parsePlanId(sub?.plan_id) ?? "starter"'), "unknown plan falls back to starter limits");
assert(route.includes("if (!billed)"), "fallback plan remains behind entitlement gate");
assert(route.indexOf("if (!billed)") < route.indexOf("createHostPropertyAtomically({"), "entitlement gate precedes RPC");
assert(!route.includes("planFromMetadata"), "editable user metadata does not choose a plan");
assert(route.includes("metadata: auth.user.app_metadata"), "only trusted Auth app metadata reaches entitlement check");

console.log("properties entitlement tests passed");
