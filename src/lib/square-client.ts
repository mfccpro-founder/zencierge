import { SquareClient, SquareEnvironment } from "square";

export function createSquareClient() {
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim() ?? "";
  const locationId = process.env.SQUARE_LOCATION_ID?.trim() ?? "";
  if (!token || token === "pega_aqui_el_access_token") {
    throw new Error("SQUARE_ACCESS_TOKEN is not configured in .env.local");
  }
  if (!locationId) {
    throw new Error("SQUARE_LOCATION_ID is not configured in .env.local");
  }
  const sandbox = process.env.SQUARE_ENVIRONMENT?.toLowerCase() === "sandbox";
  const client = new SquareClient({
    token,
    environment: sandbox ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
  });
  return { client, locationId, applicationId: process.env.SQUARE_APPLICATION_ID?.trim() ?? "" };
}
