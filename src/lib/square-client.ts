import { SquareClient, SquareEnvironment } from "square";

export type ResolvedSquareEnvironment = {
  name: "sandbox" | "production";
  sdkEnvironment: SquareEnvironment;
  sandbox: boolean;
};

export function resolveSquareEnvironment(
  value: string | undefined = process.env.SQUARE_ENVIRONMENT,
): ResolvedSquareEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "sandbox") {
    return {
      name: "sandbox",
      sdkEnvironment: SquareEnvironment.Sandbox,
      sandbox: true,
    };
  }
  if (normalized === "production") {
    return {
      name: "production",
      sdkEnvironment: SquareEnvironment.Production,
      sandbox: false,
    };
  }
  throw new Error(
    "SQUARE_ENVIRONMENT must be explicitly configured as sandbox or production",
  );
}

export function isSquareSandbox(
  value: string | undefined = process.env.SQUARE_ENVIRONMENT,
) {
  return resolveSquareEnvironment(value).sandbox;
}

export function createSquareClient() {
  const { sdkEnvironment } = resolveSquareEnvironment();
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim() ?? "";
  const locationId = process.env.SQUARE_LOCATION_ID?.trim() ?? "";
  if (!token || token === "pega_aqui_el_access_token") {
    throw new Error("SQUARE_ACCESS_TOKEN is not configured in .env.local");
  }
  if (!locationId) {
    throw new Error("SQUARE_LOCATION_ID is not configured in .env.local");
  }
  const client = new SquareClient({
    token,
    environment: sdkEnvironment,
  });
  return { client, locationId, applicationId: process.env.SQUARE_APPLICATION_ID?.trim() ?? "" };
}
