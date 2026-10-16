export type StripeProSubscriptionSnapshot = {
  status?: unknown;
  accessSource?: unknown;
  trialActive?: unknown;
  maxProperties?: unknown;
  propertyCount?: unknown;
  planId?: unknown;
};

export type StripeProCreateResult = { status: number; ok: boolean };

export async function runStripeProPropertyLimitCheck(input: {
  readSubscription(): Promise<StripeProSubscriptionSnapshot>;
  createProperty(sequence: number): Promise<StripeProCreateResult>;
}) {
  const before = await input.readSubscription();
  if (
    before.status !== "active" ||
    before.accessSource !== "stripe_sandbox" ||
    before.trialActive !== false ||
    before.planId !== "pro" ||
    before.maxProperties !== 4
  ) {
    throw new Error("La respuesta de acceso Stripe Pro no tiene los campos esperados.");
  }

  const count = Number(before.propertyCount);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("propertyCount no es válido.");
  }
  if (count !== 0) {
    throw new Error(
      `Se encontraron ${count} propiedades existentes; prueba detenida sin modificar datos.`,
    );
  }

  for (let sequence = 1; sequence <= 4; sequence += 1) {
    const created = await input.createProperty(sequence);
    if (!created.ok) {
      throw new Error(`Falló la propiedad TEST ${sequence} (HTTP ${created.status}).`);
    }
  }

  const fifth = await input.createProperty(5);
  if (fifth.status !== 403) {
    throw new Error(`La quinta propiedad no fue rechazada: HTTP ${fifth.status}.`);
  }

  const after = await input.readSubscription();
  if (after.propertyCount !== 4) {
    throw new Error(`Conteo final inesperado: ${String(after.propertyCount)}.`);
  }

  return "PASS: conteo inicial 0; cuatro propiedades TEST guardadas; quinta rechazada HTTP 403; conteo final 4.";
}
