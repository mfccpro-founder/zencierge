import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hashStayToken, type GuestStayTokenRow, type StayTokenStore } from "@/lib/guest-stay-token";
import { hostOwnsReservation, listOwnedPropertyIds, type HostOwnershipAuth, type HostOwnershipStore } from "@/lib/host-property-ownership";

export const DEMO_HOUSEKEEPING = "Demo Housekeeping" as const;
export const GUEST_TOWEL_REQUEST_RPC = "create_guest_towel_request_atomic" as const;
export const GUEST_SERVICE_REQUEST_COLUMNS = "id, property_id, reservation_id, request_type, quantity, status, assigned_to, proof_task_id, accepted_at, report_note, created_at, updated_at" as const;

export type GuestServiceRequestStatus = "requested" | "assigned" | "in_progress" | "evidence_submitted" | "completed" | "needs_attention";
export type GuestServiceRequest = {
  id: string;
  propertyId: string;
  reservationId: string;
  requestType: "extra_towels";
  quantity: 2;
  status: GuestServiceRequestStatus;
  assignedTo: typeof DEMO_HOUSEKEEPING | null;
  proofTaskId: string | null;
  acceptedAt: string | null;
  reportNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GuestServiceRequestStore = {
  createTowelRequest(input: { token: GuestStayTokenRow }): Promise<{ id: string; status: string } | null>;
  listForProperties(propertyIds: string[]): Promise<Record<string, unknown>[]>;
  getById(id: string): Promise<Record<string, unknown> | null>;
  updateStatus(id: string, expectedStatus: GuestServiceRequestStatus, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  linkProofForReservation(reservationId: string, proofTaskId: string): Promise<void>;
  markByProofTask(proofTaskId: string, status: "evidence_submitted" | "completed" | "needs_attention"): Promise<void>;
};

export function isTwoTowelsRequest(message: string) {
  const q = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const towels = /\b(towels?|toallas?)\b/.test(q);
  const two = /\b(2|two|dos|couple of|pair of)\b/.test(q);
  const request = /\b(need|needs|want|bring|send|get|request|necesito|queremos|trae|traigan|envi[ae]|pedir)\b/.test(q);
  return towels && two && request;
}

export function towelRequestConfirmation(lang: "en" | "es") {
  return lang === "es"
    ? "Tu solicitud de dos toallas quedó registrada. El anfitrión puede asignarla y seguir su estado."
    : "Your request for two towels was registered. The host can assign it and track its status.";
}

export async function createAuthorizedTowelRequest(input: {
  rawToken: string;
  tokenStore: StayTokenStore;
  requestStore: GuestServiceRequestStore;
}) {
  const token = await input.tokenStore.findByHash(hashStayToken(input.rawToken));
  if (!token) return null;
  return input.requestStore.createTowelRequest({ token });
}

function mapRow(row: Record<string, unknown>): GuestServiceRequest | null {
  const status = row.status as GuestServiceRequestStatus;
  if (typeof row.id !== "string" || typeof row.property_id !== "string" || typeof row.reservation_id !== "string") return null;
  if (!["requested", "assigned", "in_progress", "evidence_submitted", "completed", "needs_attention"].includes(status)) return null;
  return {
    id: row.id, propertyId: row.property_id, reservationId: row.reservation_id,
    requestType: "extra_towels", quantity: 2, status,
    assignedTo: row.assigned_to === DEMO_HOUSEKEEPING ? DEMO_HOUSEKEEPING : null,
    proofTaskId: typeof row.proof_task_id === "string" ? row.proof_task_id : null,
    acceptedAt: typeof row.accepted_at === "string" ? row.accepted_at : null,
    reportNote: typeof row.report_note === "string" ? row.report_note : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

export async function listHostServiceRequests(input: { auth: HostOwnershipAuth; ownershipStore: HostOwnershipStore; store: GuestServiceRequestStore }) {
  const owned = await listOwnedPropertyIds({ auth: input.auth, store: input.ownershipStore });
  if (owned.kind === "unavailable") return { status: 503, body: { error: "unavailable" } };
  if (owned.ids.length === 0) return { status: 200, body: { requests: [] } };
  const rows = await input.store.listForProperties(owned.ids);
  const requests = rows.map(mapRow).filter((row): row is GuestServiceRequest => row !== null);
  return { status: 200, body: { requests } };
}

const TRANSITIONS: Record<GuestServiceRequestStatus, GuestServiceRequestStatus[]> = {
  requested: ["assigned"], assigned: ["in_progress"], in_progress: [],
  evidence_submitted: ["needs_attention", "completed"], needs_attention: ["in_progress"], completed: [],
};

export async function updateHostServiceRequest(input: { id: string; nextStatus: GuestServiceRequestStatus; auth: HostOwnershipAuth; ownershipStore: HostOwnershipStore; store: GuestServiceRequestStore }) {
  const raw = await input.store.getById(input.id);
  const current = raw ? mapRow(raw) : null;
  if (!current) return { status: 404, body: { error: "not_found" } };
  const owns = await hostOwnsReservation({ reservationId: current.reservationId, propertyId: current.propertyId, auth: input.auth, store: input.ownershipStore });
  if (owns.kind === "unavailable") return { status: 503, body: { error: "unavailable" } };
  if (owns.kind !== "owned") return { status: 403, body: { error: "forbidden" } };
  if (!TRANSITIONS[current.status].includes(input.nextStatus)) return { status: 409, body: { error: "invalid_transition" } };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: input.nextStatus, updated_at: now };
  if (input.nextStatus === "assigned") Object.assign(patch, { assigned_to: DEMO_HOUSEKEEPING, assigned_at: now });
  if (input.nextStatus === "in_progress") patch.started_at = now;
  if (input.nextStatus === "completed") patch.completed_at = now;
  const updated = await input.store.updateStatus(input.id, current.status, patch);
  const request = updated ? mapRow(updated) : null;
  return request ? { status: 200, body: { request } } : { status: 503, body: { error: "unavailable" } };
}

export function createSupabaseGuestServiceRequestStore(admin: SupabaseClient): GuestServiceRequestStore {
  return {
    async createTowelRequest({ token }) {
      const { data, error } = await admin.rpc(GUEST_TOWEL_REQUEST_RPC, { p_token_id: token.id, p_reservation_id: token.reservation_id, p_property_id: token.property_id });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row && typeof row.request_id === "string" ? { id: row.request_id, status: String(row.request_status) } : null;
    },
    async listForProperties(ids) {
      const { data, error } = await admin.from("guest_service_requests").select(GUEST_SERVICE_REQUEST_COLUMNS).in("property_id", ids).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Record<string, unknown>[];
    },
    async getById(id) {
      const { data, error } = await admin.from("guest_service_requests").select(GUEST_SERVICE_REQUEST_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    async updateStatus(id, expectedStatus, patch) {
      const { data, error } = await admin.from("guest_service_requests").update(patch).eq("id", id).eq("status", expectedStatus).select(GUEST_SERVICE_REQUEST_COLUMNS).maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    async linkProofForReservation(reservationId, proofTaskId) {
      const { error } = await admin.from("guest_service_requests").update({ proof_task_id: proofTaskId, updated_at: new Date().toISOString() }).eq("reservation_id", reservationId).eq("request_type", "extra_towels").in("status", ["assigned", "in_progress", "needs_attention"]);
      if (error) throw error;
    },
    async markByProofTask(proofTaskId, status) {
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === "completed") patch.completed_at = new Date().toISOString();
      const { error } = await admin.from("guest_service_requests").update(patch).eq("proof_task_id", proofTaskId);
      if (error) throw error;
    },
  };
}
