"use client";

import { useState } from "react";

type Subscription = {
  status?: unknown;
  accessSource?: unknown;
  trialActive?: unknown;
  maxProperties?: unknown;
  propertyCount?: unknown;
};

function testProperty(id: string, name: string) {
  return {
    id, name, city: "Miami Beach", address: "Stripe sandbox limit test",
    status: "Vacant", revenue: "$0", doorCode: "TEST", smartlock: "None",
    wifiNetwork: "Test", wifiPassword: "Test", parking: "None", gateCode: "None",
    checkIn: "3:00 PM", checkOut: "11:00 AM", currentGuest: null,
    trash: "Test property", handbook: "Stripe sandbox Starter limit test only.",
    assignedAvatarName: "Test", assignedPhoneNumber: "", avatarSystemPrompt: "Test only.",
    timezone: "America/New_York",
  };
}

export function StripeStarterPropertyLimitTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function subscription() {
    const response = await fetch("/api/billing/subscription", { cache: "no-store" });
    const body = (await response.json()) as Subscription;
    if (!response.ok) throw new Error("No se pudo leer la suscripción autenticada.");
    return body;
  }

  async function create(id: string, name: string) {
    const response = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testProperty(id, name)),
    });
    return { response, body: await response.json().catch(() => ({})) };
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      const before = await subscription();
      if (before.status !== "active" || before.accessSource !== "stripe_sandbox" || before.trialActive !== false || before.maxProperties !== 1) {
        throw new Error("La respuesta de acceso Stripe Starter no tiene los campos esperados.");
      }
      const count = Number(before.propertyCount);
      if (!Number.isInteger(count) || count < 0) throw new Error("propertyCount no es válido.");
      if (count > 1) throw new Error(`La cuenta ya tiene ${count} propiedades; no se ejecutó ningún POST.`);

      if (count === 0) {
        const firstId = `stripe-starter-test-${crypto.randomUUID()}`;
        const first = await create(firstId, "TEST — Stripe Starter property 1");
        if (!first.response.ok) throw new Error(`Falló la creación controlada inicial (${first.response.status}).`);
      }

      const secondId = `stripe-starter-limit-${crypto.randomUUID()}`;
      const second = await create(secondId, "TEST — Stripe Starter property 2 (must reject)");
      if (second.response.status !== 403) {
        throw new Error(`La segunda propiedad no fue rechazada: HTTP ${second.response.status}.`);
      }
      const after = await subscription();
      if (after.propertyCount !== 1) throw new Error(`Conteo final inesperado: ${String(after.propertyCount)}.`);
      setResult(`PASS: conteo inicial ${count}; segunda propiedad rechazada HTTP 403; conteo final 1.`);
    } catch (cause) {
      setResult(`FAIL: ${cause instanceof Error ? cause.message : "error desconocido"}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">Prueba de límite Starter</h1>
        <p className="text-sm text-slate-700">Lee primero el conteo real. Si es cero crea una propiedad TEST; nunca modifica ni borra propiedades existentes.</p>
        <button type="button" disabled={running} onClick={run} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-60">
          {running ? "Comprobando…" : "Ejecutar comprobación controlada"}
        </button>
        {result ? <p role="status" className="text-sm text-slate-800">{result}</p> : null}
      </section>
    </main>
  );
}
