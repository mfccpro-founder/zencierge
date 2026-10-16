import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hashHousekeepingProofToken } from "@/lib/housekeeping-proof";
import { HOUSEKEEPING_DEMO_REPORT_NOTE } from "@/lib/housekeeping-mobile-demo-shared";

type Action = "status" | "accept" | "start" | "report";

function invalid() { return { status: 400, body: { error: "invalid" } }; }
function unavailable() { return { status: 503, body: { error: "unavailable" } }; }

export function parseHousekeepingDemoProgressBody(body: unknown):
  | { token: string; action: Action; reportNote?: string }
  | { error: "invalid" } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid" };
  const row = body as Record<string, unknown>;
  const action = row.action;
  const token = typeof row.token === "string" ? row.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token) || !["status", "accept", "start", "report"].includes(String(action))) return { error: "invalid" };
  const keys = Object.keys(row).sort().join(",");
  if (action === "report") {
    if (keys !== "action,reportNote,token" || row.reportNote !== HOUSEKEEPING_DEMO_REPORT_NOTE) return { error: "invalid" };
    return { token, action, reportNote: HOUSEKEEPING_DEMO_REPORT_NOTE };
  }
  if (keys !== "action,token") return { error: "invalid" };
  return { token, action: action as Exclude<Action, "report"> };
}

export async function handleHousekeepingDemoProgress(admin: SupabaseClient, body: unknown) {
  const parsed = parseHousekeepingDemoProgressBody(body);
  if ("error" in parsed) return invalid();
  const now = new Date().toISOString();
  const { data: tokenRow, error: tokenError } = await admin.from("housekeeping_proof_tokens")
    .select("task_id,expires_at,revoked_at").eq("token_hash", hashHousekeepingProofToken(parsed.token)).maybeSingle();
  if (tokenError) return unavailable();
  if (!tokenRow || tokenRow.revoked_at || Date.parse(tokenRow.expires_at) <= Date.now()) return { status: 410, body: { error: "expired" } };
  const { data: task, error: taskError } = await admin.from("housekeeping_proof_tasks")
    .select("id,property_id,reservation_id,status").eq("id", tokenRow.task_id).maybeSingle();
  if (taskError) return unavailable();
  if (!task || task.status === "approved" || task.status === "closed") return { status: 409, body: { error: "unavailable" } };
  const { data: request, error: requestError } = await admin.from("guest_service_requests")
    .select("id,property_id,reservation_id,status,assigned_to,proof_task_id,accepted_at,report_note")
    .eq("proof_task_id", task.id).maybeSingle();
  if (requestError) return unavailable();
  if (!request || request.property_id !== task.property_id || request.reservation_id !== task.reservation_id || request.assigned_to !== "Demo Housekeeping") {
    return { status: 404, body: { error: "invalid" } };
  }
  let current = request;
  if (parsed.action === "accept" && !current.accepted_at) {
    if (current.status !== "assigned") return { status: 409, body: { error: "invalid_transition" } };
    const result = await admin.from("guest_service_requests").update({ accepted_at: now }).eq("id", current.id).eq("status", "assigned").is("accepted_at", null)
      .select("status,accepted_at,report_note").maybeSingle();
    if (result.error || !result.data) return unavailable();
    current = { ...current, ...result.data };
  }
  if (parsed.action === "start") {
    if (current.accepted_at && current.status === "in_progress") {
      return { status: 200, body: { ok: true, demo: true, status: current.status, accepted: true, reportNote: current.report_note ?? null } };
    }
    if (!current.accepted_at || current.status !== "assigned") return { status: 409, body: { error: "invalid_transition" } };
    const result = await admin.from("guest_service_requests").update({ status: "in_progress", started_at: now }).eq("id", current.id).eq("status", "assigned")
      .select("status,accepted_at,report_note").maybeSingle();
    if (result.error || !result.data) return unavailable();
    current = { ...current, ...result.data };
  }
  if (parsed.action === "report") {
    if (current.status !== "in_progress") return { status: 409, body: { error: "invalid_transition" } };
    const photos = await admin.from("housekeeping_proof_photos").select("id", { count: "exact", head: true }).eq("task_id", task.id).eq("review_status", "pending");
    if (photos.error) return unavailable();
    if (!photos.count) return { status: 409, body: { error: "photo_required" } };
    const result = await admin.from("guest_service_requests").update({ report_note: parsed.reportNote, updated_at: now }).eq("id", current.id).eq("status", "in_progress")
      .select("status,accepted_at,report_note").maybeSingle();
    if (result.error || !result.data) return unavailable();
    current = { ...current, ...result.data };
  }
  return { status: 200, body: { ok: true, demo: true, status: current.status, accepted: Boolean(current.accepted_at), reportNote: current.report_note ?? null } };
}
