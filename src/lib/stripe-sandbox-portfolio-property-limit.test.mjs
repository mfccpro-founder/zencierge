import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { runStripePortfolioPropertyLimitCheck } = await import("./stripe-sandbox-portfolio-property-limit.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function active(count) {
  return { status: "active", accessSource: "stripe_sandbox", trialActive: false, planId: "portfolio", maxProperties: 8, propertyCount: count };
}

const calls = [];
let reads = 0;
const result = await runStripePortfolioPropertyLimitCheck({
  async readSubscription() { reads += 1; return active(reads === 1 ? 0 : 8); },
  async createProperty(sequence) { calls.push(sequence); return { status: sequence === 9 ? 403 : 201, ok: sequence <= 8 }; },
});
assert(calls.join(",") === "1,2,3,4,5,6,7,8,9", "eight TEST properties are followed by one rejected attempt");
assert(reads === 2 && result.startsWith("PASS:"), "the final remote count is read and reported");

for (const count of [1, 4, 8]) {
  const writes = [];
  let message = "";
  try {
    await runStripePortfolioPropertyLimitCheck({
      async readSubscription() { return active(count); },
      async createProperty(sequence) { writes.push(sequence); return { status: 201, ok: true }; },
    });
  } catch (error) { message = error instanceof Error ? error.message : ""; }
  assert(writes.length === 0, `count ${count} stops before every write`);
  assert(message.includes("prueba detenida sin modificar datos"), `count ${count} reports the safe stop`);
}

let readFailureWrites = 0;
try {
  await runStripePortfolioPropertyLimitCheck({
    async readSubscription() { throw new Error("remote count unavailable"); },
    async createProperty() { readFailureWrites += 1; return { status: 201, ok: true }; },
  });
} catch {}
assert(readFailureWrites === 0, "a failed initial read stops before every write");

console.log("Stripe Sandbox Portfolio property limit tests passed");
