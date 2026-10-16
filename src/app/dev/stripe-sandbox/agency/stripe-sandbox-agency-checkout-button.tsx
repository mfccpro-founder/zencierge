"use client";

import { useState } from "react";

type CheckoutResponse = { checkoutUrl?: unknown; error?: unknown };
type PreflightResponse = {
  authenticated?: boolean;
  configured?: boolean;
  squareSubscriptionPresent?: boolean;
  reason?: unknown;
};

export function StripeSandboxAgencyCheckoutButton() {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    if (processing) return;
    setProcessing(true);
    setError(null);

    try {
      const preflightResponse = await fetch("/api/dev/stripe-sandbox/access-diagnostic", {
        cache: "no-store",
      });
      const preflight = (await preflightResponse.json().catch(() => null)) as PreflightResponse | null;
      if (
        !preflightResponse.ok ||
        preflight?.authenticated !== true ||
        preflight.configured !== true ||
        preflight.squareSubscriptionPresent !== false ||
        preflight.reason !== "not-eligible"
      ) {
        const reason = typeof preflight?.reason === "string" ? preflight.reason : "unavailable";
        throw new Error(`Preflight bloqueado: ${reason}. No se creó ningún Checkout.`);
      }

      const response = await fetch("/api/dev/stripe-sandbox/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "agency", billingCycle: "monthly" }),
      });
      const payload = (await response.json().catch(() => null)) as CheckoutResponse | null;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : "No se pudo iniciar Checkout.",
        );
      }
      if (typeof payload?.checkoutUrl !== "string" || !payload.checkoutUrl) {
        throw new Error("Checkout no devolvió una URL válida.");
      }
      window.location.assign(payload.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar Checkout.");
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={startCheckout}
        disabled={processing}
        className="w-full rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {processing ? "Preparando Checkout…" : "Agency — USD 199/mes"}
      </button>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      <p className="text-xs text-slate-600">
        El servidor valida el precio Agency mensual en Stripe test antes de crear Checkout.
      </p>
    </div>
  );
}
