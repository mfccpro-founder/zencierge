export type StripeStarterAnnualSubscriptionSnapshot = {
  status?: unknown;
  accessSource?: unknown;
  trialActive?: unknown;
  planId?: unknown;
  billingCycle?: unknown;
  maxProperties?: unknown;
  propertyCount?: unknown;
};

export type StripeStarterAnnualCreateResult = { status: number; ok: boolean };

export async function runStripeStarterAnnualPropertyLimitCheck(input: {
  readSubscription(): Promise<StripeStarterAnnualSubscriptionSnapshot>;
  createProperty(sequence: number): Promise<StripeStarterAnnualCreateResult>;
}) {
  const before = await input.readSubscription();
  if (
    before.status !== "active" ||
    before.accessSource !== "stripe_sandbox" ||
    before.trialActive !== false ||
    before.planId !== "starter" ||
    before.billingCycle !== "annual" ||
    before.maxProperties !== 1
  ) {
    throw new Error("La respuesta del servidor no confirma acceso Stripe Starter anual.");
  }

  const count = Number(before.propertyCount);
  if (!Number.isInteger(count) || count < 0) throw new Error("propertyCount no es válido.");
  if (count !== 0) {
    throw new Error(
      `Se encontraron ${count} propiedades existentes; prueba detenida sin modificar datos.`,
    );
  }

  const first = await input.createProperty(1);
  if (!first.ok) throw new Error(`Falló la propiedad TEST 1 (HTTP ${first.status}).`);

  const second = await input.createProperty(2);
  if (second.status !== 403) {
    throw new Error(`La segunda propiedad no fue rechazada: HTTP ${second.status}.`);
  }

  const after = await input.readSubscription();
  if (
    after.accessSource !== "stripe_sandbox" ||
    after.planId !== "starter" ||
    after.billingCycle !== "annual" ||
    after.propertyCount !== 1
  ) {
    throw new Error("El estado final del servidor no confirma Starter anual con conteo 1.");
  }

  return "PASS: Starter anual confirmado; conteo inicial 0; primera TEST guardada; segunda rechazada HTTP 403; conteo final 1.";
}
