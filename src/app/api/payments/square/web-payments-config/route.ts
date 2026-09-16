import { resolveSquareWebPaymentsPublicConfig } from "@/lib/square-web-payments-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = resolveSquareWebPaymentsPublicConfig();
  if (!config.ok) {
    return Response.json(
      { ok: false, error: config.error },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    applicationId: config.applicationId,
    locationId: config.locationId,
    environment: config.environment,
    sandbox: config.sandbox,
  });
}
