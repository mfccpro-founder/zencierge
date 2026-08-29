import { requireHostUser } from "@/lib/supabase-route";
import { isSuperAdmin } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isFeatureStatus, mapFeatureRequestRow } from "@/lib/host-feature-requests";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHostUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(auth.user)) return Response.json({ error: "Superadmin only." }, { status: 403 });

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return Response.json({
      requests: [],
      error: error instanceof Error ? error.message : "Service role key is not configured.",
    });
  }

  const { data, error } = await admin
    .from("host_feature_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return Response.json({
      requests: [],
      error: error.message.includes("host_feature_requests")
        ? "The host_feature_requests table is missing. Run the latest supabase/schema.sql in the SQL editor."
        : error.message,
    });
  }

  return Response.json({
    requests: (data ?? []).map((row) => mapFeatureRequestRow(row as Record<string, unknown>)),
    error: null,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireHostUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(auth.user)) return Response.json({ error: "Superadmin only." }, { status: 403 });

  let body: { id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const id = (body.id ?? "").trim();
  const status = (body.status ?? "").trim();
  if (!id || !isFeatureStatus(status)) {
    return Response.json({ error: "A valid request id and status are required." }, { status: 400 });
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Service role key is not configured." },
      { status: 500 },
    );
  }

  const { error } = await admin
    .from("host_feature_requests")
    .update({ status })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
