import { listHostAlerts } from "@/lib/housekeeping-reports-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ alerts: listHostAlerts() });
}
