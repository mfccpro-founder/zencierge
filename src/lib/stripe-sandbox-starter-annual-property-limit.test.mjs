import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { runStripeStarterAnnualPropertyLimitCheck } = await import(
  "./stripe-sandbox-starter-annual-property-limit.ts"
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function annual(count) {
  return {
    status: "active",
    accessSource: "stripe_sandbox",
    trialActive: false,
    planId: "starter",
    billingCycle: "annual",
    maxProperties: 1,
    propertyCount: count,
  };
}

const calls = [];
let reads = 0;
const result = await runStripeStarterAnnualPropertyLimitCheck({
  async readSubscription() {
    reads += 1;
    return annual(reads === 1 ? 0 : 1);
  },
  async createProperty(sequence) {
    calls.push(sequence);
    return { status: sequence === 2 ? 403 : 201, ok: sequence === 1 };
  },
});
assert(calls.join(",") === "1,2", "one TEST creation is followed by one rejected attempt");
assert(reads === 2 && result.startsWith("PASS:"), "final remote count is read and reported");

for (const bad of [
  { ...annual(1) },
  { ...annual(0), billingCycle: "monthly" },
  { ...annual(0), accessSource: "standard" },
]) {
  const writes = [];
  let message = "";
  try {
    await runStripeStarterAnnualPropertyLimitCheck({
      async readSubscription() { return bad; },
      async createProperty(sequence) {
        writes.push(sequence);
        return { status: 201, ok: true };
      },
    });
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  assert(writes.length === 0, "unexpected count or entitlement stops before every write");
  assert(message.length > 0, "safe stop reports a reason");
}

console.log("Stripe Sandbox Starter annual property limit tests passed");
