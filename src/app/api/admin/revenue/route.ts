import { requireHostUser } from "@/lib/supabase-route";
import { isSuperAdmin } from "@/lib/admin-auth";
import { getAdminRevenueSnapshot } from "@/lib/admin-revenue-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHostUser();
  if (auth.error) return auth.error;
  if (!isSuperAdmin(auth.user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json(getAdminRevenueSnapshot());
}
