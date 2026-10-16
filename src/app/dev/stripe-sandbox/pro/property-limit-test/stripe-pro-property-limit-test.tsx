"use client";

import { useState } from "react";
import {
  runStripeProPropertyLimitCheck,
  type StripeProSubscriptionSnapshot,
} from "@/lib/stripe-sandbox-pro-property-limit";

function testProperty(id: string, sequence: number) {
  return {
    id,
    name: `TEST — Stripe Pro property ${sequence}`,
    city: "Miami Beach",
    address: "Stripe sandbox Pro limit test",
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
    handbook: "Stripe sandbox Pro limit test only.",
    assignedAvatarName: "Test",
    assignedPhoneNumber: "",
    avatarSystemPrompt: "Test only.",
    timezone: "America/New_York",
  };
}

export function StripeProPropertyLimitTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function subscription() {
    const response = await fetch("/api/billing/subscription", { cache: "no-store" });
    const body = (await response.json()) as StripeProSubscriptionSnapshot;
    if (!response.ok) throw new Error("No se pudo leer la suscripción autenticada.");
    return body;
  }

  async function create(sequence: number) {
    const id = `stripe-pro-test-${sequence}-${crypto.randomUUID()}`;
    const response = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testProperty(id, sequence)),
    });
    return { response, body: await response.json().catch(() => ({})) };
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      const passed = await runStripeProPropertyLimitCheck({
        readSubscription: subscription,
        async createProperty(sequence) {
          const created = await create(sequence);
          return { status: created.response.status, ok: created.response.ok };
        },
      });
      setResult(passed);
    } catch (cause) {
      setResult(`FAIL: ${cause instanceof Error ? cause.message : "error desconocido"}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">Prueba de límite Pro</h1>
        <p className="text-sm text-slate-700">
          Requiere una cuenta Pro separada con conteo inicial cero. Si encuentra cualquier propiedad,
          se detiene antes del primer POST y nunca modifica ni borra datos existentes.
        </p>
        <button type="button" disabled={running} onClick={run} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-60">
          {running ? "Comprobando…" : "Ejecutar comprobación Pro controlada"}
        </button>
        {result ? <p role="status" className="text-sm text-slate-800">{result}</p> : null}
      </section>
    </main>
  );
}
