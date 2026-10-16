import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function StripeSandboxCheckoutSuccessPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-950">
      <section className="mx-auto max-w-xl space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h1 className="text-2xl font-bold">Regreso de Checkout sandbox</h1>
        <p className="text-base leading-7 text-slate-700">
          Stripe devolvió el navegador a la aplicación. Este retorno por sí solo no confirma el
          pago; la verificación depende del webhook y de su registro en el servidor.
        </p>
        <p className="text-sm font-medium text-slate-600">
          Prueba sandbox: sin cobro real y sin activar permisos del producto.
        </p>
      </section>
    </main>
  );
}
