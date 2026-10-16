import { notFound, redirect } from "next/navigation";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { StripeStarterPropertyLimitTest } from "./stripe-starter-property-limit-test";

export default async function StripeStarterPropertyLimitTestPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    redirect("/login?next=/dev/stripe-sandbox/property-limit-test");
  }
  return <StripeStarterPropertyLimitTest />;
}
