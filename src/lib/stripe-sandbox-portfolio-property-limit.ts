export type StripePortfolioSubscriptionSnapshot = {
  status?: unknown;
  accessSource?: unknown;
  trialActive?: unknown;
  maxProperties?: unknown;
  propertyCount?: unknown;
  planId?: unknown;
};

export type StripePortfolioCreateResult = { status: number; ok: boolean };

export async function runStripePortfolioPropertyLimitCheck(input: {
  readSubscription(): Promise<StripePortfolioSubscriptionSnapshot>;
  createProperty(sequence: number): Promise<StripePortfolioCreateResult>;
}) {
  const before = await input.readSubscription();
  if (
    before.status !== "active" ||
    before.accessSource !== "stripe_sandbox" ||
    before.trialActive !== false ||
    before.planId !== "portfolio" ||
    before.maxProperties !== 8
  ) {
    throw new Error("La respuesta de acceso Stripe Portfolio no tiene los campos esperados.");
  }

  const count = Number(before.propertyCount);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("propertyCount no es válido; prueba detenida sin modificar datos.");
  }
  if (count !== 0) {
    throw new Error(`Se encontraron ${count} propiedades existentes; prueba detenida sin modificar datos.`);
  }

  for (let sequence = 1; sequence <= 8; sequence += 1) {
    const created = await input.createProperty(sequence);
    if (!created.ok) {
      throw new Error(`Falló la propiedad TEST ${sequence} (HTTP ${created.status}).`);
    }
  }

  const ninth = await input.createProperty(9);
  if (ninth.status !== 403) {
    throw new Error(`La novena propiedad no fue rechazada: HTTP ${ninth.status}.`);
  }

  const after = await input.readSubscription();
  if (after.propertyCount !== 8) {
    throw new Error(`Conteo final inesperado: ${String(after.propertyCount)}.`);
  }

  return "PASS: conteo inicial 0; ocho propiedades TEST guardadas; novena rechazada HTTP 403; conteo final 8.";
}
