import { notFound, redirect } from "next/navigation";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { StripeSandboxCheckoutButton } from "./stripe-sandbox-checkout-button";

export const dynamic = "force-dynamic";

export default async function StripeSandboxPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    redirect("/login?next=/dev/stripe-sandbox");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Stripe Sandbox
          </p>
          <h1 className="text-2xl font-bold text-slate-950">Checkout de desarrollo</h1>
          <p className="text-sm leading-6 text-slate-700">
            Prueba sandbox: sin cobro real. Esta prueba registra el pago; todavía no activa permisos
            del producto.
          </p>
        </div>
        <StripeSandboxCheckoutButton />
      </section>
    </main>
  );
}
