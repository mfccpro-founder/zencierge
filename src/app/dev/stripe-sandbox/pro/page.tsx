import { notFound, redirect } from "next/navigation";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { StripeSandboxProCheckoutButton } from "./stripe-sandbox-pro-checkout-button";

export const dynamic = "force-dynamic";

const STRIPE_SANDBOX_PROJECT_URL = "https://ygipnetialejzuazfjcn.supabase.co";

export default async function StripeSandboxProPage() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STRIPE_SANDBOX_PROJECT_URL
  ) {
    notFound();
  }

  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    redirect("/login?next=/dev/stripe-sandbox/pro");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Stripe Sandbox · usuario Pro separado
          </p>
          <h1 className="text-2xl font-bold text-slate-950">Checkout Pro de desarrollo</h1>
          <p className="text-sm leading-6 text-slate-700">
            Solo para una cuenta de prueba nueva, sin propiedades y distinta de la cuenta Starter.
          </p>
        </div>
        <StripeSandboxProCheckoutButton />
      </section>
    </main>
  );
}
