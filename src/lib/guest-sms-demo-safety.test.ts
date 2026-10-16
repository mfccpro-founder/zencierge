import assert from "node:assert/strict";
import { sendGuestHouseRulesSms } from "./guest-sms.ts";

const previous = process.env.ZENCIERGE_PRIVATE_PILOT_SAFE_MODE;
process.env.ZENCIERGE_PRIVATE_PILOT_SAFE_MODE = "true";
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network must not be called in demo safe mode");
};

try {
  const result = await sendGuestHouseRulesSms("+1 202-555-0123", "Fictional notice");
  assert.equal(result.delivered, false);
  assert.equal(result.simulated, true);
  assert.equal(fetchCalls, 0);
} finally {
  globalThis.fetch = originalFetch;
  if (previous === undefined) delete process.env.ZENCIERGE_PRIVATE_PILOT_SAFE_MODE;
  else process.env.ZENCIERGE_PRIVATE_PILOT_SAFE_MODE = previous;
}

console.log("Guest SMS demo safety test passed");
