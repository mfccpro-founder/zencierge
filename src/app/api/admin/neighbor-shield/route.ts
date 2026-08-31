import { requireHostUser } from "@/lib/supabase-route";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  DEMO_NEIGHBOR_ALERTS,
  defaultCommunityMessage,
  guestNoticeCopy,
  isCommunityAlertType,
  isInvalidProviderKey,
  type NeighborAlertRow,
} from "@/lib/admin-neighbor-shield";
import { sendGuestHouseRulesSms } from "@/lib/guest-sms";

export const dynamic = "force-dynamic";

const simulatedAlerts: NeighborAlertRow[] = [];

function rememberSimulated(alert: NeighborAlertRow) {
  simulatedAlerts.unshift(alert);
  if (simulatedAlerts.length > 40) simulatedAlerts.pop();
}

function mergeAlerts(rows: NeighborAlertRow[]) {
  const seen = new Set<string>();
  const merged: NeighborAlertRow[] = [];
  for (const row of [...simulatedAlerts, ...rows, ...DEMO_NEIGHBOR_ALERTS]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged.slice(0, 25);
}

function demoAlert(input: {
  propertyId: string | null;
  alertType: string;
  message: string;
  isTest: boolean;
  notifyGuest: boolean;
}): NeighborAlertRow {
  return {
    id: `demo-${Date.now()}`,
    property_id: input.propertyId,
    alert_type: input.alertType,
    message: input.message,
    is_test: input.isTest,
    created_at: new Date().toISOString(),
    guest_notified: input.notifyGuest,
  };
}

export async function GET() {
  const auth = await requireHostUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return Response.json({
      alerts: mergeAlerts([]),
      simulated: true,
      error: null,
    });
  }

  const { data, error } = await admin
    .from("neighbor_alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error && isInvalidProviderKey(error)) {
    return Response.json({
      alerts: mergeAlerts([]),
      simulated: true,
      error: null,
    });
  }

  const rows = (data ?? []) as NeighborAlertRow[];
  if (rows.length > 0) {
    const seen = new Set<string>();
    const alerts: NeighborAlertRow[] = [];
    for (const row of [...simulatedAlerts, ...rows]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      alerts.push(row);
    }
    return Response.json({
      alerts: alerts.slice(0, 25),
      error: error && !isInvalidProviderKey(error) ? error.message : null,
    });
  }

  return Response.json({
    alerts: mergeAlerts([]),
    error: error && !isInvalidProviderKey(error) ? error.message : null,
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

  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    admin = null;
  }

  let guestPhone: string | null = null;
  if (notifyGuest && propertyId && admin) {
    try {
      const { data: guest, error: guestError } = await admin
        .from("captured_guests")
        .select("phone, full_name")
        .eq("property_id", propertyId)
        .order("check_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!guestError || !isInvalidProviderKey(guestError)) {
        guestPhone = guest?.phone ? String(guest.phone) : null;
      }
    } catch {
      guestPhone = guestPhone ?? "+1 (305) 555-0142";
    }
  }
  if (notifyGuest && !guestPhone) {
    guestPhone = "+1 (305) 555-0142";
  }

  let sms = { delivered: false, simulated: false, to: guestPhone };
  if (notifyGuest && guestCopy) {
    sms = await sendGuestHouseRulesSms(guestPhone, guestCopy);
  }

  const message = guestCopy
    ? `${baseMessage}\n\n${sms.simulated ? "Guest notice simulated (Twilio demo mode):" : "Guest notice queued:"} ${guestCopy}`
    : baseMessage;

  let alert: NeighborAlertRow | null = null;
  let simulated = !admin || sms.simulated;

  if (admin) {
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

    if (error && isInvalidProviderKey(error)) {
      alert = demoAlert({ propertyId, alertType, message, isTest, notifyGuest });
      rememberSimulated(alert);
      simulated = true;
    } else if (error) {
      alert = demoAlert({ propertyId, alertType, message, isTest, notifyGuest });
      rememberSimulated(alert);
      simulated = true;
    } else {
      alert = { ...(data as NeighborAlertRow), guest_notified: notifyGuest };
    }
  } else {
    alert = demoAlert({ propertyId, alertType, message, isTest, notifyGuest });
    rememberSimulated(alert);
    simulated = true;
  }

  return Response.json({
    ok: true,
    alert,
    simulated,
    smsSimulated: sms.simulated,
    guestNoticeQueued: notifyGuest,
    guestNotice: guestCopy,
    guestPhone: sms.to,
  });
}
