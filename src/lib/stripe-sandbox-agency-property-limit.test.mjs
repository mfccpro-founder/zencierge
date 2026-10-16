import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { runStripeAgencyPropertyLimitCheck } = await import("./stripe-sandbox-agency-property-limit.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function active(count) {
  return { status: "active", accessSource: "stripe_sandbox", trialActive: false, planId: "agency", maxProperties: 20, propertyCount: count };
}

const calls = [];
let reads = 0;
const result = await runStripeAgencyPropertyLimitCheck({
  async readSubscription() { reads += 1; return active(reads === 1 ? 0 : 20); },
  async createProperty(sequence) { calls.push(sequence); return { status: sequence === 21 ? 403 : 201, ok: sequence <= 20 }; },
});
assert(calls.join(",") === Array.from({ length: 21 }, (_, index) => index + 1).join(","), "twenty TEST properties are followed by one rejected attempt");
assert(reads === 2 && result.startsWith("PASS:"), "the final remote count is read and reported");

for (const count of [1, 8, 20]) {
  const writes = [];
  let message = "";
  try {
    await runStripeAgencyPropertyLimitCheck({
      async readSubscription() { return active(count); },
      async createProperty(sequence) { writes.push(sequence); return { status: 201, ok: true }; },
    });
  } catch (error) { message = error instanceof Error ? error.message : ""; }
  assert(writes.length === 0, `count ${count} stops before every write`);
  assert(message.includes("prueba detenida sin modificar datos"), `count ${count} reports the safe stop`);
}

let invalidReadWrites = 0;
try {
  await runStripeAgencyPropertyLimitCheck({
    async readSubscription() { return active("not-a-count"); },
    async createProperty() { invalidReadWrites += 1; return { status: 201, ok: true }; },
  });
} catch {}
assert(invalidReadWrites === 0, "an invalid initial count stops before every write");

let readFailureWrites = 0;
try {
  await runStripeAgencyPropertyLimitCheck({
    async readSubscription() { throw new Error("remote count unavailable"); },
    async createProperty() { readFailureWrites += 1; return { status: 201, ok: true }; },
  });
} catch {}
assert(readFailureWrites === 0, "a failed initial read stops before every write");

console.log("Stripe Sandbox Agency property limit tests passed");
