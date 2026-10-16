"use client";

import { useState } from "react";
import {
  runStripePortfolioPropertyLimitCheck,
  type StripePortfolioSubscriptionSnapshot,
} from "@/lib/stripe-sandbox-portfolio-property-limit";

function testProperty(id: string, sequence: number) {
  return {
    id,
    name: `TEST — Stripe Portfolio property ${sequence}`,
    city: "Miami Beach",
    address: "Stripe sandbox Portfolio limit test",
    status: "Vacant",
    revenue: "$0",
    doorCode: "TEST",
    smartlock: "None",
    wifiNetwork: "Test",
    wifiPassword: "Test",
    parking: "None",
    gateCode: "None",
    checkIn: "3:00 PM",
    checkOut: "11:00 AM",
    currentGuest: null,
    trash: "Test property",
    handbook: "Stripe sandbox Portfolio limit test only.",
    assignedAvatarName: "Test",
    assignedPhoneNumber: "",
    avatarSystemPrompt: "Test only.",
    timezone: "America/New_York",
  };
}

export function StripePortfolioPropertyLimitTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function subscription() {
    const response = await fetch("/api/billing/subscription", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo leer la suscripción autenticada.");
    return (await response.json()) as StripePortfolioSubscriptionSnapshot;
  }

  async function create(sequence: number) {
    const id = `stripe-portfolio-test-${sequence}-${crypto.randomUUID()}`;
    const response = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testProperty(id, sequence)),
    });
    return { status: response.status, ok: response.ok };
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await runStripePortfolioPropertyLimitCheck({ readSubscription: subscription, createProperty: create }));
    } catch (cause) {
      setResult(`FAIL: ${cause instanceof Error ? cause.message : "error desconocido"}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">Prueba de límite Portfolio</h1>
        <p className="text-sm text-slate-700">
          Requiere la cuenta Portfolio dedicada con conteo inicial cero. Una lectura fallida o cualquier propiedad existente detiene la prueba antes del primer POST.
        </p>
        <button type="button" disabled={running} onClick={run} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-60">
          {running ? "Comprobando…" : "Ejecutar comprobación Portfolio controlada"}
        </button>
        {result ? <p role="status" className="text-sm text-slate-800">{result}</p> : null}
      </section>
    </main>
  );
}
