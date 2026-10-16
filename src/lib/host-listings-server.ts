import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Property, Reservation } from "@/lib/dashboard-data";
import {
  propertyFromRow,
  propertyToRow,
  reservationFromRow,
  reservationToRow,
  type PropertyRow,
  type ReservationRow,
} from "@/lib/supabase-listings";

export const HOST_PROPERTY_COLUMNS = [
  "id",
  "name",
  "city",
  "address",
  "status",
  "revenue",
  "door_code",
  "smartlock",
  "wifi_network",
  "wifi_password",
  "parking",
  "gate_code",
  "check_in",
  "check_out",
  "current_guest",
  "trash",
  "handbook",
  "ai_handbook",
  "assigned_avatar_name",
  "assigned_phone_number",
  "avatar_system_prompt",
  "timezone",
].join(",");

export const HOST_RESERVATION_COLUMNS = [
  "id",
  "property_id",
  "guest",
  "phone",
  "platform",
  "check_in",
  "check_out",
  "check_in_time",
  "check_out_time",
  "access_code",
  "ai_notes",
  "nights",
  "status",
].join(",");

export type HostListingsResult =
  | { kind: "ok"; properties: Property[]; reservations: Reservation[] }
  | { kind: "unavailable" };

export async function loadHostListings(
  admin: SupabaseClient,
  hostId: string,
): Promise<HostListingsResult> {
  const propertiesResult = await admin
    .from("properties")
    .select(HOST_PROPERTY_COLUMNS)
    .eq("host_id", hostId)
    .order("name");
  if (propertiesResult.error) return { kind: "unavailable" };

  const propertyRows = (propertiesResult.data ?? []) as unknown as PropertyRow[];
  const propertyIds = propertyRows.map((row) => row.id);
  if (propertyIds.length === 0) {
    return { kind: "ok", properties: [], reservations: [] };
  }

  const reservationsResult = await admin
    .from("reservations")
    .select(HOST_RESERVATION_COLUMNS)
    .in("property_id", propertyIds)
    .order("check_in");
  if (reservationsResult.error) return { kind: "unavailable" };

  return {
    kind: "ok",
    properties: propertyRows.map(propertyFromRow),
    reservations: ((reservationsResult.data ?? []) as unknown as ReservationRow[]).map(reservationFromRow),
  };
}

export type HostPropertyCountResult =
  | { kind: "ok"; count: number }
  | { kind: "unavailable" };

export async function countHostProperties(
  admin: SupabaseClient,
  hostId: string,
): Promise<HostPropertyCountResult> {
  const { count, error } = await admin
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("host_id", hostId);
  if (error || count === null) return { kind: "unavailable" };
  return { kind: "ok", count };
}

export type CreatePropertyResult =
  | { kind: "created" }
  | { kind: "limit" }
  | { kind: "conflict" }
  | { kind: "unavailable"; message?: string };

export async function createHostPropertyAtomically(input: {
  admin: SupabaseClient;
  hostId: string;
  property: Property;
  maxProperties: number | null;
}): Promise<CreatePropertyResult> {
  const propertyRow = propertyToRow(input.property);
  const { error } = await input.admin.rpc("create_host_property_with_limit", {
    p_host_id: input.hostId,
    p_max_properties: input.maxProperties,
    p_property: propertyRow,
  });
  if (!error) return { kind: "created" };
  if (error.code === "ZP001") return { kind: "limit" };
  if (error.code === "23505") return { kind: "conflict" };
  return { kind: "unavailable", message: error.message };
}

export async function updateHostProperty(
  admin: SupabaseClient,
  property: Property,
  expectedHostId?: string,
): Promise<{ kind: "updated" } | { kind: "missing" } | { kind: "unavailable" }> {
  const row = propertyToRow(property);
  let query = admin
    .from("properties")
    .update(row)
    .eq("id", property.id);
  if (expectedHostId) query = query.eq("host_id", expectedHostId);
  const { data, error } = await query.select("id");
  if (error) return { kind: "unavailable" };
  if (!data?.length) return { kind: "missing" };
  return { kind: "updated" };
}

export async function upsertOwnedReservation(input: {
  admin: SupabaseClient;
  hostId: string;
  reservation: Reservation;
}): Promise<{ kind: "saved" } | { kind: "forbidden" } | { kind: "conflict" } | { kind: "unavailable" }> {
  const { error } = await input.admin.rpc("save_host_reservation", {
    p_host_id: input.hostId,
    p_reservation: reservationToRow(input.reservation),
  });
  if (!error) return { kind: "saved" };
  if (error.code === "ZR001") return { kind: "conflict" };
  if (error.code === "ZR002") return { kind: "forbidden" };
  return { kind: "unavailable" };
}

export async function loadInboundPropertyByNumber(
  admin: SupabaseClient,
  dialedNumber: string,
): Promise<{ kind: "found"; property: Property } | { kind: "missing" } | { kind: "unavailable" }> {
  const normalized = dialedNumber.trim();
  if (!normalized) return { kind: "missing" };
  const { data, error } = await admin
    .from("properties")
    .select(HOST_PROPERTY_COLUMNS)
    .eq("assigned_phone_number", normalized)
    .limit(2);
  if (error) return { kind: "unavailable" };
  if (!data || data.length !== 1) return { kind: "missing" };
  return { kind: "found", property: propertyFromRow(data[0] as unknown as PropertyRow) };
}

export async function loadPropertyById(
  admin: SupabaseClient,
  propertyId: string,
): Promise<{ kind: "found"; property: Property } | { kind: "missing" } | { kind: "unavailable" }> {
  const { data, error } = await admin
    .from("properties")
    .select(HOST_PROPERTY_COLUMNS)
    .eq("id", propertyId)
    .maybeSingle();
  if (error) return { kind: "unavailable" };
  if (!data) return { kind: "missing" };
  return { kind: "found", property: propertyFromRow(data as unknown as PropertyRow) };
}
