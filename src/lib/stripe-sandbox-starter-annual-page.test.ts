import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const page = read("src/app/dev/stripe-sandbox/starter/annual/page.tsx");
const button = read(
  "src/app/dev/stripe-sandbox/starter/annual/stripe-sandbox-starter-annual-checkout-button.tsx",
);
const limitPage = read(
  "src/app/dev/stripe-sandbox/starter/annual/property-limit-test/page.tsx",
);
const subscription = read("src/app/api/billing/subscription/route.ts");

assert(page.includes("ygipnetialejzuazfjcn") && page.includes("notFound()"), "annual page is sandbox-only");
assert(page.includes('redirect("/login?next=/dev/stripe-sandbox/starter/annual")'), "annual page requires auth");
assert(button.includes('planId: "starter"') && button.includes('billingCycle: "annual"'), "button selects Starter annual explicitly");
assert(button.includes("Starter — USD 490/año"), "button displays the exact annual price");
assert(button.includes("access-diagnostic") && button.includes('preflight.reason !== "not-eligible"'), "annual checkout retains the authenticated preflight");
assert(limitPage.includes("ygipnetialejzuazfjcn") && limitPage.includes("requireHostAuthContext"), "annual limit route is sandbox-only and authenticated");
assert(subscription.includes("stripeSandboxAccess.billingCycle"), "subscription response exposes the server-verified billing cycle");

console.log("Stripe Sandbox Starter annual page tests passed");
