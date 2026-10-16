import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function StripeSandboxCheckoutCancelPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-lg text-slate-800">
        Checkout de prueba cancelado. Puedes volver a intentarlo.
      </p>
    </main>
  );
}
