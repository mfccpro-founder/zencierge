import { notFound, redirect } from "next/navigation";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { StripeStarterAnnualPropertyLimitTest } from "./stripe-starter-annual-property-limit-test";

export const dynamic = "force-dynamic";

const STRIPE_SANDBOX_PROJECT_URL = "https://ygipnetialejzuazfjcn.supabase.co";

export default async function StripeStarterAnnualPropertyLimitTestPage() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STRIPE_SANDBOX_PROJECT_URL
  ) {
    notFound();
  }
  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    redirect("/login?next=/dev/stripe-sandbox/starter/annual/property-limit-test");
  }
  return <StripeStarterAnnualPropertyLimitTest />;
}
