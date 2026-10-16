import { notFound, redirect } from "next/navigation";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { StripeSandboxAgencyCheckoutButton } from "./stripe-sandbox-agency-checkout-button";

export const dynamic = "force-dynamic";

const STRIPE_SANDBOX_PROJECT_URL = "https://ygipnetialejzuazfjcn.supabase.co";

export default async function StripeSandboxAgencyPage() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STRIPE_SANDBOX_PROJECT_URL
  ) {
    notFound();
  }

  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    redirect("/login?next=/dev/stripe-sandbox/agency");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Stripe Sandbox · usuario Agency separado
          </p>
          <h1 className="text-2xl font-bold text-slate-950">Checkout Agency de desarrollo</h1>
          <p className="text-sm leading-6 text-slate-700">
            Solo para la cuenta de prueba Agency dedicada, sin propiedades ni facturación previa.
          </p>
        </div>
        <StripeSandboxAgencyCheckoutButton />
      </section>
    </main>
  );
}
