import { notFound, redirect } from "next/navigation";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { StripeSandboxStarterAnnualCheckoutButton } from "./stripe-sandbox-starter-annual-checkout-button";

export const dynamic = "force-dynamic";

const STRIPE_SANDBOX_PROJECT_URL = "https://ygipnetialejzuazfjcn.supabase.co";

export default async function StripeSandboxStarterAnnualPage() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STRIPE_SANDBOX_PROJECT_URL
  ) {
    notFound();
  }

  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    redirect("/login?next=/dev/stripe-sandbox/starter/annual");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Stripe Sandbox · Starter anual
          </p>
          <h1 className="text-2xl font-bold text-slate-950">Checkout Starter anual</h1>
          <p className="text-sm leading-6 text-slate-700">
            Solo para la cuenta de prueba anual dedicada, sin propiedades ni suscripciones previas.
          </p>
        </div>
        <StripeSandboxStarterAnnualCheckoutButton />
      </section>
    </main>
  );
}
