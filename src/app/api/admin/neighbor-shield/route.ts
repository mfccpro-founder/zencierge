import { requireHostUser } from "@/lib/supabase-route";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  DEMO_NEIGHBOR_ALERTS,
  defaultCommunityMessage,
  guestNoticeCopy,
  isCommunityAlertType,
  type NeighborAlertRow,
} from "@/lib/admin-neighbor-shield";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireHostUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return Response.json({
      alerts: DEMO_NEIGHBOR_ALERTS,
      error: error instanceof Error ? error.message : "Service role key missing.",
    });
  }
  const { data, error } = await admin
    .from("neighbor_alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);

  const rows = (data ?? []) as NeighborAlertRow[];
  return Response.json({
    alerts: rows.length > 0 ? rows : DEMO_NEIGHBOR_ALERTS,
    error: error?.message ?? null,
  });
}

export async function POST(request: Request) {
  const auth = await requireHostUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    propertyId?: string;
    alertType?: string;
    message?: string;
    notifyGuest?: boolean;
    alertId?: string;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const alertType = (body.alertType ?? "noise").trim() || "noise";
  const isTest = alertType === "test";
  const communityType = isCommunityAlertType(alertType) ? alertType : isTest ? null : "noise";
  const notifyGuest = Boolean(body.notifyGuest) && !isTest;
  const propertyId = (body.propertyId ?? "").trim() || null;

  const baseMessage =
    (body.message ?? "").trim() ||
    (isTest
      ? `[TEST] NeighborShield ping from admin console at ${new Date().toLocaleString("en-US")} — verify the host WhatsApp/SMS delivery path.`
      : defaultCommunityMessage(communityType ?? "noise"));

  const guestCopy = communityType && notifyGuest ? guestNoticeCopy(communityType) : null;
  const message = guestCopy ? `${baseMessage}\n\nGuest notice queued: ${guestCopy}` : baseMessage;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    const demo: NeighborAlertRow = {
      id: `demo-${Date.now()}`,
      property_id: propertyId,
      alert_type: alertType,
      message,
      is_test: isTest,
      created_at: new Date().toISOString(),
      guest_notified: notifyGuest,
    };
    return Response.json({
      ok: true,
      alert: demo,
      guestNoticeQueued: notifyGuest,
      guestNotice: guestCopy,
    });
  }

  const { data, error } = await admin
    .from("neighbor_alerts")
    .insert({
      property_id: propertyId,
      alert_type: alertType,
      message,
      is_test: isTest,
    })
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  let guestPhone: string | null = null;
  if (notifyGuest && propertyId) {
    const { data: guest } = await admin
      .from("captured_guests")
      .select("phone, full_name")
      .eq("property_id", propertyId)
      .order("check_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    guestPhone = guest?.phone ? String(guest.phone) : null;
  }

  return Response.json({
    ok: true,
    alert: data,
    guestNoticeQueued: notifyGuest,
    guestNotice: guestCopy,
    guestPhone,
  });
}
