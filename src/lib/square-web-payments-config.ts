import { resolveSquareEnvironment } from "@/lib/square-client";

export type SquareWebPaymentsPublicConfigEnv = {
  SQUARE_ENVIRONMENT?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_APPLICATION_ID?: string;
};

export type SquareWebPaymentsPublicConfigSuccess = {
  ok: true;
  applicationId: string;
  locationId: string;
  environment: "sandbox" | "production";
  sandbox: boolean;
};

export type SquareWebPaymentsPublicConfigFailure = {
  ok: false;
  error:
    | "missing_environment"
    | "missing_location_id"
    | "missing_application_id";
};

export type SquareWebPaymentsPublicConfigResult =
  | SquareWebPaymentsPublicConfigSuccess
  | SquareWebPaymentsPublicConfigFailure;

/**
 * Safe public Web Payments config only. Never includes access tokens.
 */
export function resolveSquareWebPaymentsPublicConfig(
  env: SquareWebPaymentsPublicConfigEnv | NodeJS.ProcessEnv = process.env,
): SquareWebPaymentsPublicConfigResult {
  const applicationEnv = env as SquareWebPaymentsPublicConfigEnv;
  let environment: "sandbox" | "production";
  let sandbox: boolean;
  try {
    const resolved = resolveSquareEnvironment(applicationEnv.SQUARE_ENVIRONMENT);
    environment = resolved.name;
    sandbox = resolved.sandbox;
  } catch {
    return { ok: false, error: "missing_environment" };
  }

  const locationId = applicationEnv.SQUARE_LOCATION_ID?.trim() ?? "";
  if (!locationId || /placeholder|pega_aqui|your-square/i.test(locationId)) {
    return { ok: false, error: "missing_location_id" };
  }

  const applicationId = applicationEnv.SQUARE_APPLICATION_ID?.trim() ?? "";
  if (
    !applicationId ||
    /placeholder|pega_aqui|your-square|your-square-app-id/i.test(applicationId)
  ) {
    return { ok: false, error: "missing_application_id" };
  }

  return {
    ok: true,
    applicationId,
    locationId,
    environment,
    sandbox,
  };
}
