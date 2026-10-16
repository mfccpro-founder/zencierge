import assert from "node:assert/strict";
import { privatePilotDemoAccessGranted } from "./private-pilot-entitlement.ts";

const enabled = { ZENCIERGE_PRIVATE_PILOT_SAFE_MODE: "true" };
const now = new Date("2026-10-16T12:00:00.000Z");
assert.equal(privatePilotDemoAccessGranted({ planId: "pro", complimentaryEndsAt: "2026-11-16T12:00:00.000Z" }, enabled, now), true);
assert.equal(privatePilotDemoAccessGranted({ planId: "pro", complimentaryEndsAt: "2026-10-16T12:00:00.000Z" }, enabled, now), false);
assert.equal(privatePilotDemoAccessGranted({ planId: "starter", complimentaryEndsAt: "2026-11-16T12:00:00.000Z" }, enabled, now), false);
assert.equal(privatePilotDemoAccessGranted({ planId: "pro", complimentaryEndsAt: null }, enabled, now), false);
assert.equal(privatePilotDemoAccessGranted({}, {}, now), true);
console.log("Private pilot entitlement tests passed");
