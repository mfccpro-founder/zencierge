import { notFound, redirect } from "next/navigation";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { StripeProPropertyLimitTest } from "./stripe-pro-property-limit-test";

const STRIPE_SANDBOX_PROJECT_URL = "https://ygipnetialejzuazfjcn.supabase.co";

export default async function StripeProPropertyLimitTestPage() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STRIPE_SANDBOX_PROJECT_URL
  ) {
    notFound();
  }
  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    redirect("/login?next=/dev/stripe-sandbox/pro/property-limit-test");
  }
  return <StripeProPropertyLimitTest />;
}
