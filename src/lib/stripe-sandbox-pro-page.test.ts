import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const page = read("src/app/dev/stripe-sandbox/pro/page.tsx");
const button = read("src/app/dev/stripe-sandbox/pro/stripe-sandbox-pro-checkout-button.tsx");
const limitPage = read("src/app/dev/stripe-sandbox/pro/property-limit-test/page.tsx");
const limit = read("src/app/dev/stripe-sandbox/pro/property-limit-test/stripe-pro-property-limit-test.tsx");
const checkoutRoute = read("src/app/api/dev/stripe-sandbox/checkout/route.ts");
const starterButton = read("src/app/dev/stripe-sandbox/stripe-sandbox-checkout-button.tsx");

for (const source of [page, limitPage, checkoutRoute]) {
  assert(source.includes("ygipnetialejzuazfjcn"), "Pro flow is pinned to the intended sandbox project");
}
assert(page.includes('redirect("/login?next=/dev/stripe-sandbox/pro")'), "Pro checkout requires host authentication");
assert(limitPage.includes('/login?next=/dev/stripe-sandbox/pro/property-limit-test'), "Pro limit test requires host authentication");
assert(button.includes('planId: "pro"') && button.includes('billingCycle: "monthly"'), "checkout selects Pro monthly explicitly");
assert(button.includes("Pro — USD 99/mes"), "checkout displays the exact Pro monthly label");
assert(button.includes('preflight.reason !== "not-eligible"'), "checkout requires a clean separate user");
assert(limit.includes("runStripeProPropertyLimitCheck"), "limit UI uses the behavior-tested controller");
assert(starterButton.includes('planId: "starter"') && starterButton.includes('billingCycle: "monthly"'), "Starter selection remains intact");

console.log("Stripe Sandbox Pro page tests passed");
