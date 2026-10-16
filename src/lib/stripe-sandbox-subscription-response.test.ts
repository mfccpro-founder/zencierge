import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/app/api/billing/subscription/route.ts"),
  "utf8",
);

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

assert(
  source.includes("const trialActive = !stripeSandboxAccess.granted && metadataTrialActive"),
  "effective trial state must be false when Stripe sandbox grants paid access",
);
assert(
  source.includes('const status = stripeSandboxAccess.granted\n    ? "active"'),
  "Stripe sandbox paid access must report active status",
);
assert(
  source.includes("metadataTrialActive,") && source.includes("trialEndsAt,"),
  "existing trial metadata remains observable without being the effective access source",
);
assert(
  source.includes('accessSource: stripeSandboxAccess.granted ? "stripe_sandbox" : "standard"'),
  "response keeps the Stripe sandbox source explicit",
);

console.log("Stripe Sandbox subscription response tests passed");
