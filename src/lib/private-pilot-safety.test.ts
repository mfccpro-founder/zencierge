import assert from "node:assert/strict";
import {
  privatePilotBlockedPath,
  privatePilotHostIds,
  privatePilotHostAuthorized,
  privatePilotSafeMode,
  isPrivatePilotHost,
} from "./private-pilot-safety.ts";

const env = {
  ZENCIERGE_PRIVATE_PILOT_SAFE_MODE: "true",
  ZENCIERGE_PRIVATE_PILOT_HOST_IDS: "pilot-a, pilot-b",
};
assert.equal(privatePilotSafeMode(env), true);
assert.deepEqual([...privatePilotHostIds(env)], ["pilot-a", "pilot-b"]);
assert.equal(isPrivatePilotHost("pilot-a", env), true);
assert.equal(isPrivatePilotHost("other", env), false);
assert.equal(privatePilotHostAuthorized("pilot-a", env), true);
assert.equal(privatePilotHostAuthorized("other", env), false);
assert.equal(privatePilotHostAuthorized("other", {}), true);
for (const path of ["/signup", "/admin", "/backoffice/customers", "/centro", "/api/admin/neighbor-shield", "/api/backoffice/expenses", "/api/finance/overview", "/api/checkout", "/api/payments/square/subscribe", "/api/dev/stripe-sandbox/checkout", "/api/webhooks/square", "/api/webhooks/subscriptions", "/api/inbound", "/api/housekeeping/reports", "/api/housekeeping/upload", "/housekeeping/upload", "/api/auth/pending-host", "/api/auth/dev-session"]) {
  assert.equal(privatePilotBlockedPath(path), true, `${path} must be blocked`);
}
for (const path of ["/login", "/dashboard", "/api/properties", "/api/guest/stay-chat", "/api/housekeeping/proof/upload", "/api/housekeeping/proof-photos"]) {
  assert.equal(privatePilotBlockedPath(path), false, `${path} must remain available`);
}
console.log("Private pilot safety tests passed");
