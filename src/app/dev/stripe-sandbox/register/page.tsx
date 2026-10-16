import { notFound } from "next/navigation";
import { StripeSandboxRegistrationForm } from "./stripe-sandbox-registration-form";

export default function StripeSandboxRegistrationPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">Cuenta de prueba Stripe sandbox</h1>
        <p className="text-sm leading-6 text-slate-700">
          Este registro crea únicamente una cuenta de Supabase Auth. No inicia Square ni Stripe.
        </p>
        <StripeSandboxRegistrationForm />
      </section>
    </main>
  );
}
