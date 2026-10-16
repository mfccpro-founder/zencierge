import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const page = read("src/app/dev/stripe-sandbox/portfolio/page.tsx");
const button = read("src/app/dev/stripe-sandbox/portfolio/stripe-sandbox-portfolio-checkout-button.tsx");
const limitPage = read("src/app/dev/stripe-sandbox/portfolio/property-limit-test/page.tsx");
const limit = read("src/app/dev/stripe-sandbox/portfolio/property-limit-test/stripe-portfolio-property-limit-test.tsx");
const checkout = read("src/lib/stripe-sandbox-checkout.ts");
const starter = read("src/app/dev/stripe-sandbox/stripe-sandbox-checkout-button.tsx");
const pro = read("src/app/dev/stripe-sandbox/pro/stripe-sandbox-pro-checkout-button.tsx");

for (const source of [page, limitPage]) assert(source.includes("ygipnetialejzuazfjcn"), "Portfolio flow is pinned to sandbox");
assert(page.includes('redirect("/login?next=/dev/stripe-sandbox/portfolio")'), "Portfolio checkout requires auth");
assert(limitPage.includes('/login?next=/dev/stripe-sandbox/portfolio/property-limit-test'), "Portfolio limit requires auth");
assert(button.includes('planId: "portfolio"') && button.includes('billingCycle: "monthly"'), "Portfolio monthly is explicit");
assert(button.includes("Portfolio — USD 149/mes"), "Portfolio label is exact");
assert(button.includes('preflight.reason !== "not-eligible"'), "Portfolio requires a clean user preflight");
assert(checkout.includes('portfolio: {\n    monthly: { unitAmount: 14900, interval: "month" }'), "server validates Portfolio monthly price");
assert(limit.includes("runStripePortfolioPropertyLimitCheck"), "Portfolio UI uses tested controller");
assert(starter.includes('planId: "starter"') && pro.includes('planId: "pro"'), "Starter and Pro selections remain intact");

console.log("Stripe Sandbox Portfolio page tests passed");
