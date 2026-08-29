import { requireHostUser } from "@/lib/supabase-route";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isFeatureCategory } from "@/lib/host-feature-requests";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireHostUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { title?: string; category?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const description = (body.description ?? "").trim();
  const category = (body.category ?? "").trim();

  if (title.length < 3) {
    return Response.json({ error: "Please add a short feature title." }, { status: 400 });
  }
  if (description.length < 8) {
    return Response.json({ error: "Please describe how this feature would help your hosting operations." }, { status: 400 });
  }
  if (!isFeatureCategory(category)) {
    return Response.json({ error: "Choose a valid category." }, { status: 400 });
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

  const base = {
    host_email: auth.user.email ?? "",
    title,
    category,
    description,
    status: "under_review" as const,
  };

  let result = await admin.from("host_feature_requests").insert({ ...base, host_id: auth.user.id }).select("id").single();
  if (result.error && /host_id/i.test(result.error.message)) {
    result = await admin.from("host_feature_requests").insert({ ...base, user_id: auth.user.id }).select("id").single();
  }

  if (result.error) {
    return Response.json(
      {
        error: result.error.message.includes("host_feature_requests")
          ? "The host_feature_requests table is missing. Run the latest supabase/schema.sql in the SQL editor."
          : result.error.message,
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, id: result.data?.id });
}
