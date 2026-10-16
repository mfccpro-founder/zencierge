import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const page = read("src/app/dev/stripe-sandbox/agency/page.tsx");
const button = read("src/app/dev/stripe-sandbox/agency/stripe-sandbox-agency-checkout-button.tsx");
const limitPage = read("src/app/dev/stripe-sandbox/agency/property-limit-test/page.tsx");
const limit = read("src/app/dev/stripe-sandbox/agency/property-limit-test/stripe-agency-property-limit-test.tsx");
const checkout = read("src/lib/stripe-sandbox-checkout.ts");
const starter = read("src/app/dev/stripe-sandbox/stripe-sandbox-checkout-button.tsx");
const pro = read("src/app/dev/stripe-sandbox/pro/stripe-sandbox-pro-checkout-button.tsx");
const portfolio = read("src/app/dev/stripe-sandbox/portfolio/stripe-sandbox-portfolio-checkout-button.tsx");

for (const source of [page, limitPage]) assert(source.includes("ygipnetialejzuazfjcn"), "Agency flow is pinned to sandbox");
assert(page.includes('redirect("/login?next=/dev/stripe-sandbox/agency")'), "Agency checkout requires auth");
assert(limitPage.includes('/login?next=/dev/stripe-sandbox/agency/property-limit-test'), "Agency limit requires auth");
assert(button.includes('planId: "agency"') && button.includes('billingCycle: "monthly"'), "Agency monthly is explicit");
assert(button.includes("Agency — USD 199/mes"), "Agency label is exact");
assert(button.includes('preflight.reason !== "not-eligible"'), "Agency requires a clean user preflight");
assert(checkout.includes('agency: {\n    monthly: { unitAmount: 19900, interval: "month" }'), "server validates Agency monthly price");
assert(limit.includes("runStripeAgencyPropertyLimitCheck"), "Agency UI uses tested controller");
assert(starter.includes('planId: "starter"') && pro.includes('planId: "pro"') && portfolio.includes('planId: "portfolio"'), "Starter, Pro, and Portfolio selections remain intact");

console.log("Stripe Sandbox Agency page tests passed");
