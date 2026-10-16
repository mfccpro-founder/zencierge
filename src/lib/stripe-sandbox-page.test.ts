import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const page = readFileSync(join(process.cwd(), "src/app/dev/stripe-sandbox/page.tsx"), "utf8");
const button = readFileSync(
  join(process.cwd(), "src/app/dev/stripe-sandbox/stripe-sandbox-checkout-button.tsx"),
  "utf8",
);

assert(page.includes('process.env.NODE_ENV !== "development"') && page.includes("notFound()"), "page is development-only");
assert(page.includes("requireHostAuthContext") && page.includes('auth.source !== "supabase-auth"'), "page requires verified Supabase Auth");
assert(page.includes('redirect("/login?next=/dev/stripe-sandbox")'), "unauthenticated users return through the page URL");
assert(page.includes("Prueba sandbox: sin cobro real. Esta prueba registra el pago; todavía no activa permisos"), "sandbox and access warning is visible");
assert(button.includes('fetch("/api/dev/stripe-sandbox/checkout"') && button.includes('planId: "starter"') && button.includes('billingCycle: "monthly"'), "button sends only the allowed Starter monthly selection");
assert(button.includes('fetch("/api/dev/stripe-sandbox/access-diagnostic"') && button.includes('preflight.reason !== "not-eligible"'), "button requires a clean eligibility preflight before checkout");
assert(button.includes("disabled={processing}") && !button.includes("setTimeout") && !button.includes("retry"), "button disables during one attempt without automatic retry");
assert(button.includes("role=\"alert\"") && button.includes("window.location.assign(payload.checkoutUrl)"), "errors are visible and success redirects to Checkout");
assert(!page.toLowerCase().includes("host_subscriptions") && !button.toLowerCase().includes("host_subscriptions"), "browser UI never mutates Square billing data");

console.log("Stripe Sandbox development page tests passed");
