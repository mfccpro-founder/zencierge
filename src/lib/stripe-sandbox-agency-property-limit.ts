export type StripeAgencySubscriptionSnapshot = {
  status?: unknown;
  accessSource?: unknown;
  trialActive?: unknown;
  maxProperties?: unknown;
  propertyCount?: unknown;
  planId?: unknown;
};

export type StripeAgencyCreateResult = { status: number; ok: boolean };

export async function runStripeAgencyPropertyLimitCheck(input: {
  readSubscription(): Promise<StripeAgencySubscriptionSnapshot>;
  createProperty(sequence: number): Promise<StripeAgencyCreateResult>;
}) {
  const before = await input.readSubscription();
  if (
    before.status !== "active" ||
    before.accessSource !== "stripe_sandbox" ||
    before.trialActive !== false ||
    before.planId !== "agency" ||
    before.maxProperties !== 20
  ) {
    throw new Error("La respuesta de acceso Stripe Agency no tiene los campos esperados.");
  }

  const count = Number(before.propertyCount);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("propertyCount no es válido; prueba detenida sin modificar datos.");
  }
  if (count !== 0) {
    throw new Error(`Se encontraron ${count} propiedades existentes; prueba detenida sin modificar datos.`);
  }

  for (let sequence = 1; sequence <= 20; sequence += 1) {
    const created = await input.createProperty(sequence);
    if (!created.ok) {
      throw new Error(`Falló la propiedad TEST ${sequence} (HTTP ${created.status}).`);
    }
  }

  const twentyFirst = await input.createProperty(21);
  if (twentyFirst.status !== 403) {
    throw new Error(`La propiedad 21 no fue rechazada: HTTP ${twentyFirst.status}.`);
  }

  const after = await input.readSubscription();
  if (after.propertyCount !== 20) {
    throw new Error(`Conteo final inesperado: ${String(after.propertyCount)}.`);
  }

  return "PASS: conteo inicial 0; veinte propiedades TEST guardadas; propiedad 21 rechazada HTTP 403; conteo final 20.";
}
