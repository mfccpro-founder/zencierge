import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { runStripeProPropertyLimitCheck } = await import("./stripe-sandbox-pro-property-limit.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function active(count) {
  return {
    status: "active",
    accessSource: "stripe_sandbox",
    trialActive: false,
    planId: "pro",
    maxProperties: 4,
    propertyCount: count,
  };
}

const calls = [];
let reads = 0;
const result = await runStripeProPropertyLimitCheck({
  async readSubscription() {
    reads += 1;
    return active(reads === 1 ? 0 : 4);
  },
  async createProperty(sequence) {
    calls.push(sequence);
    return { status: sequence === 5 ? 403 : 201, ok: sequence <= 4 };
  },
});
assert(calls.join(",") === "1,2,3,4,5", "four TEST properties are followed by one rejected attempt");
assert(reads === 2 && result.startsWith("PASS:"), "the final remote count is read and reported");

for (const count of [1, 2, 4]) {
  const blockedCalls = [];
  let blockedReads = 0;
  let message = "";
  try {
    await runStripeProPropertyLimitCheck({
      async readSubscription() { blockedReads += 1; return active(count); },
      async createProperty(sequence) { blockedCalls.push(sequence); return { status: 201, ok: true }; },
    });
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  assert(blockedReads === 1 && blockedCalls.length === 0, `count ${count} stops before every write`);
  assert(message.includes("prueba detenida sin modificar datos"), `count ${count} reports the safe stop`);
}

console.log("Stripe Sandbox Pro property limit tests passed");
